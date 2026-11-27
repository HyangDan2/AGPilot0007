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
- Max 8 group textures (units 2..9 if image=0, LUT=1); Q01 verifies the budget.

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
| geometryOutputSize + 90/270 straighten aspect | Q02 → Q01 | 02A `bd0d352` rejected for straighten sizing; 02A.1 in progress |
| `applyParameterGroups` + new edit groups | Q01 → Q04 | Q01 in progress; Q04 interim direct history write must be replaced |
| geometry/optical/localAdjustments state + actions | Q01 → Q02 | Q01 in progress |
| `planLocalStage` + GLSL chunk | Q02 → Q01 | pending (02E) |
| RAW develop API + `resolveOriginal` | Q03 → Q01/Q04 | Q03 in progress |
| batch resolver compatibility | Q03 → Q04 | pending |

### Approved integrations

| SHA | Branch | Scope | Approved | State |
| --- | --- | --- | --- | --- |
| `bd0d352` | cp3-q02-local | 02A homography only | 2026-11-27 | NOT mergeable until 02A.1 (straighten sizing superseded) |

### Ledger log

- 2026-11-27: 02A reviewed; homography PASS, straighten output sizing REJECTED; ruling §4 at `c4a6a85`; 02A.1 ordered.
- 2026-11-27: Q04 pushed `a487591`, `f51fe99`, `1dda64e` (multi-select shared with batch, copy/paste, per-item retry/unique names/reconciliation). Review: scope OK; interim `commitEditStateToEditor` direct history write must be replaced by Q01's `applyParameterGroups`; geometry/optical/local groups, EXIF/recommend UI and E2E still pending.

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
