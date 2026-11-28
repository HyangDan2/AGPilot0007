# Film Studio v1.0.0 — Browser Support and Limits

Verification basis: Playwright projects in this repo (desktop Chromium, desktop
WebKit, Mobile Chromium / Pixel 7 emulation, Mobile WebKit / iPhone 14
emulation) on an M1 Mac. Performance numbers: Chromium
`channel:'chromium'` (real ANGLE Metal), 3-run medians; see
`docs/phase1/CP5_BASELINE.md`.

## Supported environments

| Environment | Status |
|---|---|
| Desktop Chromium (Chrome/Edge, recent stable) | Supported; primary perf target |
| Desktop WebKit (Safari, recent) | Supported; functional E2E coverage |
| Mobile Chromium, Pixel 7 emulation | Supported in emulation (boot + video ingest tested) |
| Mobile WebKit, iPhone 14 emulation | Supported in emulation |
| Real iOS/Android devices | **UNVERIFIED** (BL-03, post-Beta) |
| Firefox | Not in the test matrix; not claimed |
| Software rendering (SwiftShader / headless shell) | **Not a supported perf target** |

### SwiftShader caveat

Headless Chromium's default shell renders WebGL with SwiftShader. Perf runs on
it are invalid: a 24MP JPEG open measured ~3.5 s vs ~0.33 s with ANGLE Metal,
and its MAX_TEXTURE_SIZE (8192) invalidates large-image tests. Any performance
claim must state the renderer. Where `MAX_TEXTURE_SIZE` matters, Metal reports
16384.

## Image size and memory limits

- **Source stage limit 8192 px.** Images wider or taller than 8192 px skip the
  source stage and use the legacy texture path. A single warning is logged:
  `Source stage skipped: WxH exceeds the 8192px WebGL2 safety limit; using the
  legacy texture path.` There is no tiling for the preview path (BL-08).
- **Tiled export** is available for very large sources; tested at
  17,000×1,200 (1,491 ms, 22 MB floor). Lens-ON tiled export at the same size
  (5 tiles, maxTex 16384) measured ≈1.26 s. Tiled lens export beyond the
  single-pass texture limit is a Phase-2/mobile option (BL-CP5-01), not the
  v1.0.0 RC default.
- **24MP RAW** peaks near 299 MB (BL-06); the accepted CP5 first-paint time is
  ≈706 ms on the 6000×4000 fixture. JPEG 24MP opens in ~250 ms; its warp step
  costs ~190 ms (BL-07).
- **JS heap** budgets: ≤350 MB during export, RAW steady state ≤200 MB. The
  baseline RAW re-open showed heap retention (185 MB warm vs ~135 MB cold);
  the final CP5 run did not re-report a heap figure, so no heap improvement is
  claimed.
- Peak RSS and GPU memory are **UNVERIFIED**: `measureUserAgentSpecificMemory`
  is unavailable because the site is not cross-origin isolated, so only
  `performance.memory` JS-heap floors are reported.

## Mobile

- Mobile support is validated through device emulation only. Touch layout,
  video capability gating and mobile notices are covered by E2E, but real
  thermal throttling, GPU memory limits and iOS Safari behavior are UNVERIFIED.
- RAW preview on Pixel-7 emulation measured ~2.26 s to paint; this is an M1
  emulation number, not a phone number.

## Network behavior (WAN)

All measurements are localhost or a local static server. WAN latency, CDN
behavior and constrained networks are UNVERIFIED.

## PWA install and offline

- The app installs as a PWA (manifest scoped to the build base: `/AGPilot0007/`
  stable, `/AGPilot0007/beta/` beta). Icons: 192, 512, maskable 512.
- Precache covers the app shell, LUTs, thumbnails and lazy chunks. Files are
  served from the service-worker cache in offline mode; a warm start measured
  0 network bytes and 14/14 requests SW-served.
- **Video engine install note:** first install downloads the video engine
  chunk in the background (one SW fetch, not an app boot request) so video
  export works offline. The page itself issues **no video-engine request at
  boot**; the engine loads only when video mode is first opened.
- The identity LUT (`identity.cube`, 947.8 KiB raw / ~209 KiB gzip) stays in
  the precache by ruling: it backs the base profile path and gzip makes the
  install cost small.
- Install transfer after CP5-02: 3,502,282 B (was 4,100,872 B). `social-preview.png`
  is no longer precached (it is an OG image, never read by the app).

## Feature gating

- Video capability lists (container/codec/audio/resolution/bitrate/fps) are
  driven by `VideoEncoder`/`VideoDecoder` probes; unsupported options are
  disabled rather than failing at export.
- On mobile, video options above the device's supported resolution are
  gated with an explicit notice.

## Known limitations at RC

| ID | Limitation |
|---|---|
| BL-03 | Real-device performance and SwiftShader limits (post-Beta) |
| BL-06 | RAW 24MP memory ~299 MB per open |
| BL-07 | 24MP source warp ~190 ms (over 60 fps budget) |
| BL-08 | No tiling for >8192 px preview sources; legacy path + one warning |
| BL-09 | Live settings serialization omits geometry/optical (settings preview only) |
| BL-CP5-01 | Tiled lens export beyond the single-pass texture limit is a Phase-2/mobile option, not enabled by default in the v1.0.0 RC |
