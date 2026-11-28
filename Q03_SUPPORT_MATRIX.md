# Q03 Video Export — Support Matrix (CP4-03)

Scope: the in-browser video export pipeline in `src/engine/video/**`
(WebCodecs decode → frame renderer → encode → mediabunny mux). Everything runs
locally; no upload, no backend, no AI.

Runtime probing is the source of truth: `probeVideoCapabilities()` calls
`VideoDecoder`/`VideoEncoder.isConfigSupported` (with the concrete AVC/VP9
profile strings used for the export) and mediabunny's
`getEncodableVideoCodecs()`. A browser is only offered a path the probe passes.
The table below records what was verified in this phase versus what is inferred.

## Verified browsers (this phase)

| Browser / platform | Decode H.264 | Encode AVC (MP4) | Encode VP9 (WebM) | Audio passthrough | AAC re-encode | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium (Playwright bundled, headless, macOS arm64) | yes | yes (64001e/64001f/640028) | yes | yes (AAC→MP4, Opus→WebM, byte-identical) | n/a (passthrough used) | E2E `tests/e2e/video-export.spec.ts` — 7/7 |
| Chrome / Edge desktop ≥ 94 (WebCodecs encode) | yes | yes (probed) | yes (probed) | yes (probed) | yes when `AudioEncoder` exists | inferred from Chromium |
| Android Chrome | yes | device-level probe | device-level probe | codec-pair dependent | `AudioEncoder` present on most builds | not run in this phase |

## Gated / degraded paths (honest status)

| Browser / platform | Status | Behaviour |
| --- | --- | --- |
| Safari / iOS **< iOS 26** | **AudioDecoder absent** → no decoded-audio path | Passthrough only: AAC stays AAC inside MP4 (no decode needed). `audioMode: 'aac'` requests degrade to `'none'` with a warning. Video encode requires Safari's WebCodecs `VideoEncoder`; if absent, the export button is disabled by the capability probe. |
| Safari / iOS 26+ | `AudioDecoder` present | Re-encode path becomes available, but was **not** exercised in this phase; treat as probe-dependent. |
| Firefox | Not verified | Export is offered only if the runtime probe passes both `VideoEncoder` and the container codec. AAC re-encode path is gated on `AudioDecoder` + `AudioEncoder`. |
| Any browser without `VideoEncoder` | Unsupported | `probeVideoCapabilities()` returns all-false; UI must disable export. `startVideoExport` rejects with `VideoCapabilityError('unsupported-codec')`. |
| Any browser without `VideoDecoder` | Unsupported | `canDecode: false`; open/export rejects with `decode-unavailable`. |

Notes:
- **Containers are tied to codecs**: AVC → MP4, VP9 → WebM. Mismatches fail fast
  (`unsupported-container`) before any output byte is written.
- **Audio is never silently dropped**: passthrough requires the source codec to be
  muxable into the target container (AAC/MP3 → MP4, Opus/Vorbis → WebM). Anything
  else falls back to AAC **only inside MP4 and only with both audio codecs
  present**; otherwise the track is removed with an explicit warning in
  `result.audio.warning`.
- **Audio passthrough is byte-exact**: packets are copied with shifted timestamps
  only (trim), and the SHA-256 of copied source packets equals the SHA-256 of the
  audio packets re-read from the produced file (asserted in E2E).
- **Rotation/orientation**: display orientation is baked into the encoded frames
  (rotation/flip applied per sample), and output dimensions follow the
  display-oriented size.
- **Trim**: both edges snap to the frame grid, minimum one frame, verified exact
  within one frame in E2E.
- **Memory**: a pre-flight estimate (encoded size + 3 RGBA frame surfaces) is
  checked against a heap-derived budget (30 % of `performance.memory` limit,
  capped 512 MB, default 256 MB if unknown). Over-budget exports reject with
  `MemoryBudgetError` before writing.
- **Streaming**: the engine writes chunked output through `StreamTarget`; no
  whole-file Base64 exists in the product path. An external
  `WritableStream` (e.g. File System Access) can be supplied to avoid holding
  the full file in memory.
- **Cancel**: `handle.cancel()` rejects with `AbortError`, cancels the muxer and
  disposes decoders; a retried export in the same page succeeds (E2E covered).

## Known limitations

- VFR sources are re-timed to the nominal `fps` in the output metadata; frame
  timestamps come from the source samples.
- Very large outputs (long 1080p+ exports) depend on encoder backpressure; the
  `BufferTarget`-equivalent in-memory path is bounded by the memory budget, so
  long exports should use the external streaming target once the UI wires it.
- Hardware vs software encode selection is delegated to the browser; the probe
  accepts whatever `isConfigSupported` reports.
