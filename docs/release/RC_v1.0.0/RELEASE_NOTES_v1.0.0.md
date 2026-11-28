# Film Studio v1.0.0 — Release Notes

Release candidate documentation for Film Studio (AGPilot0007), HD2Lab.
App version: **1.0.0** (`package.json`). No version bump is proposed in CP5.

Status: **RC**. Final CP5 numbers are accepted (evidence tip `da97ba6`), measured
serially on the M1 box while idle (load 1.5–3.5), headless Chromium with ANGLE
Metal, 3-run medians. No deployment happens in CP5 without PO approval (see
`DEPLOY_PLAN_BETA.md`).

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

Measured on the same environment as above; final numbers from the serial run at
`da97ba6` (full method in `PWA_UPDATE_VERIFICATION.md` and
`docs/phase1/CP5_BASELINE.md`):

| Item | Before | Final | Status |
|---|---|---|---|
| PWA precache | 73 entries / 24,082.93 KiB | 53 entries / 12,346.27 KiB | final |
| Install transfer (precache) | 4,100,872 B | 3,502,282 B (−14.6%) | accepted (CP5-02) |
| Photo-only boot video-engine requests | — | 0 | final |
| Cold TTI proxy | 75 ms | ≈74 ms (budget ≤250 ms) | final |
| Warm TTI (SW) | 62.3 ms | ≈52 ms; warm transfer 0 B | final |
| Cold boot payload | 321.5 KB / 13 requests | ≈323 KB body / 13 resources | final |
| Develop settle after slider release (EV / WB) | 1,710 ms | 270 / 269 ms (budget ≤500 ms) | final |
| RAW first open (6000×4000 → first paint sd>3) | 1,260 ms (24MP first session) | ≈706 ms (budget ≤1,000 ms) | final |
| Lens 24MP PNG single-pass export | 1,543 ms (lens ON) | ≈1.9 s (budget 2.5 s) | final |
| Lens-ON tiled export above texture limit | 1,491 ms (17,000×1,200, no lens) | ≈1.26 s (17,000×1,200, 5 tiles, maxTex 16384) | final |
| Slider drag p95 | 33.3 ms | 33.3–33.4 ms | at the boundary — baseline class, not a win |
| SW update activation | — | PASS (`controllerchange`) | accepted |

Notes on the numbers:

- The slider p95 sits exactly at the 33.3 ms frame-interval boundary; it is
  reported as unchanged, not as an improvement. (The UX metric,
  dispatch→frame p95, remains ≤16 ms.)
- Lens-ON export at 24MP previously measured a 307.8 MB memory floor; peak heap
  was not re-reported in the final serial run, so no heap win is claimed here.
- Photo-only boot makes 0 video-engine requests. The service worker still
  fetches the video chunk once at install (offline enablement) — see
  `SUPPORT_AND_LIMITS.md`.
- Real iOS/Android device numbers and MAUM heap remain UNVERIFIED
  (`crossOriginIsolated=false`, JS-heap floors only); mobile emulation is not
  device silicon.

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
- Tiled lens export beyond the single-pass texture limit is a Phase-2/mobile
  option (BL-CP5-01), not the v1.0.0 RC default.
- 24MP RAW memory remains the constraint at ~299 MB per open (BL-06); the
  accepted first-paint time is ≈706 ms.
- 24MP source warp costs about 190 ms — BL-07.
- Peak RSS/GPU memory, real-device mobile and WAN behavior are UNVERIFIED
  (cannot be measured in the current harness).
