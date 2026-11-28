# CP5 Baseline — Performance Measurement (CP5-01)

Measured at `8d30e9c` (code `ea4974b`). Baseline only: no optimization, no feature or renderer changes.
Environment: Apple M1, 8 cores, 8 GB RAM, macOS 15.7.9; Playwright Chromium (`channel: 'chromium'`, new headless, ANGLE Metal M1, MAX_TEXTURE_SIZE 16384, `--enable-precise-memory-info`); viewport 1440×900 DPR 1; mobile = Pixel-7 emulation; load average 2.3–4.7 across runs (contention noted, ±10–15% noise). Playwright's default headless shell (SwiftShader) is invalid for perf and was rejected (JPEG 24MP open 3.5 s vs 0.33 s on Metal).
Prod bundle via `vite preview` (start/open); dev server only where `/src` imports were instrumented (slider latency, exports, memory cycles). Medians of 3 unless noted; paint = workspace-canvas screenshot with luminance sd > 3.

Fixtures: `jpeg24.jpg` 6000×4000 (436,643 B), `jpeg12.jpg` 4000×3000 (343,734 B), `R0000357.DNG` 6000×4000 (33,374,940 B), `clip1080.mp4` 1920×1080 30 fps 2 s.

| Item | Metric | Result | Method |
|---|---|---|---|
| Cold start | TTI proxy (DCL + double rAF) | 128.8 ms (123.1 / 128.8 / 224.3); DCL 72.8 ms | fresh context; FCP entries unavailable in new headless |
| Cold start | Initial JS/CSS | index 195.7 KB + CSS 14.0 KB transfer; 321.5 KB / 13 requests; first session +218.3 KB LUT | resource timing |
| Cold start | Precache | 73 files / 24,082.93 KiB raw (12,937.85 KiB compressed); dist 39.32 MiB | dist/sw.js manifest + build report |
| Warm start (SW) | TTI proxy / network | 62.3 ms (51.4 / 62.3 / 66.4), DCL 29.0 ms; **0 bytes transferred**, 14/14 SW-served, 1.81 MiB body | SW-controlled reloads |
| Photo 12MP | open → paint; full develop pass | 309 ms cold / 201 ms re-open; 402 ms JPEG (232 KB), 309 ms PNG (10.9 MB) | file input; prepareExportImage at scale 1 |
| Photo 24MP | open → paint; full develop pass | 326 ms cold / 248 ms re-open (first session 1,260 ms); 569 ms JPEG (557 KB) | same |
| RAW 6000×4000 | decode → panel / paint / heap | cold 752 ms (742 / 752 / 896), paint 872 ms, heap 135.4 MB; warm 750 ms (713 / 750 / 769), heap 139.1 MB | develop-panel appears on decode; performance.memory @50 ms |
| Mobile emulation | RAW panel / paint | 1,817 / 2,257 ms (M1 emulation — layout only) | Pixel-7 device profile |
| Slider latency | dispatch → next frame | p50 3.0–6.2 ms, p95 12.6–16.8 ms (one 32.2 ms outlier); develop slider p50 6.0 / p95 14.2 ms | pointermove timestamp → first rAF tick, 2 s drag |
| Slider frame tail | frame interval p95 | 16.8 ms typical; occasional 33.3 ms (~5 % frames at 30 fps) | rAF interval log |
| Preview FPS | continuous 2 s drag, 2048×1365 preview | 24MP lens off 63.9 / lens on 61.3; 12MP lens off 61.2 / lens on 62.1; plain 58.0–64.9 range; RAW develop 60.9 | frames / drag window |
| Export 24MP | lens off / lens on | 569 ms (557 KB, 22.4 MB heap floor) / 1,543 ms (489 KB, 307.8 MB floor) | prepareExportImage JPEG q0.9 |
| Export 12MP | JPEG / PNG | 402 ms (232 KB) / 309 ms (10.9 MB) | same |
| Export tiled | 17,000×1,200 (> MAX_TEXTURE_SIZE) | 1,491 ms, 168 KB, 22.1 MB floor | tiled path forced by dimensions |
| Export video | 1080p 2 s graded mp4/avc | 2,144 ms, 60 frames, 2.41 MB, graded path, 39.7 MB floor | startVideoExport, FS-001 |
| Memory growth | 10× edit → export → GC | base 12.04 MB → cycle 1/5/10 = 12.98 / 12.97 / 12.97 MB (CDP usedSize); jsHeap 18.15 → 19.09 flat | CDP HeapProfiler.collectGarbage each cycle |
| Develop settle | release → stable preview | 1,710 ms after pointer-up (≈200 ms debounce + redevelop) | canvas screenshot stability |

## Top 5 bottlenecks (measured impact → proposed fix → estimated gain)

1. **RAW develop settle 1.71 s** after slider release, while drag stays 60 fps → cut debounce (~200→60–80 ms) and render a low-res proxy immediately while the full develop runs → est. −1.0–1.3 s perceived.
2. **First image open in a fresh session 1.26 s** vs 0.33 s warm → warm the pipeline/LUT during idle after shell load → est. −0.6–0.9 s.
3. **Lens-blur full-res export 1.54 s and +308 MB JS heap** (2.7× lens-off) → release plan depth/PSF buffers and mask canvases right after GPU upload, reuse across passes → est. −0.2–0.4 s, −100–200 MB heap floor.
4. **Slider frame tail p95 33.3 ms** with optical+local at 2048 px (dispatch latency stays ≤16 ms) → cache rasterized mask canvases keyed on mask geometry only (`localStageCacheKey` currently folds adjustment values in, re-rasterizing 2.8 M px per tick) → est. p95 ≈ 20 ms.
5. **Mobile-emulated RAW open 2.26 s** → show an embedded preview right after metadata decode, before full develop → est. −0.5–0.9 s perceived (needs on-device validation).

## UNVERIFIED (environment limits)

- Precise peak memory: `performance.measureUserAgentSpecificMemory` absent (`crossOriginIsolated` false); `performance.memory` is JS-heap only and timers starve under load (2 samples / 1.5 s on lens export). Heap values are floors; GPU/worker memory not observable.
- FCP: paint entries empty under new headless; TTI proxy used instead.
- Real-device mobile performance: Pixel-7 emulation runs on M1; layout/DPR only.
- WAN cold load: measured on localhost; precache manifest measured from the built service worker instead.

Artifacts (git-ignored): `.private/perf/{measure-preview,measure-start,measure-slider2,measure-memory,measure-mobile}.mjs` and matching `*-result*.json`.
