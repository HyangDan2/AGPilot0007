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
- 2026-11-28 Process ruling (Q02 flag): PR #18 is **MERGED** (historical CP2), and `gh pr list` shows only **#17** (pro-engine→beta, Draft) open — per-branch PRs #18/#19/#20/#22/#23 are all merged, so CP4 branch commits have no per-branch PR surface. **No new per-branch PRs** during CP4 (avoid churn; Draft #17 remains the single review surface). Branch reuse is correct — no renames, no rebase; fast-forward pushes of Q02's branch are fine. Q02 continues on `feature/phase1-q02-optical`.
- 2026-11-28 **CP4-01a approved** at `cac6e7e` (`f22d45b` code + `76c7d5a` ledger merge + `cac6e7e` seam alignment; pushed after ledger `927d69f`). Q00 verified at SHA: tsc 0; vitest 48 files / 416 passed (verify worktree raw-load artifact accounts for the 2-test delta vs Q01's 418/9); no deleted files; diff = Q01 paths + tests only; contract blobs 6/6 byte-identical. Contract review: develop.ts (normalize/validate/isNeutral/composeDevelop; baked default keeps user exposure/WB additive — BL-CP3-01 fixed at Viewport ×2 + ExportModal), lensBlur.ts (MaskData[] depthMask, capability, limits), video.ts (matches §2.3 + VideoExportHandle), recipeV10 (geometry required; lensBlur/develop optional; unknown keys rejected), frame/tile stubs throw/reject as specified. Q01 decisions accepted: (1) conditional write — v10 only when lensBlur/develop active, else v8/v9 (CP3 version-lowering rule); (2) future-version fixtures 10→11; (3) raw-routing test rewritten to composeDevelop semantics (asserts baked develop + user exposure kept); (4) npm ci env only.
  - **Required correction (Q01, first commit of 01b):** `contracts/lensBlur.ts` `LensBlurPlan` currently declares only the 5-field minimum; expand to the frozen full shape in §2.2a (width/height/outputWidth/outputHeight/halfRes/falloff/maxCocShortSide/aperture/tapCount/quality/highlightBoost/guardBand/guardStrength/psf/depth) — renderer binding needs the typed payload. cac6e7e predates ledger `857a7e6`.
  - Cleared for consumption: Q02/Q03/Q04 may pull `cac6e7e`. Q02 imports state types now but keeps its planner return typed locally until the plan expansion lands.
- 2026-11-28 **CP4-03 approved for branch** at `0336af5` (`feature/phase1-q03-imaging`; merge `5180f06` of pro-engine `406df67`; engine `52b7038`). Q00 verified at SHA: tsc 0; vitest 54 files / **453 passed**; worktree clean; diff = Q03 paths + tests + package + docs (mediabunny ^1.66.4, THIRD_PARTY_NOTICES with full MPL-2.0 text at §Mediabunny, LibRaw-Wasm excluded); no Base64/btoa in engine; contract blobs 6/6; deleted `developState.ts` intentional (contract import supersedes). Engine: capabilities (isConfigSupported + encodable-codec/container pairing), AVC profiles, trim ±1 frame, audio plan with packet-passthrough SHA check, rotation baked, cancel=>AbortError with renderer/input disposal, budget pre-check. E2E 7/7 chromium-only with existsSync-guarded local fixtures (Q03 evidence; not rerun per Lean). Blocker: CP4-01b renderer stub — canvas adapter behind the same seam; swap + one browser pass before CP4-05.
  - PR ruling update: Q03 opened **Draft #24** before receiving the no-new-PR ruling; it is accepted as the CP4-03 review surface (no churn). Q02/Q04 need no new PRs; Draft #17 remains the release surface.
- 2026-11-28 CP4-03 condition applied: `1e1da58` docs-only (+9/−2 in Q03_SUPPORT_MATRIX.md) records baked-rotation (rotationDeg 0, no container rotation metadata) and Chromium-only video E2E (Safari/WebKit are probe expectations). Accepted; no re-test.
- 2026-11-28 CP4-02 import switch accepted: `feature/phase1-q02-optical` = `ec0f545` (merge `f0e12f6` of pro-engine `c0843e4`, parents `2e9dedf`+`c0843e4`; refactor −62/+33 across engine/panel/tests/OPTICAL_POC). Q00 verified at SHA: tsc 0; vitest 50 files / 433 passed / 9 skipped; blobs 6/6. Engine imports contract lensBlur + masks. planLensBlur stays engine-typed until 01b expands the contract plan (frozen shape already covers psf/depth/guard fields: psf 64x1 RGBA32F Float32Array, depth Float32Array|null, guardBand/guardStrength).
- 2026-11-28 **CP4-04 v1 accepted** at `29abc43` (`feature/phase1-cp3-q04-workspace`; `6b1493a` ingest+shell, `9c0fc7f` contract binding, `29abc43` spec filter; merge `18586ac` of pro-engine `43fe43d`). Scope: workspace media filter (mp4/mov/webm/m4v, photos unchanged), workspaceStore video entries, `src/components/video/**` (timeline native `<video>`, scrub/±1f/trim, capability badges, export settings, phase progress, cancel/retry, error + mobile guards, graded-preview hook), `Workspace.tsx` temporary mount. Q00: diff = Q04-owned paths only (Workspace.tsx/WorkspaceStrip allowed; no App/Viewport/AdjustmentPanel edits); blobs 6/6. Q04 E2E 8/8 skipped-branch (engine absent), photo regression 6/6. Q04 worktree has since advanced to `e40238a` (merge of Q03 engine `1e1da58`) + uncommitted `q03Engine.ts`; verification continues at its next SHA.
  - **Seam ruling (Q04 flag accepted):** `VideoExportHandle.promise` must carry the file. Q01 adds to `contracts/video.ts` in 01b: `VideoExportResult { blob; mimeType; bytes; width; height; durationSec }` and `promise: Promise<VideoExportResult>`. Q03's `VideoExportTask` result (richer) satisfies it structurally; Q04 saves the blob. Q03 re-runs tsc after 01b.
  - **Approved:** Q04 merges Q03's branch (`e40238a`) for binding; `npm install` for mediabunny is expected; push local=remote when reporting. Temporary WorkspaceStrip mount stands; CP4-05 moves it to the shell (single mount only).
- 2026-11-28 **CP4-04 v2 (engine binding) accepted** at `200a131` (`e915f77` merge pro-engine `36a667b`; `e40238a` merge Q03 `1e1da58`; `200a131` binding + `q03Engine.ts` adapter). Q00 verified at SHA: tsc 0; vitest 53 files / **460 passed / 9 skipped**; worktree clean; blobs 6/6; no App/Viewport/AdjustmentPanel edits. Q04 browser evidence (5473, chromium): trim 0.50–1.50 s → export → download `clip_HD2Lab_FilmStudio.mp4` 53,102 B in 4.7 s; cancel → retry → download PASS; photo regression workspace-cp3 7/7 (RAW 6000×4000) + batch-export PASS; capability badges from Q03 probe; exports ungraded and UI says so (01b pending). Draft PR #25. Remaining open: Q03 review of workspace.ts media filter (Q00 assigned), CP4-05 single-mount swap, graded export after 01b.
- 2026-11-28 **Q03 review** of Q04 media filter at `200a131`: **PASS** — photo set byte-identical to CP3 acceptance set, no eager decode (lazy getFile, openVideo UI-only), workspace.ts has zero imports (no engine/video leak). **Finding accepted:** Workspace.tsx:7 → VideoWorkspace → q03Engine.ts:1 statically imports engine/video, so mediabunny enters the eager chunk on merge and CP4-03's "0 mediabunny refs in index" claim no longer holds. **Ruling (Q04, binding):** q03Engine.ts must reach engine/video only via dynamic `import()` (probe/export paths are already async), so no static shell→engine/video edge remains; frozen acceptance: production build's initial chunk contains **0 mediabunny refs**, video mode lazily loads the engine. Verify with the build output and report the chunk sizes. Q03's seam ack noted: `VideoExportResult` superset is structurally assignable; download path (`q03Engine` → `triggerSafeDownload`) unchanged.
- 2026-11-28 **CP4-04 lazy-boundary fix accepted** at `e7e717e` (diff: VideoWorkspace/engine/q03Engine only). Q00 independently reproduced at SHA: tsc 0; vitest **460 passed / 9 skipped**; `vite build` index chunk **654,026 B with 0 mediabunny refs**, lazy `video-DWLQbrJr.js` 648,374 B (2 refs), `index.html` preloads only index. Q04 E2E 8/8 skip-split + chromium real export/cancel/retry, photo regression 7/7. Note for release gate: PWA precache now 72 entries / 12,895 KiB (+678 KiB lazy video chunk precached in background) — accepted; revisit precache glob at release if mobile data matters.
- 2026-11-28 **CP4-01b accepted** at `be97411` (tip; docs ff-merged first). Q00 verified at SHA: tsc 0; vitest 50 files / **426 passed / 9 skipped**; blobs 6/6; diff = renderer/pipeline/contracts(lensBlur)/tests only. `LensBlurPlan` now the frozen 19-field shape (psf 64×1, depth null=procedural). Frame renderer: LUT resident, per-frame upload, seed 42+idx·7.31, resize pin, disposed guards. Tiled export: resourceBudget→full/tile, crop margin for optical taps, core-only compose + left/top feather, context-loss copy-before-destroy, local adjustments explicit error. Real defects found/fixed by Q01: destination-in clearing the whole canvas; blank composite after context loss. Q01 E2E `cp4-render` 2/2 + regression 11/11 (evidence accepted, not rerun).
  - **REQUIRED follow-up (Q01, first CP4-05 commit):** `contracts/video.ts` still has `promise: Promise<void>`; add `VideoExportResult { blob; mimeType; bytes; width; height; durationSec }` and change the handle (ledger 4d9411b ruling, missed in 01b). Q03/Q04 are structurally compatible already.
  - **Unblocked now:** Q02 plan annotation; Q03 renderer swap + single browser pass; Q04 graded export injection.
  - **CP4-05 scope addition:** wire `renderTiled` into the photo export path when the image exceeds MAX_TEXTURE_SIZE or the memory budget (Preview/Export shared contract), plus panel/workspace mounts and removal of Q04's temporary WorkspaceStrip mount.
- 2026-11-28 VideoExportResult seam fix accepted: `8c91cdb` (contract + assignability test) → `e41a1e7` (merge of ledger `ff9fc47`, no rebase). Q00 verified: `contracts/video.ts` now exports `VideoExportResult { blob; mimeType; bytes; width; height; durationSec }` and `VideoExportHandle.promise: Promise<VideoExportResult>`; tsc 0; vitest 426/9; diff = video.ts + cp4Contracts test only; blobs 6/6. Q01 idle pending CP4-05 order.
- 2026-11-28 **CP4-02 plan annotation accepted** at `cd9a7d6` (merge `768cb53` of pro-engine `ff9fc47`; refactor returns the contract `LensBlurPlan | null`, no widening). Q00 verified: tsc 0; vitest 51 files / **441 passed / 9 skipped**; diff = lensBlur/OpticalPoc/test only. CPU parity reference now decodes taps from the packed psf texture (same texels as GPU).
  - **Depth-resolution ruling:** `plan.depth` is authoritative at gather resolution (`plan.width×height`, half-res for preview). Q01's renderer binds it as a plan.width×height R32F texture sampled in normalized UV; the contract comment "output res" is wrong and Q01 fixes the comment (comment-only) in CP4-05.
- 2026-11-28 CP4-01b optional tile-plan reporting accepted: `0685ea2` → `b645831` (merge of ledger `066071b`). `renderTiled` keeps `Promise<HTMLCanvasElement>` and gains optional `deps.onPlan?: (plan: TilePlan) => void` (fit = 1×1 full-frame overlap 0; tiled = real plan). Q00 verified: tsc 0; vitest 426/9; blobs 6/6; diff = tiledExport + tests + ledger merge. Q01 pending CP4-05; will fix the `plan.depth` comment there.
- 2026-11-28 **CP4-04 graded export accepted** at `43c5ef6` (`feature/phase1-cp3-q04-workspace`, local=remote; merge `56149f2` of pro-engine `be97411`, parents `e7e717e`+`ff9fc47`, no rebase; Draft #25). Commit scope = 4 files, +103/−31 (`VideoWorkspace.tsx` note removal, `engine.ts` typed VideoGradeSettings, `q03Engine.ts` renderer injection, video-workspace spec); no App/Viewport/AdjustmentPanel edits. Q00 verified at SHA: tsc 0; vitest 54 files / **468 passed / 9 skipped**; blobs 6/6; dist `index` 655,319 B with 0 mediabunny refs, `video-DWLQbrJr.js` 648,374 B (3 refs), `frameRenderer-Bg27h2R9.js` 1,320 B (0 refs). Injection: cached dynamic `import()` for frameRenderer, `createVideoFrameRenderer(canvas, grade)` passed via `{settings, renderer, canvas}`; disposed on sync throw and on promise settle (cancel→AbortError path included). Q04 evidence: graded export 58,516 B mean RGB 124.3→131.3 @ Exposure +0.8 (ungraded note asserted absent), cancel→retry→download PASS; mobile-chromium ingest race fixed in test (waits for probe); batch-export flake at load 9.6 passed on retry (environmental, recorded). CP4-04 closed; Q04 standby for CP4-05 mount removal.
- 2026-11-28 **CP4-03 renderer swap accepted** at `a852fbc` (merge `be463a3` parents `1e1da58`+`ff9fc47`, no rebase; own commit 4 files +83/−14: transcode/types/spec/Q03_SUPPORT_MATRIX; Draft #24). Q00 verified at SHA: tsc 0; vitest 55 files / **461 passed**; worktree clean; blobs 6/6. Wiring: `startVideoExport` defaults to `createVideoFrameRenderer(canvas, grading ?? {adjustments: DEFAULT_ADJUSTMENTS})`; plain adapter only when the constructor throws (`rendererPath: 'fallback'` + `gradingWarning`); injected renderer honoured and never disposed by the engine; owned renderer disposed in `finally` on success and failure. E2E cold 7/7 (2.7 m): graded 1080p 60 frames / 1,560,412 B, audio passthrough 94 packets sourceHash==outputHash `7c5a44e0…8954`, rendererPath graded, warning null; cancel AbortError→retry graded; trim 75 frames / 2.5 s (within one frame); rotation 90 baked; VP9/WebM Opus passthrough identical; mp4+vp9 rejected; silent→audio none. Spec warms engine+renderer+LUTs before export (cold 240 s timeout was Vite optimizer reload, warm 22 s; cache-cleared run passes). Forced-fallback unit test not added (Lean: fallback reachable only on constructor throw, compiles, headless has WebGL2) — observation only. **CP4-03 closed.**
- 2026-11-28 **CP4-05 integration verified** at `be6227c` (merges `--no-ff` `8d8e7e7`(980773c+cd9a7d6) → `97020ab`(+a852fbc) → `220f407`(+43c5ef6); depth comment `107e239`; integration 8 files +173/−55; PR #17 Draft). Q00 verified: blobs 6/6 after each merge; tsc 0; vitest 55+2 files / **483 passed / 9 skipped**; dist `index` 678,371 B / 0 mediabunny refs, `video` 648,854 B (3 refs), `frameRenderer` 1,320 B / 0 refs; no modulepreload for lazy chunks; no deleted tests; `cp4Renderer` local fixture now uses an enabled group (guard relaxed to block only enabled local groups — accepted). Mounts reviewed: single VideoWorkspace in App (self-guards `!activeId → null`), WorkspaceStrip temp mount removed, LensBlur overlay gated by depth-edit + hidden on compare/H-hold, panels in AdjustmentPanel. renderTiled wiring: full-res over maxSafeDim or GPU budget; explicit error when local adjustments active; shared encodeCanvas. Q01 worktree has modified docs/screenshots (test artifacts) — must be restored, not committed.
  - **BLOCKING FINDING (Q00, confirmed by grep at be6227c):** `planLensBlur` has no production consumer — `RenderSettings` has no `lensBlur`, Viewport:242/ExportModal:131 build settings without it, so the mounted Lens Blur panel/overlay change nothing in preview or export. `store.develop` is persisted to v10 recipes but preview/export hardcode `developBaked: true` and read only `rawDevelop`, so DevelopPanel edits never reach pixels (Q01 flagged the develop half; lens-blur half is a Q00 scope omission in CP4-05). **CP4-06 issued (Q01)** to wire lens blur into preview/export; develop pixel re-apply becomes **BL-CP4-01** (Q03 design proposal only; PO decision after G4). G4 not issued until CP4-06 accepted & Q02 parity PASS.
- 2026-11-28 **CP4-07 authorized (BL-CP4-01 upgraded to CP4 scope, Q03 engine side):** develop edits become real via a decoder re-run with the live `RawDevelopState` (as-shot bake + develop WB/EV applied once at decode; shader `adjustments.exposure/temperature/tint` stay the user's relative offsets; `composeDevelop` baked path unchanged; no contract change). Q03 delivers `src/engine/raw/rawPreview.ts` re-develop entry + DevelopPanel binding; conditions frozen: latest-wins cancellation, ~200 ms trailing debounce, neutral fast path (no re-decode), half-size preview only, old decode outputs disposed, rawSource identity + geometry/optical/local preserved, non-RAW excluded. Q01 wires `editorStore/Viewport/ExportModal` to pass `store.develop` after CP4-06 (do not hardcode `developBaked:true` for user edits). G4 closes only after CP4-06 accepted + CP4-07 accepted + Q02 GPU-vs-CPU lens-blur parity PASS.
- 2026-11-28 **CP4-07 engine accepted (branch-scoped)** at `f5ec7d4` (`feature/phase1-q03-imaging`; 8 files: raw/index, rawDevelop, rawPreview, rawRedevelop, 3 unit suites + e2e spec). Q00 verified at SHA: tsc 0; vitest 56 files / **477 passed**; blobs 6/6; no contract or package changes; test edits are extensions, not weakening (neutral parity kept; the old ForwardMatrix fallback assertion moves to a stripped-metadata variant that still asserts it). Review: state→absolute settings (as-shot resolves to the open-time reference; 0..1 recovery → off/blend/reconstruct; 0.5 K equality), latest-wins runner (generation guard, abort, flush/cancel/dispose; superseded results never commit), in-place asset swap preserving `DecodedSource` identity, neutral skip = zero decode. **Real gap fixed:** fixtures lack a ForwardMatrix tag, so custom WB previously produced as-shot multipliers (delta 0.000); camera→XYZ(D50) is now derived from the DNG ColorMatrix (invert + Bradford), flagged `forwardDerived` with a warning, and the as-shot fallback remains only when no ColorMatrix exists. Q03 evidence (accepted): preview/export parity mean 1.101/1.458/1.091 (neutral/EV+1/WB), visible deltas EV 23.06/32.46 (CPU/browser) and WB 4.94/15.75, export 32.51/15.74; 5373 real-DNG latest-wins: first flush null, exactly 1 commit, no stale frame. Not integrated. Q01 wires `editorStore/Viewport/ExportModal` after CP4-06 (`createRawRedeveloper` → replace `image.previewCanvas/previewWidth/previewHeight` on commit, `request()` on panel change, `flush()` before commit/export, `dispose()` on close; RAW keep shader `RAW_DEVELOP_SHADER_UNIFORMS` 0/0/0; `developBaked` stays true).
- 2026-11-28 **CP4-06 accepted (branch-scoped)** at `fd09757` (code `d569e16` atop be6227c + merge of docs `d27c190`; pushed fast-forward, no rebase). Q00 verified at SHA: tsc 0; vitest 488 passed / 12 skipped / 0 failed (500; +1/+3 vs Q01's 487/9 = local RAW fixture variance, not failure); dist `index` 690,497 B / 0 mediabunny refs, `video` 648,854 B (3 refs); blobs 6/6; Q02 files untouched; worktree clean (screenshot churn restored); no test weakening (lens suites additive; cp4Renderer extended). Implementation: `RenderSettings.lensBlur/lensStage` (transient plan, never in the fingerprint); Viewport plans quality preview at canvas size cached by state+size+maxTex, bypasses on compare/H-hold and in mixer readback; exporter plans quality export at final canvas; tiled path rejects non-neutral lens blur explicitly (imageExporter + renderTiled safety net); recipe v10 round-trip (write when non-neutral; open restores lensBlur always, develop only with rawDevelop). Real defect fixed: `RenderTarget.ensure()` left the attachment bound (feedback loop → INVALID_OPERATION/black frame); vertex attribute locations pinned. E2E accepted (Q01): cp4-render 2/2, lens-blur-editor 2/2, lens-blur-glsl 1/1, render-parity 1/1, lens-blur-render 2/2; GPU-vs-reference parity mean 0.00089–0.0078 / max 0.0177–0.0664 across preview/export × depth/null; lens-off export byte-identical (max 0); lens-on export mean>0.5 / max>20 at 160×120.
  - Observations (non-blocking): (a) Q02's GLSL chunk and its own CPU reference diverge at hard colour edges — Q02 to adjudicate (production matches the chunk harness within 1 LSB); (b) video lens blur out of scope; (c) lens blur unavailable for exports that need tiling (>maxTex/budget) by explicit error — backlog candidate; (d) blur runs after grain/vignette/date-stamp inside the pass — visual ordering choice, no defect. Q02 parity verification ordered on `fd09757`.
- 2026-11-28 **CP4-07 UI wiring accepted** at `725a582` (merge `ee39656` parents `fd09757`+`f5ec7d4`, `--no-ff`, no conflicts; code `3fc0708` 2 src + 2 test files, +502/−3; pushed fast-forward; PR #17 Draft). Q00 verified at SHA: tsc 0; vitest 58 passed files / **502 passed / 16 skipped / 0 failed** (518, matches Q01); dist `index` 691,722 B / 0 mediabunny refs, `video` 648.85 kB (3 refs), `frameRenderer` 1.32 kB; blobs 6/6; worktree clean; test edits additive (new `developRedevelopWiring` + e2e `develop-wiring`, no weakening). Review: one latest-wins redeveloper per open RAW owned by the store, lazily imported (no eager engine pull); `setDevelop` and applied v10 recipes feed it; on commit `image` is replaced with new identity so the Viewport `[image]` effect re-uploads; `flushDevelop()` awaited by ExportModal before `prepareExportImage` (image re-read after flush); `setImage` disposes on source change and non-RAW never attaches; stale commits guarded by source + epoch; partial module mocks/import failures guarded. `developBaked:true` and composeDevelop untouched; RAW shader uniforms stay 0/0/0 (user exposure 0.3 survives — no double apply). Q01 evidence accepted (5373 real 6000×4000 DNG, chromium): preview delta EV 32.45 / WB 20.75, composited canvas 37.79 / 18.55, export developed-vs-neutral 38.39 mean 8-bit; rapid 0.4→1.6→1.0 drag settles on the final decode (mean 0, max 0); develop-wiring 1/1, render-parity 1/1, export 5/5. **G4 now waits only on Q02 independent lens-blur parity + hard-edge adjudication at `fd09757`.** Observations for G4/backlog: half-size re-decode ~200 ms debounce (repeated full-res exports re-decode), BL-CP4-02 (tiled-export lens blur), BL-CP4-03 (video lens blur).
- 2026-11-28 **CP4-06 parity FAILED (Q02, independent) at `fd09757` — G4 gate NOT met.** Q02 harness (96×64 synthetic, render==plan size, OES_texture_float_linear, Chromium): GPU vs `blurRgbaReference` mean/max LSB — preview null 0.327/7.88, preview depth **1.619/33.60**, export null 0.215/4.27, export depth **1.372/60.69** (worst: mask focuses vertically mirrored region). **Root cause (Q00 confirmed by code read):** a_uv has v_uv.y=0 at screen top; wrapper uv=(x,1−v_uv.y) samples the scene target at v=1=image top (upright, taps live in a v=1=top space), but (a) `plan.depth` (row 0 = image top, engine/CPU convention) is uploaded raw → texture v=0 = image top → depth read vertically mirrored vs scene; (b) PSF tap dy applied in that space while the CPU reference (authoritative) applies dy top-down → kernel mirrored. Q02 probe: radial mask y=0.12, focusPlane 1 → CPU sharp-top 168.7/19.5, GPU sharp-bottom 19.8/168.8; depth rows reversed + PSF y negated → parity ≤1.03 LSB all tiers. Q02 adjudication on observation (a): CPU reference authoritative; chunk has no defect (direct chunk harness max ≤0.500 LSB, mean 0.019–0.205; acceptable hard-edge tolerance ≤1 LSB); Q01's 0.0078/0.066 numbers were harness artifacts (near-symmetric mask cy 0.45 / feather 0.6 + smooth scene + 8-bit requant / flipped-v comparison). Lens-off byte-identity 0; orientation-accounted direction agreement 0.997/0.971. **CP4-08 issued (Q01, renderer-only):** flip `plan.depth` rows at upload (scratch copy or per-call UNPACK_FLIP_Y_WEBGL with state restored), upload PSF copy with dy negated (per plan object), keep scene v-flip untouched, no contract/Q02-file changes; regression first — asymmetric mask (cy≈0.12, low feather) at preview+export must fail pre-fix (max ≫0.07) and pass post-fix (max <0.01, mean <0.002), existing tiers tightened not deleted; rerun tsc/vitest/lens e2e/export 5/5. G4 closes on Q02 re-run PASS at the new SHA.
- 2026-11-28 **CP4-08 accepted** at `47cc881` (`feature/phase1-pro-engine`, local=remote; fix `f213a38` 2 files +94/−15 = `webglRenderer.ts` 18 lines + `lens-blur-render.spec.ts` 91; merge `47cc881` of ledger `8e18a9b`, no rebase; PR #17 Draft). Q00 verified at SHA: tsc 0; vitest 58+2 files / **502 passed / 16 skipped**; dist `index` 691.92 kB / 0 mediabunny refs, `video` 648.85 kB, `frameRenderer` 1.32 kB; blobs 6/6; worktree clean; optical/contracts/Q02 files untouched. Fix: PSF dy negated into a mirrored copy inside the `lensUploadedPlan` guard; depth rows flipped into a scratch Float32Array before the R32F upload (UNPACK_FLIP_Y_WEBGL is spec-ignored for ArrayBufferView uploads and other paths need it false — correct mechanism, comment added); scene v-flip and null-depth fallback untouched. Regression: asymmetric island (cy 0.12, radii 0.2/0.14, feather 0.04, focusPlane 1) at preview+export plus content-independent Pearson correlation of GPU-vs-CPU change maps; tolerances tightened to mean<0.002 / max<0.008 on all tiers, correlation>0.95 on asymmetric, no assertion deleted; lens-off byte-identity retained. Q01 evidence accepted (before fix: asym max 0.1412/0.1626, corr 0.6906/0.7979; after: max 0.003922 = 1.00 LSB, mean ~0.00097, corr 0.99887/0.99862; E2E chromium 13/13 incl. export 5/5). **Q02 independent harness re-run ordered at `47cc881` — that PASS is the G4 gate.**
- 2026-11-28 **Q02 parity re-verification PASS at `47cc881` — G4 CLOSED.** Same 96×64 frame (SHA-256 a4dd210a…de1d6e), same harness, Chromium/Vite 5273, read-only, feature branch untouched `cd9a7d6`. mean/max LSB (before → after): preview null 0.327/7.88 → 0.151/1.00; preview painted depth 1.619/33.60 → 0.201/1.00; export null 0.215/4.27 → 0.181/1.03; export painted depth 1.372/60.69 → 0.217/1.02 — every tier at 8-bit rounding, sole >1.00 is export-null max 1.03 LSB (1 LSB past the rounded reference). y=0.12 probe: GPU top/bottom edge energy 168.78/19.80 vs CPU 168.74/19.45 — focus lands on the painted top region; the old mirrored match no longer aligns. Lens-off byte-identical (max 0); depth-vs-null sign agreement 1.000 in all four tiers without orientation correction (mirror-corrected variants now 0.894–0.915 as expected). No chunk/renderer residual above rounding; Q02-owned paths empty in `fd09757..47cc881`; no edits/commits. **G4 = CP4-06 + CP4-07 (engine+UI) + Q02 parity PASS — all met at `47cc881`.** CP4 code-complete; MASTER_STATUS.md updated (G4 PASS, branch tips). **Q05B activated for one targeted pass at `47cc881`** (changed features + main integration paths; full regression stays at main-merge/release gate). Merge/deploy to `main`/`beta` remains locked pending PO approval; PR #17 stays Draft. Backlog for G4 report: BL-CP4-02 (tiled-export lens blur explicit error), BL-CP4-03 (video lens blur out of scope), ~200 ms re-develop debounce cost, PWA precache 73 entries / ~12.94 MB.
- 2026-11-28 **Q05B targeted pass at `47cc881` — 3 PASS / 1 FAIL.** Read-only, QA worktree clean, fixtures under `.private/`. PASS: gates (tsc 0; build index 0 mediabunny refs; blobs 6/6; vitest reported 397/9 — QA-worktree summary, to be reconciled at re-verification); lens blur integration probe on dev (top island ratio preview 1.58 / export 1.35, compare diff 0, lens-off ratio 1.0000, 0 errors; CP4-08 asym parity mean<0.002/max<0.008/corr>0.95; tiled+active explicit error = BL-CP4-02 accepted); RAW develop (single apply, latest-wins settle, 6000×4000 export all 4 projects, non-RAW unchanged); photo-core spot unchanged. **FAIL — video (2 defects, both from the CP4-05 persistent mount):** (1) trim state leaks across sessions — same-clip close→reopen shows stale '0.00s – 1.50s'; `video-workspace.spec.ts:163` deterministic 3/3; reset effect keys only on `[entryId, getFile]`, `App.tsx:139` mount is unconditional/unkeyed, stale summary satisfies the reopen wait, trim-in clamps at duration 0. (2) lazy boundary defeated at runtime — `video-D3it0tbf.js` 633.6 KiB + `frameRenderer` fetched at app boot: module-scope `bindQ03VideoEngine()` + probe effect `[activeId]` runs with null → `q03Engine.probe()` → dynamic engine import (frameRenderer static via `transcode.ts:26`); static 0-refs check passes, network-level laziness fails. **CP4-09 issued to Q04** (VideoWorkspace-only unless a shell change is proven necessary): guard probe on active session, reset full session state on close/change (incl. activeId), harden the reopen wait in the spec, merge pro-engine `6fd3b50` --no-ff, repeat-each=3, boot network probe; gates + chunk sizes. Then Q01 merges on pro-engine, Q05B re-verifies video items + boot probe at the merged tip, and CP4 closure summary goes to PO. G4 technical gate stands; CP4 closure awaits CP4-09.
