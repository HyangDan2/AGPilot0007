# Film Studio v1.0.0 — Release Notes

Release candidate documentation for Film Studio (AGPilot0007), HD2Lab.
App version: **1.0.0** (`package.json`). No version bump is proposed in CP5.

Status: **RC draft**. Numbers marked `TBD-CP5-FINAL` are not yet accepted by Q00
and must be replaced before publication. No deployment happens in CP5 without
PO approval (see `DEPLOY_PLAN_BETA.md`).

## Highlights since 0.x

### CP2 — Engine foundation

- WebGL2 render pipeline with a source stage, optical stage and grade stage.
- Film simulation: 9 built-in film profiles (FS-001 … FS-009) driven by 3D LUTs,
  plus optical simulation of density/contrast behavior.
- RAW development: FlashRaw decode of camera RAW, white balance, exposure,
  highlight recovery in a develop panel.
- Workspace: film strip, import (JPEG/PNG/RAW/HEIC via browser decode),
  single and batch export.

### CP3 — Professional editing

- Geometry: crop, rotate and framing with live preview.
- Masks and local adjustments: linear/radial masks, local exposure/contrast.
- Extended grade controls: curves, sharpening, color mixer, camera profile.
- RAW edit path integrated with the same grade stack as raster images.
- Workspace: copy/paste of settings, batch export, EXIF viewer, film
  recommendation, image integrity checks.
- Recipe schema v9 (conditional).

### CP4 — Lens blur and video

- Lens blur (develop stage): depth/PSF-based background blur with lens preview.
- Video workspace: open a clip, scrub/trim, inspect capabilities, export with
  the active film grade applied (mediabunny/WebCodecs).
- Recipe schema v10 (conditional).
- Lazy video engine: the video engine and renderer are loaded only when video
  mode is opened; a photo-only boot issues **0** video-engine requests.

### CP5 — Performance and delivery

Measured changes accepted so far (M1 Mac, Chromium `channel:'chromium'` with ANGLE
Metal, 3-run medians; full method in `PWA_UPDATE_VERIFICATION.md` and
`docs/phase1/CP5_BASELINE.md`):

| Item | Before | After | Status |
|---|---|---|---|
| PWA precache entries | 73 | 53 | accepted |
| Install transfer (precache) | 4,100,872 B | 3,502,282 B (−14.6%) | accepted |
| Precache raw size | 24,082.93 KiB | 12,459.7 KiB | accepted |
| photo-only boot video-engine requests | — | 0 | accepted |
| SW update activation | — | PASS (`controllerchange`) | accepted |
| Develop settle (release → stable) | 1,710 ms | `TBD-CP5-FINAL` (target ≤500 ms) | Q03 in progress |
| First-session open (24MP) | 1,260 ms | `TBD-CP5-FINAL` (target ≤800 ms) | Q01 in progress |
| Lens-ON tiled export | 1,543 ms / 307.8 MB (24MP lens export) | `TBD-CP5-FINAL` (target ≤2.5 s, heap ≤150 MB) | Q02 in progress |

Performance budget reference (confirmed by Q00):

- TTI p95 ≤ 250 ms; JPEG 24MP open ≤ 400 ms; RAW open ≤ 1,000 ms.
- First session ≤ 1,500 ms; develop settle ≤ 500 ms.
- Exports: 24MP ≤1 s, lens-ON ≤2.5 s, tiled ≤3 s, video clip +1 s.
- JS heap: ≤350 MB during export, RAW steady state ≤200 MB.

### Compatibility notes

- Recipe files: read versions 1–10; write v8 by default, v9/v10 when newer
  features are active. See `RECIPE_COMPATIBILITY.md`.
- Browsers: desktop Chromium and WebKit; mobile profiles emulated only.
  Real-device validation is UNVERIFIED. See `SUPPORT_AND_LIMITS.md`.

### Known limitations at RC

- Source stage is skipped for images wider or taller than 8192 px (one warning,
  legacy texture path) — BL-08.
- 24MP RAW open takes about 1.7–1.9 s and peaks near 299 MB — BL-06.
- 24MP source warp costs about 190 ms — BL-07.
- Peak RSS/GPU memory, real-device mobile and WAN behavior are UNVERIFIED
  (cannot be measured in the current harness).
