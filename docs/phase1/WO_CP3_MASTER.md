# WO-P1-CP3 — Professional Editing (Master)

Issued: 2026-11-27 KST · Owner: Q00 Supervisor
Baseline: `feature/phase1-pro-engine` @ `38b070e` (code `6973126`); `main` `b850f82`, `beta` `d8ec276` untouched.
Policy: Lean Engineering v1.1 — reuse CP2 PASS evidence, no re-verification of closed work, backlog non-blocking defects, execute without approval waits.
Scope guard: no AI, no backend, no upload, no new inference. Static web/local only.
Merge policy: no `main`/`beta` merge and no deployment until explicit PO approval.

## CP3 Goal

CP2 engine becomes usable professional editing: framing/geometry applied in preview and export, local masks with per-mask adjustments, RAW develop path on linear data, workspace multi-select/copy-paste/EXIF/recommendation wired to real UI. Every feature must be usable in the real UI and preview must equal export.

## Contract Deltas (Q00-approved, Q05 re-audits at G3)

### 1. Recipe v9 — Q01

- `RECIPE_SCHEMA_V9 = 9`; `RECIPE_SCHEMA_MAX = 9`; `CURRENT_SCHEMA_VERSION = 9`.
- `CustomRecipe` gains optional `optical?: OpticalTransform` and `localAdjustments?: LocalAdjustmentState`.
- v9 is written only when v9 features exist:
  `writeV9 = localAdjustmentsActive(localAdjustments) || (optical && !opticalIsIdentity(optical))`.
  Otherwise keep writing v8 (rollback safety: CP2 app still opens v8-only recipes).
- v9 record: `schemaVersion: 9`, required geometry wrapper with the existing v8 rules (unknown geometry fields rejected), optional `optical` validated by `validateOpticalTransform`, optional `localAdjustments` validated by `validateLocalAdjustments`, top-level unknown keys rejected.
- Read stays v1–v9: v1–v7 migrate in memory (unchanged), v8 unchanged, v9 normalized. A record with `schemaVersion < 9` that carries `optical`/`localAdjustments` is rejected (`Unexpected v9 field in recipe`).
- `applyRecipe` restores geometry, optical, and localAdjustments; save uses current geometry/optical/local state (never `IDENTITY_GEOMETRY` constants).
- Perspective is stored in `optical.perspective` + `homography` (existing frozen optical contract). Geometry contract is unchanged.

### 2. Mask truncation report — Q02 (amends frozen `masks.ts`, authorized)

- Add `MASK_LIMITS = { masks: MAX_MASKS, strokes: MAX_STROKES, points: MAX_STROKE_POINTS }`.
- Add `normalizeMasksDetailed(value): { masks: MaskData[]; dropped: { masks: number; strokes: number; points: number } }`.
- `normalizeMasks` delegates to the detailed variant; no other behavior change; `validateMasks` stays strict.
- UI/import must surface `dropped` (toast/notice). Creating masks in the UI beyond limits is blocked with an explicit message. No silent truncation anywhere.

### 3. Local stage seam — Q02 implements, Q01 integrates (frozen for CP3)

```ts
// src/engine/local/maskRaster.ts
export interface LocalStageGroup { adjustment: LocalAdjustmentValues; opacity: number; blend: MaskBlend }
export interface LocalStagePlan {
  width: number; height: number;
  groups: LocalStageGroup[];       // same order as state.groups
  masks: HTMLCanvasElement[];      // one per group, index-aligned; coverage in RGB
}
export function planLocalStage(input: {
  state: LocalAdjustmentState;
  width: number; height: number;
  corrected: CanvasImageSource;    // source-stage output (corrected NIS, pre-color)
}): LocalStagePlan | null;
export const LOCAL_STAGE_FRAGMENT: string; // GLSL ES 3.00, shared by preview and export
```

- Order: after Color Lab, before detail (`LOCAL_ADJUSTMENT_EXECUTION_ORDER`).
- `plan === null` → renderer path byte-identical to CP2.
- Preview builds the plan at preview size; export at export size; identical math and mask basis (`corrected-nis`).
- Max 8 group textures; mask canvases bind at **texture unit 5** (image=0, LUT=1, date=2, curves=3, graded detail=4), i.e. units 5..12 for 8 groups; Q01 clamps group count to `MAX_TEXTURE_IMAGE_UNITS - 5` (min-16 devices allow 8).

### 4. Geometry sizing semantics — Q00 ruling on CP3-02A

- Straighten is **cover / auto-crop**: it must NOT change output dimensions. The CP2 shader zooms (`scale` divisor) so no empty borders appear; expanding the canvas would stretch the image.
- `geometryOutputSize = (rotation 90/270 ? swapped source dims : source dims) × crop`, rounded once per axis.
- Crop is applied in post-straighten output NIS (forward order: flip → rotate → straighten → crop), matching `q02_geometry_output_to_source`.
- Straighten uses the **post-rotation aspect** (swap aspect for 90/270) in both the GLSL chunk and the CPU mirror. Parity tests must cover rotation 90 + straighten + crop.
- `contracts/geometry.ts`'s crop comment may be clarified (comment-only change, approved).

### 5. RAW develop seam — Q03 implements, Q01/Q04 integrate

- No `imageBuffer` contract change. RAW metadata/file handle is kept inside `src/engine/raw/*` (WeakMap keyed by `DecodedSource`).
- `DecodedImage` gains optional `resolveOriginal?: () => Promise<HTMLImageElement>`; RAW sets `originalElement` to the preview canvas and provides a full-res resolver. JPEG path unchanged.
- `imageExporter` resolves the original before rendering; export dimensions come from true `originalWidth/Height`.

## Branches

| Agent | Branch | Base | PR |
| --- | --- | --- | --- |
| Q01 | `feature/phase1-pro-engine` (continue) | — | #17 Draft |
| Q02 | `feature/phase1-cp3-q02-local` | pro-engine | new Draft |
| Q03 | `feature/phase1-cp3-q03-raw` | pro-engine | new Draft |
| Q04 | `feature/phase1-cp3-q04-workspace` | pro-engine | new Draft |

PRs #18/#19/#20 remain Draft/subsed. Q01 performs serial merges into pro-engine only after Q00 approval. No engineer merges another branch.

## Shared Ledger Rules (PO directive 2026-11-27)

- This file is the common ledger when cross-session messaging is limited. Every engineer fetches pro-engine and reads the latest version **before starting work that depends on another agent**.
- Q00 alone appends/updates this ledger. Engineers do not edit it.
- Only SHAs listed under **Approved integrations** may be merged into pro-engine, by Q01 with `git merge --no-ff <sha>`, without further approval (PO directive: Q00 manages integration autonomously).
- A report claiming a push is not integration approval; Q00 verifies the remote SHA and code first.

### Dependencies

| Dependency | Route | State |
| --- | --- | --- |
| geometryOutputSize + 90/270 straighten aspect | Q02 → Q01 | 02A.1 `3f5f25d` VERIFIED; approved for merge |
| Geometry/mask UI mounting | Q02 → Q01 | Q02 ships prop-driven components (`ce06ccd` verified); only Q01 can mount them in Viewport/AdjustmentPanel |
| `applyParameterGroups` + new edit groups | Q01 → Q04 | DONE: Q04 `294990e` commits through `applyParameterGroups` with geometry/optical/localAdjustments groups |
| geometry/optical/localAdjustments state + actions | Q01 → Q02 | `6f363c1` on pro-engine (state, history, v9, `applyParameterGroups`); UI wiring by Q02 02C |
| `planLocalStage` + GLSL chunk | Q02 → Q01 | DELIVERED `2e7e1b6` (verified); Q01 must inject the fragment, bind mask textures, cache plans per state/size |
| Mask UI mounting + state sync | Q02 → Q01 | maskUiStore owns editing (`local`/`setLocal`); Q01 mounts MasksWorkspace/MaskListPanel/MaskOverlay and mirrors into `editorStore.localAdjustments` (undo/recipe) without loops |
| RAW develop API + `resolveOriginal` | Q03 → Q01/Q04 | `a18bc08` VERIFIED + Q03 CP3-03 reported complete (retained 92.56 MB, parity mean 1.101/p99 7); approved for merge; Q01 wiring: `openRawForEditing` in store, `resolveDecodedImageOriginal` in exporter, no silent fallback |
| batch resolver compatibility | Q03 → Q04 | `resolveDecodedImageOriginal(image)` available in `a18bc08`; Q04 to use it in batch |

### Integration orders (Q01 — read before continuing)

1. Push `3da2368` and `6550aa0`, then merge Q02 branch tip `a08cbd2` with `--no-ff` (contains `3f5f25d`, `ce06ccd`, `2e7e1b6`, docs-only `394a965`/`9c78983`, tests `cf0fe63`, helpers `a08cbd2`). Optional but recommended: drop `localStageSeam.ts`'s duplicated base-5 constant in favour of `LOCAL_STAGE_TEXTURE_BASE` / `localStageTextureBudget` / `localStageCacheKey` from `src/engine/local/maskRaster.ts`; the renderer should use the budget helper for the `MAX_TEXTURE_IMAGE_UNITS - 5` clamp and append the output size to the cache key (key covers state only).
1b. Merge Q04 branch tip `ff8a2a4` with `--no-ff` (adds the batch resolver guard test on top of `294990e`).
2. Renderer local stage: inject `LOCAL_STAGE_FRAGMENT` (`src/engine/local/maskRaster.ts`) after Color Lab and before detail; mask canvases bind to texture units starting at **5** (ruling), clamp groups to `MAX_TEXTURE_IMAGE_UNITS - 5` (min-16 devices allow 8); upload `localStageAdjustmentUniforms`, `localStageBlendCode`, opacity and count; build the plan once per (`localAdjustments`, output size) via `planLocalStage({state,width,height,corrected})` — never per frame; null plan keeps the CP2 path byte-identical.
3. Mount the geometry and mask UI (all currently unimported). Exact exports at `cf0fe63` (verified by Q00 in source; no adapters needed):
   - `GeometryOverlay` (`src/components/geometry/GeometryOverlay.tsx`): `{ geometry, onChange(patch: Partial<GeometryTransform>), onDragStart?, onDragEnd?, hidden?, className? }`. Note the prop is `hidden`, NOT `disabled` (hidden = compare/original view). Emits patches only; full-frame crop normalizes to `null`. Wire `onChange` → `setGeometry({...geometry, ...patch}, false)` (no history during drag), `onDragEnd` → `setGeometry(useEditorStore.getState().geometry, true)` — verified: `commit=false` only sets state; `commit=true` pushes one snapshot and `pushSnapshot` dedupes against the history top, so one undo step per gesture and no phantom entry if the value returns to start. `onDragStart` needs no store call.
   - `geometryOverlayAspect(geometry, sourceAspect)` (same module): while crop editing is active the preview frame must be sized to this aspect so overlay and image share one coordinate space.
   - `GeometryPanel` (`src/components/geometry/GeometryPanel.tsx`): `{ geometry, optical, onGeometryChange(patch), onOpticalChange(transform|null), onCommitStart?, onCommitEnd?, disabled? }` — buttons already bracket with `onCommitStart/onCommitEnd`; reset perspective emits `null` (maps to `resetOptical`). During sliders: `onGeometryChange`/`onOpticalChange` → `set*(next, false)`, commit on `onCommitEnd`.
   - `MaskControls` (`src/components/masks/MasksWorkspace.tsx`): `{ disabled?, className? }`, bound to `maskUiStore`; drop into the side panel. `MaskEditingOverlay` (same module): `{ aspect, hidden?, className?, onDragStart?, onDragEnd? }`, bound to the selected group; drop over the viewport (`aspect` = output width/height).
   - Mask history policy (deterministic, no transaction API exists): every `maskUiStore.local` → `editorStore.localAdjustments` push uses `setLocalAdjustments(next, false)` with an equality guard; commit (`setLocalAdjustments(current, true)`) on `MaskEditingOverlay.onDragEnd`, and on any discrete action (toggle/add/remove/select-driven edit) immediately. For continuous `MaskControls` sliders without a gesture signal, commit after a 300–500 ms idle debounce. `editorStore.localAdjustments` changes (undo/recipe/`applyParameterGroups`) push back into `maskUiStore.setLocal` with the same equality guard, and must not re-enter the editorStore subscription.
   - `planLocalStage` consumes `editorStore.localAdjustments` directly and returns `null` when inactive, so nothing changes for the CP2 path until a mask group exists. Pass group masks into `RenderSettings.masks`.
4. E2E 5173: rotate+crop+straighten+perspective edit -> export parity; radial mask + exposure -> export parity at mask center/edge; identity byte-equal regressions for both.

### Approved integrations

| SHA | Branch | Scope | Approved | State |
| --- | --- | --- | --- | --- |
| `bd0d352` | cp3-q02-local | 02A homography only | 2026-11-27 | Superseded by `3f5f25d`; do not merge separately |
| `3f5f25d` | cp3-q02-local | 02A + 02A.1 (perspective homography, cover sizing, derived-size parity) | 2026-11-27 | APPROVED — merge `--no-ff` |
| `a18bc08` | cp3-q03-raw | CP3-03 RAW develop seam, memory accounting, matrix validation | 2026-11-27 | APPROVED — merge `--no-ff` (engine only; app wiring is Q01) |
| `ce06ccd` | cp3-q02-local | 02C crop overlay + geometry/perspective panel (new components only) | 2026-11-27 | APPROVED — merge `--no-ff`; NOT yet user-visible until Q01 mounts |
| `294990e` | cp3-q04-workspace | CP3-04 follow-ups on `applyParameterGroups`, 10 groups, batch/handler fixes | 2026-11-27 | APPROVED — merge `--no-ff` after Q01's current push |
| `2e7e1b6` | cp3-q02-local | 02D masks + 02E local stage seam (maskRaster, mask UI, masks.ts delta 2) | 2026-11-27 | APPROVED — merge `--no-ff` |
| `394a965` | cp3-q02-local | docs-only: crop comment (post-straighten output NIS) | 2026-11-27 | APPROVED — comment-only, no behavior change |
| `9c78983` | cp3-q02-local | docs-only: mask texture base 5 ruling in `maskRaster`/POC doc | 2026-11-27 | APPROVED — comment/doc-only; branch tip for Q01 |
| `cf0fe63` | cp3-q02-local | test-only: zero flow, stroke overlap union, feather scaling | 2026-11-27 | APPROVED — test-only |
| `a08cbd2` | cp3-q02-local | `LOCAL_STAGE_TEXTURE_BASE`/`localStageTextureBudget`/`localStageCacheKey` helpers + tests (additive exports only) | 2026-11-27 | APPROVED — merge `--no-ff`; branch tip for Q01 |
| `ff8a2a4` | cp3-q04-workspace | CP3-04 test-only: batch must pass the decoded image to the shared exporter resolver (no preview read) | 2026-11-27 | APPROVED — merge `--no-ff`; Q04 branch tip |

### Ledger log

- 2026-11-27: 02A reviewed; homography PASS, straighten output sizing REJECTED; ruling §4 at `c4a6a85`; 02A.1 ordered.
- 2026-11-27: Q04 pushed `a487591`, `f51fe99`, `1dda64e` (multi-select shared with batch, copy/paste, per-item retry/unique names/reconciliation). Review: scope OK; interim `commitEditStateToEditor` direct history write must be replaced by Q01's `applyParameterGroups`; geometry/optical/local groups, EXIF/recommend UI and E2E still pending.
- 2026-11-27: Ledger published at `3473234`; distributed to Q01–Q04. Q01 told to publish `applyParameterGroups` signature early and to merge only ledger-listed SHAs (`git merge --no-ff`). Q02 ordered to run 02A.1 → 02B without separate approval. Q03 asked to push the develop API + `resolveOriginal` early. Q04 follow-ups: replace interim history write, add geometry/optical/local groups, EXIF/recommend UI + E2E, `uniqueFilename` consistency test, failed-open selection case.
- 2026-11-27: Q04 reviewed scope accepted as interim; follow-up items 1–5 outstanding (see above log entry).
- 2026-11-27: Q02 `3f5f25d` (02A.1) verified by Q00: no straighten expansion, rotated-aspect mapping in `geometryMappings` reused by uniforms + CPU mirror, `tests/e2e/source-stage-output-size.spec.ts` covers rotation 90 + straighten + crop + perspective with parity and no-stretch checks; 8 unit tests re-run PASS. Approved for Q01 merge.
- 2026-11-27: Q02 `2e7e1b6` verified at SHA: tsc 0; 36 tests PASS (local-mask-raster 14, masks-limits 7, cropGeometry 7, output-size 8). Masks delta 2 truncation reporting ok. Approved. Ruling: mask masks texture base 5 (units 5..12 for 8 groups); Q01 must clamp group count to `MAX_TEXTURE_IMAGE_UNITS - 5` (min-16 devices allow 8).
- 2026-11-27: Q01 pushed `59bd0bf`: geometry-derived preview/export dims, typed `resolveDecodedImageOriginal` (failures propagate), RAW open via `openRawForEditing`. Verified by Q00 locally: tsc 0, 42 tests PASS. Note: Q01 rebased the approved `3f5f25d`/`a18bc08` onto the ledger tip; patch-ids match (040d14e…, f6cf726…), so approval carries over, but future integrations must use `--no-ff` and never rewrite pushed history.
- 2026-11-27: Q04 `294990e` verified by Q00 at SHA: tsc 0; 72 tests PASS across 8 q04 suites. Interim direct history write replaced by `applyParameterGroups` (all groups incl. geometry/optical/localAdjustments); failed-open selection revert tested; `renamePrepared` no longer mutates prepared and duplicate names agree; batch uses the shared exporter. Approved for merge.
- 2026-11-27: Q02 `ce06ccd` verified: 15 unit tests PASS, tsc clean, no shared-file edits. Components are prop-driven; mounting is Q01's (allowlist). Ledger note added.
- 2026-11-27: Q03 CP3-03 report: `a18bc08`, no blocker; fixtures local-only/untracked; bundle index 543.93 kB, lazy raw 61.35 kB; integration steps in PR #23 body. Q03 now idle, on standby for exporter E2E after Q01 wiring.
- 2026-11-27: Q01 pushed `6f363c1` to pro-engine (state/history/v9/`applyParameterGroups`, render settings + backend source stage). Verified locally at `36813a7`: tsc 0, 89 tests PASS (cp3Core 12, recipeCompat 15, q04Workspace 20, engineContractCorrective 32, retro90 10). Gaps ordered: preview/export dims from `geometryOutputSize`, exporter resolver must not swallow failures, use typed `resolveDecodedImageOriginal`, RAW open via `openRawForEditing`, local stage inert until 02E. Accepted cross-owner edit `src/poc/q04/editStateAdapter.ts` (schema max 9); Q04 must not revert.
- 2026-11-27: Q03 `a18bc08` verified by Q00 at SHA: tsc 0; `rawDevelop`/`rawColorMatrix`/`rawMemory`/`rawParity` 13 tests PASS incl. real 6000x4000 DNG retained set ≤128 MiB and preview/full parity (mean 1.10, p99 7). Approved for merge as engine seam; Q01 owns `openRawForEditing` wiring and exporter resolver use.
- 2026-11-27: Q02 tips `394a965` (crop comment) and `9c78983` (texture-base-5 comment in `maskRaster` + POC doc) verified docs-only (`2e7e1b6..9c78983` = 3 files, comment/doc lines only). No behavior change; approval carries. Integration order updated: Q01 merges Q02 branch tip `9c78983`. Q02 standby for integration defects.

## File Allowlist (no out-of-list edits; request via Q00)

- **Q01:** `src/stores/editorStore.ts`, `src/stores/recipeStore.ts`, `src/engine/contracts/recipeV8.ts`, `recipeValidation.ts`, new `recipeV9.ts`, `src/types/film.ts`, `src/components/Viewport.tsx`, `ExportModal.tsx`, `AdjustmentPanel.tsx`, `src/engine/pipeline/*`, `src/engine/renderer/*`, `src/engine/export/imageExporter.ts`, `src/engine/contracts/renderPlan.ts` (local stage id only if required).
- **Q02:** `src/engine/optical/*`, `src/engine/contracts/masks.ts`, new `src/engine/local/*`, new `src/components/geometry/*`, new `src/components/masks/*`, new `src/stores/maskUiStore.ts`, `docs/phase1/OPTICAL_POC.md`. No shared-file edits.
- **Q03:** `src/engine/raw/*`, `src/engine/image/decoder.ts` (type + RAW resolver only), new `src/types/rawDevelop.ts`, `tests/raw*`.
- **Q04:** `src/components/Workspace.tsx`, `src/components/q04/*`, `src/components/Header.tsx`, `src/App.tsx`, `src/stores/workspaceStore.ts`, `src/poc/q04/*`, new `src/components/exif/*`, new `src/components/recommend/*`.
- **Q05:** QA only, no product edits.

## Work Orders

### CP3-01 Q01 — Foundation, framing parity, local seam, v9

1. Editor state: `geometry`, `optical`, `localAdjustments` + setters with history commit semantics; extend `EditorSnapshot`; reset on `setImage`; undo/redo restores all groups.
2. BL-09: Viewport and Export pass `geometry`/`optical`/`localAdjustments`; canvas/display/export dimensions come from Q02 `geometryOutputSize(geometry, srcW, srcH)`; identity geometry is pixel-identical to CP2.
3. Recipe: v8 round-trip with real geometry; v9 per delta 1; lossless round-trip tests; explicit rejects; rollback rule.
4. Local seam: backend accepts `LocalStagePlan`, applies it after color and before detail; null plan unchanged; cache reset on geometry/mask changes.
5. API for Q04: single-history `applyParameterGroups(patch)` covering adjustments/film/curves/camera/colorMixer/sharpening/geometry/optical/localAdjustments.
6. RAW integration: `resolveOriginal` in exporter; when `rawSource` is present, shader exposure/temperature/tint are not double-applied (Q03 defines semantics).
7. Tests: unit for state/history/recipe; E2E rotate→crop→straighten then export and compare preview vs export (tolerance); identity regression.

### CP3-02 Q02 — Geometry UI, masks, local stage

1. 02A (first push): `homographyFromPerspectiveQuad` + `createPerspectiveTransform(vertical, horizontal)` (optical contract shapes), `geometryOutputSize`, unit tests; notify Q00/Q01.
2. 02B: sourceStage parity at geometry-derived output sizes (preview/export); straighten bounding-box rules; perspective round-trip tests.
3. 02C: real UI overlay (new components, driven by Q01 state): crop rect handles, 90° rotate, flip, straighten slider, perspective vertical/horizontal sliders + reset; pointer/touch/keyboard; hidden in compare/original.
4. 02D: mask engine: brush/linear/radial/luminance/color rasterization with feather, invert, opacity, blend; brush flow must be resolution-independent and identical in preview/export; mask overlay; mask list UI (add/delete/rename/enable/invert/blend/opacity); per-mask group adjustments (exposure/color/etc.); truncation report + explicit capacity errors.
5. 02E: `planLocalStage` + `LOCAL_STAGE_FRAGMENT` per delta 3; parity tests preview vs export; texture-budget guard.
6. Tests: rasterizer unit tests (flow 0/1, overlap, feather scaling), GLSL smoke via headless WebGL2, E2E paint mask → adjust → export parity.

### CP3-03 Q03 — RAW edit path, matrix validation, memory

1. Develop model (new `rawDevelop`): exposure EV, WB temperature/tint → camera multipliers from metadata (`whiteBalance`, `dng.asShotNeutral`, `colorMatrices`), highlight recovery (`off | blend | reconstruct`), deterministic normalize/validate.
2. Preview path decodes/develops a half-size linear source via flashraw options (`linear-rgb`, `sampleType:'f16'`, WB multipliers, exposure, highlights); full-res only at export through `resolveOriginal` with identical develop parameters.
3. Memory: opening 24MP RAW retains no full-res canvas and ≤128 MB accounting (file handle + half-size linear + preview). Document the measurement method; regression test.
4. Camera color matrix validation: assert metadata provenance (`colorMatrices.source`), forward/XYZ matrices finite and finite-conversion tests on synthetic patches; explicit documented fallback when absent; no silent assumption.
5. Preserve supported extensions/errors/budgets; JPEG path untouched; batch export uses the resolver.
6. Tests: develop math, memory accounting, parity (downscaled export vs preview within tolerance), existing RAW suites green.

### CP3-04 Q04 — Workspace, copy/paste, batch, EXIF, recommendation, integrity

1. Multi-select: `workspaceStore` selection set + anchor; WorkspaceStrip click/shift/cmd, range select, visual states; BatchExportHost uses the shared selection (remove local-only selection).
2. Selective copy/paste: choose groups (film/tone/grain/curves/camera/colorMixer/sharpening/geometry/optical/localAdjustments); paste to all selected photos through `applyParameterGroups`/bridge without opening each; undoable for the active photo; persistent per-photo sessions.
3. Batch UI: real selection, progress %, cancel all/per-item, retry failed per item and bulk; reconciliation selected = rendered + failed + cancelled; unique filenames; saved-result verification.
4. EXIF search/filter UI: text, camera/lens, ISO range, date range, sort; open result; index mounted in workspace.
5. Film recommendation UI: analyze selected/current photo locally (existing PoC), show top-3 with reasons, one-click apply; no network.
6. Save accounting: `persistRecipes` returns success, read-back verification, errors surfaced to UI (no swallowed failures); batch delivery verify.
7. Tests: E2E multi-select copy/paste, batch start/cancel/retry, EXIF filter, recommendation apply; unit for selection/reconciliation.

### CP3-05 Q05 — G3 (after Q00 call)

Independent fresh-clone QA at final integration SHA: full unit/perf/build, single full E2E run, contract blob record (masks amended), deleted-test diff, preview/export parity samples, real-UI screenshots, 0 blocking defects.

## Acceptance (all engineers)

- Feature usable in the real UI, not engine-only.
- Preview and export match (pixel tolerance documented per feature).
- Existing Film Studio behavior preserved (full E2E green).
- No AI/new backend; no `main`/`beta` merge; no deployment.
- No deleted/weakened tests; `tsc` 0; targeted E2E on your own port (5173/5273/5373/5473), single slot, `PW_REUSE_SERVER` unset, logs in `.private/e2e-logs/<agent>/`.
- Remote HEAD == local HEAD; report PR URL/number, Base, Head SHA, tests.

## Reporting Format

`Progress / Completed / Test Result / Blocker / Next Action` — no reports longer than needed, no re-verification of CP2 evidence.
- 2026-11-27: Q04 `ff8a2a4` verified by Q00 at SHA in verify worktree: tsc 0; `tests/q04Batch.test.ts` 25 PASS, incl. new guard that batch hands the decoded image (not `originalElement`) to `prepare` and does not resolve full-res itself (resolution belongs to the shared exporter). Branch tip also carries pro-engine merges already on pro-engine, content-neutral. Approved for `--no-ff` merge.
- 2026-11-27: Q02 `cf0fe63` verified by Q00 at SHA: tsc 0; `tests/local-mask-raster.test.ts` 16 PASS (adds zero-flow no-paint, stroke union 0.75, feather band widening). Test-only delta past `9c78983`; Q02 is on standby again. Minor cosmetic: one `it(...)` line has the first statement on the same line (no behavior impact); not worth a rewrite. Integration target now `cf0fe63`.
- 2026-11-27: Ledger §3 texture-budget line corrected to base unit 5 (`MAX_TEXTURE_IMAGE_UNITS - 5` clamp); it previously said units 2..9, contradicting the log ruling. Q02 spotted it; superseded text removed.
- 2026-11-27: Q02 reported a prop-contract compatibility check against `6f363c1` (no code change). Q00 verified the signatures in source at `cf0fe63` (overlay onChange/onDragStart/onDragEnd; panel onGeometryChange/onOpticalChange/onCommitStart/onCommitEnd; reset perspective → `null`). Wiring table added to integration order 3 so Q01 does not need adapters. Q02's offer of a store-bound geometry wrapper declined — mounting is Q01's; Q02 stays standby.
- 2026-11-27: Found and fixed two wiring errors in ledger order 3 before Q01 could hit them: (a) overlay prop is `hidden`, not `disabled`; (b) there is no `MasksWorkspace` export — public components are `MaskControls` (panel, store-bound) and `MaskEditingOverlay` (viewport, props `aspect/hidden/className/onDragStart/onDragEnd`). Added `geometryOverlayAspect` sizing requirement and an explicit mask history policy (commit=false during gestures; commit on drag end, discrete actions, 300–500 ms idle debounce; equality guards both directions).
- 2026-11-27: Q02 `a08cbd2` verified by Q00 at SHA: tsc 0; `tests/local-mask-raster.test.ts` 18 PASS. Additive exports only (`LOCAL_STAGE_TEXTURE_BASE=5`, budget clamp `min(8, units-5)` with NaN→0, deterministic sorted-key cache key that filters disabled groups/masks and returns `null` when inert). No behavior change to existing seam. Approved; integration target now `a08cbd2`. Guidance: Q01 may import these instead of duplicating constants; `localStageCacheKey` covers state only, so append the output size for the per-(state,size) plan cache.
- 2026-11-27 (integration hazard): Q01's local branch had been ahead of origin with unpushed merges `3da2368` (ce06ccd) and `6550aa0` (294990e) plus local commit `154d4dd` (UI mount). Observed in Q01's worktree: `rebase (start): checkout origin/feature/phase1-pro-engine` with conflicts `UU src/engine/optical/geometry.ts`, `AA tests/geometry-output-size-perspective.test.ts`. Root cause: origin already carries the same 02A.1 content as `116cf27` (patch-identical to `3f5f25d`), so replaying/merging the Q02 branch re-applies identical hunks. Required end state (governance rule): approved SHAs land as `--no-ff` merge commits, not flattened replays. Guidance for Q01: do not resolve the rebase into a flattening history; abort it (`git rebase --abort`), `git reset --hard origin/feature/phase1-pro-engine`, then merge `a08cbd2` and `ff8a2a4` with `--no-ff`; for the conflicting 02A.1/test hunks take the Q02 branch side (`-X theirs` is acceptable ONLY for those two paths, and re-run tsc/tests at the merge commit). Then cherry-pick the local UI-mount commit (reflog `154d4dd`) and any later local-stage commits on top, and re-run the E2E set. If a merge marker is lost, a follow-up empty `--no-ff` merge of the exact tip is acceptable to restore parentage. Nothing is lost: `154d4dd` is recoverable from reflog.
