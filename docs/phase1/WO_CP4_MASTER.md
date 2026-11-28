# WO-P1-CP4 — Advanced Imaging Engine (Master Work Order)

- Issued by: Q00 Supervisor
- Date: 2026-11-28
- Baseline code: `f4d900b` (pro-engine tip `86352e2`, docs-only above code)
- Status: **IN PROGRESS**
- Supersedes: nothing; CP3 master stays frozen at `docs/phase1/WO_CP3_MASTER.md`

## 0. Scope Guard (binding)

Non-AI 개발 범위 유지 / 서버 업로드 및 신규 백엔드 금지 / 기존 사진 편집 기능 보존 /
**main 및 beta 병합·배포 금지 (PO 명시 승인 전)** / Lean Engineering Policy v1.1 준수.

- PRs stay **Draft**. Q01 performs merges (`git merge --no-ff`) of Q00-approved SHAs only.
- No rebase / no history rewrite of pushed branches. Rebase onto `origin/feature/phase1-pro-engine` is allowed only for your own unmerged branch before push (never force).
- Video/RAW fixtures are **local-only**, never committed. E2E specs must guard with `existsSync`.
- Reuse existing PoC and G3 PASS evidence. Do not re-verify CP3 results. No repeated QA on one commit. No new agents.

## 1. Reusable evidence (do not rebuild)

| Asset | Location | Reuse |
|---|---|---|
| Video PoC PASS | `poc/q03-imaging/` + `docs/phase1/VIDEO_POC.md` | WebCodecs decode → WebGL2 grade → streaming encode; audio packet passthrough (SHA identical); dynamic AVC profiles; MemoryBudgetError; cancel/AbortError; 45 s export heap-flat |
| Optical PoC PASS | `poc/optical/` + `docs/phase1/OPTICAL_POC.md` | `focus.ts` CoC; golden-angle PSF taps; 64×1 RGBA32F PSF texture; half-res preview; `suggestTaps` budget; memory 3·s²·4B |
| CP3 seams | `webglRenderer.ts`, `imageExporter.ts`, `resourceBudget.ts`, `exportControl.ts` | GL context lifecycle (detached-only loseContext), per-job renderer, progress stages, cancel semantics |
| RAW seam | `decodeEditorImage`, `resolveDecodedImageOriginal`, `withRawDevelopGuard`, `getRawDevelopInfo` | Develop composition replaces guard zeroing (BL-CP3-01) |
| Batch queue | `src/poc/q04/batchQueue.ts` | retry/retryFailed semantics unchanged; video is NOT batched in CP4 |

## 2. Contract decisions (Q01 authors, additive only)

CP3 frozen blobs stay byte-identical: `optical 539a381`, `imageBuffer f1f9330`, `masks 0c6935a`,
`exportControl 108e708`, `moduleRegistry 42ca676`, `geometry 44dd349`. New files only; recipe
schema goes to **V10** (write 10, read 1–10). `moduleRegistry` is NOT extended for video — video
uses its own controller.

### 2.1 `src/engine/contracts/develop.ts` (Q01)

```ts
export interface RawDevelopState {
  wb: { mode: 'as-shot' } | { mode: 'custom'; temperatureK: number; tint: number }; // 2000..12000, -100..100
  exposureEV: number;        // -5..+5, 0 = neutral
  highlightRecovery: number; // 0..1, default 0
}
export const RAW_NEUTRAL_DEVELOP: RawDevelopState; // as-shot, 0, 0
export function isNeutralDevelop(s: RawDevelopState): boolean;
// Compose develop as the BASELINE stage; user adjustments stay additive on top.
// info.developBaked = true  → decoder already applied it, do not re-apply.
export function composeDevelop(settings: RenderSettings, dev: RawDevelopState, info: RawDevelopInfo): RenderSettings;
```

Semantics (fixes BL-CP3-01): when develop is non-neutral, `composeDevelop` no longer zeroes
user exposure/temperature/tint. Order = decoder neutral (or baked per `info`) → develop baseline
→ user adjustments. Double application is prevented by `info.developBaked`, not by discarding user input.

### 2.2 `src/engine/contracts/lensBlur.ts` (Q01 from Q02 proposal)

```ts
export interface LensBlurState {
  enabled: boolean;
  focusPlane: number;   // 0..1 normalized manual depth
  focusRange: number;   // 0..1 in-focus band
  aperture: number;     // f-number 1..22, CoC proxy
  bladeCount: number;   // 5..9
  rotationDeg: number;
  quality: 'preview' | 'export';
  highlightBoost: number;          // 0..2
  depthMask: import('./masks').MaskData[] | null; // flat stack from frozen masks.ts; null = procedural depth
}
export function normalizeLensBlur(s: Partial<LensBlurState>): LensBlurState;
export function isNeutralLensBlur(s: LensBlurState): boolean;
```

### 2.2a lensBlur seam addendum (frozen 2026-11-28, Q02 proposal accepted with one correction)

- `depthMask` is `MaskData[] | null` using **frozen `contracts/masks.ts`** (flat stack, `normalizeMasks`, MAX_MASKS). There is no `MaskGroup` in the frozen contract; do not add a parallel group type. Per-mask `blend`/`opacity`/`inverted` compose the stack coverage; coverage value = normalized depth (0 near, 1 far). `luminance`/`color` kinds are rejected by the planner with an explicit error (they need corrected pixels); brush/linear/radial are accepted.
- `LensBlurCapability = { maxTextureSize: number; maxTaps?: number; supportsFloatLinear?: boolean }`.
- `planLensBlur(state, outputSize, capability): LensBlurPlan | null` — returns `null` when `isNeutralLensBlur` or tap budget resolves to 0 (byte-equal path). The contract declares the FULL plan shape the renderer binds (frozen 2026-11-28 after Q02 v1, `2e9dedf`); Q02's planner returns it structurally:

```ts
export interface LensBlurPlan {
  width: number; height: number;          // gather dimensions (halfRes applied)
  outputWidth: number; outputHeight: number;
  halfRes: boolean;
  focusPlane: number; focusRange: number; falloff: number;
  maxCocShortSide: number; maxCocPx: number; aperture: number;
  taps: number; tapCount: number; quality: 'preview' | 'export';
  highlightBoost: number; guardBand: number; guardStrength: number;
  psf: Float32Array;                      // 64x1 RGBA32F (256 floats)
  depth: Float32Array | null;             // rasterized manual depth at output res
}
```
- CoC (short-side units): `maxCoc = 0.08 / aperture` (f/1 = 0.08, f/22 ≈ 0.0036); `t = smoothstep((|depth - focusPlane| - focusRange/2) / falloff)`, `falloff = max(0.05, (1 - focusRange)/2)`; `coc = maxCoc * t`. Monotonic in `|depth - focusPlane|`.
- `depthMask: null` → procedural depth = short-side distance from image center normalized so the farthest corner = 1 (PoC radial model).

### 2.3 `src/engine/contracts/video.ts` (Q01 stub, Q03 implements engine)

```ts
export interface VideoAssetMeta { durationSec; width; height; fps; rotationDeg; videoCodec; audioCodec: string | null; canDecode: boolean; }
export interface VideoTrim { startSec: number; endSec: number; }
export interface VideoExportSettings {
  container: 'mp4' | 'webm';
  videoCodec: 'avc' | 'vp9';
  audioMode: 'passthrough' | 'aac' | 'none';
  resolution: 'source' | '1080p' | '720p';
  bitrateMbps: number;
  fps: number;
  trim: VideoTrim;
}
export interface VideoCapabilities { canDecode: boolean; encoders: { avc: boolean; vp9: boolean }; containers: { mp4: boolean; webm: boolean }; audioPassthrough: boolean; };
export interface VideoExportProgress { phase: 'decode'|'render'|'encode'|'mux'; framesDone: number; framesTotal: number; };
```

`VideoExportHandle = { promise: Promise<void>; cancel(): void; onProgress(cb): () => void }`; cancel
rejects with `AbortError` (same convention as `exportControl`).

### 2.4 Render seams (Q01)

```ts
// Per-frame grading: texture upload per frame, LUT uploaded once.
export function createVideoFrameRenderer(canvas: HTMLCanvasElement, settings: RenderSettings): {
  renderFrame(frame: VideoFrame | ImageBitmap): Promise<void>;
  resize(w: number, h: number): void;
  dispose(): void;
};
// Tiled export for images exceeding MAX_TEXTURE_SIZE or the memory budget.
export function renderTiled(opts: { image: DecodedImage; settings: RenderSettings; maxTextureSize: number; budgetBytes: number; overlap: number }): Promise<HTMLCanvasElement>;
```

Tiling composes tiles into the final canvas (overlap + seam blend) and respects `resourceBudget`.
Preview and export share the same pipeline; only tap budget / half-res / tile size differ.

### 2.5 UI mount slots (Q01 owns mounting, others own components)

- Q01 mounts `src/components/optical/LensBlurPanel.tsx` (Q02) and `src/components/raw/DevelopPanel.tsx` (Q03) into `AdjustmentPanel` sections; Q02/Q03 never edit `AdjustmentPanel.tsx`.
- Q01 mounts `src/components/video/VideoWorkspace.tsx` (Q04) in the editor shell; Q04 never edits `App.tsx` / `Viewport.tsx`.
- Focus-mask painting: Q02 builds the overlay component; Q01 adds the mount prop. Reuse the mask stroke schema inside `LensBlurState.depthMask`.

## 3. Path ownership (delta from MODULE_OWNERSHIP)

| Owner | New in CP4 |
|---|---|
| Q01 | `contracts/{develop,lensBlur,video}.ts`, recipe V10, `renderer` frame/tile APIs, `AdjustmentPanel/Viewport/App/ExportModal` mounts, stores |
| Q02 | `src/engine/optical/lensBlur*` (port), `src/components/optical/**` |
| Q03 | `src/engine/video/**`, `src/components/raw/**`, `package.json`+lock (mediabunny), `THIRD_PARTY_NOTICES.md` |
| Q04 | `src/components/video/**`, `src/engine/image/workspace.ts` media filter (Q03 review), `workspaceStore.ts` video entries, video E2E |
| Q05B | verification only, no code |

Locked out for everyone: `src/engine/contracts/*` (Q01), `package.json` (Q03 only during CP4),
`docs/phase1/WO_CP4_MASTER.md` (Q00 only), `src/poc/**` (reference-only, no edits).

## 4. Phase plan and dependency order

| Phase | Owner | Deliverable | Depends on |
|---|---|---|---|
| CP4-01a | Q01 | develop + lensBlur + video contracts; recipe V10; develop composition (BL-CP3-01); minimal frame-api stubs pushed **first** | — |
| CP4-01b | Q01 | `createVideoFrameRenderer`, `renderTiled`, budget integration, tests (identity byte-equal for photos) | 01a |
| CP4-02 | Q02 | LensBlur engine (CoC/PSF/aperture), edge/high-frequency quality, panel + focus-mask overlay, tests | 01a (contract only) |
| CP4-03 | Q03 | mediabunny + notices; video engine (decode/encode/mux, audio passthrough, rotation/timestamp, trim, cancel, budget, capabilities); DevelopPanel | 01a (develop contract); frame grading on 01b |
| CP4-04 | Q04 | workspace media ingestion (video ext), timeline/playback (native `<video>`), trim UI, export settings + capability badges, progress/cancel/error, mobile guards | 01a; controller API from Q03 |
| CP4-05 | Q01 | integrate approved SHAs `--no-ff`, mount panels/workspace, wiring fixes | 02, 03, 04 |
| CP4-06 | Q05B | single pass: changed features + integration paths (not full regression; full regression at release gate) | 05 |

Parallelism: Q02 and Q03 start engines immediately after 01a lands. Q04 starts workspace media
ingestion + timeline shell immediately (native playback), binds Q03 controller when pushed.
Graded playback preview = single frame at playhead (debounced); full grade applies at export —
documented limitation, not a defect.

## 5. Acceptance per engineer (5 fields, local == remote)

- tsc 0 errors; `vitest run` no new failures; build OK; each new contract has unit tests.
- Photo identity: lensBlur/develop neutral ⇒ **byte-equal** output vs baseline.
- Q02: CoC monotonicity, aperture-blade shape, energy conservation, tap-budget clamp on mobile; preview/export parity within tolerance.
- Q03: 1080p transcode with audio packets SHA-identical; rotation/timestamp preserved; cancel → `AbortError` with no leaked decoder; trim exact within one frame; unsupported codec surfaces capability error.
- Q04: video file ingest → timeline → trim → export → download; cancel + retry; capability badges reflect `isConfigSupported`; mobile memory guard shows clear error.
- Fixtures local-only; specs guard with `existsSync`; ports Q01 5173 / Q02 5273 / Q03 5373 / Q04 5473 / Q05B 5573; one browser slot.

## 6. Reporting

Each engineer reports: Progress / Completed (SHA) / Test Result (numbers) / Blocker / Next Action.
Q00 records approved SHAs in this ledger. Q05B stays parked until CP4-05 completes.

## 7. Ledger — deliveries and rulings

- 2026-11-28 CP4-02 v1 accepted for branch (`feature/phase1-q02-optical` = `2e9dedf`, merge `9ae52c9` of pro-engine `67943df`): engine/panel/overlay/tests (7 files, +1,611), OPTICAL_POC §18. Q00 verified at SHA: tsc 0; vitest 49 files / 412 passed / 9 skipped; diff paths Q02-owned only; contract blobs 6/6 unchanged. Q02 E2E 5273 chromium 3/3 (gather vs CPU mean 0.0037/max 0.018). Local type mirror of §2.2a stands until CP4-01a lands, then switch to contract import. Not integrated (Q01 merge pending).
- 2026-11-28 Ruling: `LensBlurPlan` (full shape above) lives in `contracts/lensBlur.ts` (Q01); Q02's planner returns it structurally. No contracts→engine import.
