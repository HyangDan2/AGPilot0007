# Q03 Video PoC — generated result tables

## Environment

| 항목 | 값 |
|---|---|
| Browser | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36 |
| WebCodecs APIs | VideoDecoder=yes, VideoEncoder=yes, AudioDecoder=yes, AudioEncoder=yes, VideoFrame=yes, AudioData=yes, ImageDecoder=yes, showSaveFilePicker=yes, FileSystemWritableFileStream=yes |
| hardwareConcurrency | 8 |
| JS heap limit | 4192 MB |
| WebGL2 / renderer | true / ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver) |
| mediabunny encodable video | ["avc","hevc","vp9","av1","vp8"] |
| mediabunny encodable audio | ["aac","opus","pcm-s16","pcm-s16be","pcm-s24","pcm-s24be","pcm-s32","pcm-s32be","pcm-f32","pcm-f32be","pcm-f64","pcm-f64be","pcm-u8","pcm-s8","ulaw","alaw"] |

## WebCodecs capability probes

### videoDecode

| codec | supported | notes |
|---|---|---|
| avc1.42E01E | yes |  |
| avc1.640028 | yes |  |
| hvc1.1.6.L93.B0 | yes |  |
| vp09.00.10.08 | yes |  |
| vp8 | yes |  |
| av01.0.04M.08 | yes |  |

### audioDecode

| codec | supported | notes |
|---|---|---|
| mp4a.40.2 | yes |  |
| opus | yes |  |
| mp3 | yes |  |
| flac | yes |  |

### videoEncode

| codec | supported | notes |
|---|---|---|
| avc1.42001f | yes |  |
| vp09.00.10.08 | yes |  |
| av01.0.04M.08 | yes |  |
| hvc1.1.6.L93.B0 | yes |  |

### audioEncode

| codec | supported | notes |
|---|---|---|
| mp4a.40.2 | yes |  |
| opus | yes |  |

## Input analysis

| File | Container | Duration s | Video codec | Codec string | canDecode | coded px | display px | rotation | VFR | fps | pkts | Audio codec | Audio canDecode |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h264_aac_720p | MP4 | 6 | avc | avc1.64001f | ✅ | 1280×720 | 1280×720 | 0 | no | 30 | 180 | aac | ✅ |
| h264_aac_1080p | MP4 | 10 | avc | avc1.640028 | ✅ | 1920×1080 | 1920×1080 | 0 | no | 30 | 300 | aac | ✅ |
| vp9_opus_720p | WebM | 6 | vp9 | vp09.00.31.08.01.02.02.02.00 | ✅ | 1280×720 | 1280×720 | 0 | yes | 30 | 180 | opus | ✅ |
| hevc_aac_360p | MP4 | 3 | hevc | hvc1.1.6.L63.90 | ✅ | 640×360 | 640×360 | 0 | no | 30 | 90 | aac | ✅ |
| av1_opus_360p | WebM | 4 | av1 | av01.0.01M.08 | ✅ | 640×360 | 640×360 | 0 | yes | 30 | 120 | opus | ✅ |
| h264_silent_720p | MP4 | 6 | avc | avc1.64001f | ✅ | 1280×720 | 1280×720 | 0 | no | 30 | 180 | — | — |
| h264_portrait | MP4 | 4 | avc | avc1.64001f | ✅ | 720×1280 | 720×1280 | 0 | no | 30 | 120 | aac | ✅ |
| h264_rot90 | MP4 | 6 | avc | avc1.64001f | ✅ | 1280×720 | 720×1280 | 270 | no | 30 | 180 | aac | ✅ |
| h264_vfr | MP4 | 6 | avc | avc1.64001e | ✅ | 640×360 | 640×360 | 0 | yes | 21.36 | 126 | aac | ✅ |
| h264_aac_720p_45s | MP4 | 45 | avc | avc1.64001f | ✅ | 1280×720 | 1280×720 | 0 | no | 30 | 1350 | aac | ✅ |

## Decode / grade benchmarks (all frames, no encode)

| File | mode | ok | frames | fps | wall ms | per-frame median ms | p95 ms | max ms | peak heap Δ MB |
|---|---|---|---|---|---|---|---|---|---|
| h264_aac_720p | decode-draw | ✅ | 180 | 281.69 | 639 | 0.1 | 0.3 | 9.5 | 4.7 |
| h264_aac_720p | decode-grade | ✅ | 180 | 229.15 | 786 | 0.1 | 0.2 | 1.1 | 2.9 |
| h264_aac_1080p | decode-draw | ✅ | 300 | 150.3 | 1996 | 0.2 | 0.4 | 3.8 | 10.5 |
| h264_aac_1080p | decode-grade | ✅ | 300 | 128.03 | 2343 | 0.1 | 0.2 | 1.8 | 0.3 |
| vp9_opus_720p | decode-draw | ✅ | 180 | 464.88 | 387 | 0.1 | 0.2 | 3.5 | 0 |
| vp9_opus_720p | decode-grade | ✅ | 180 | 254.67 | 707 | 0.1 | 0.2 | 0.3 | 7.6 |
| hevc_aac_360p | decode-draw | ✅ | 90 | 1404.06 | 64 | 0.1 | 0.2 | 0.3 | 0.8 |
| hevc_aac_360p | decode-grade | ✅ | 90 | 418.99 | 215 | 0.1 | 0.2 | 0.2 | 1.3 |
| av1_opus_360p | decode-draw | ✅ | 120 | 3037.97 | 40 | 0.1 | 0.2 | 2.7 | 0 |
| av1_opus_360p | decode-grade | ✅ | 120 | 1673.64 | 72 | 0 | 0.2 | 0.6 | 0.6 |
| h264_silent_720p | decode-draw | ✅ | 180 | 432.07 | 417 | 0.1 | 0.2 | 0.4 | 3 |
| h264_silent_720p | decode-grade | ✅ | 180 | 269.14 | 669 | 0.1 | 0.2 | 0.2 | 2.4 |
| h264_portrait | decode-draw | ✅ | 120 | 479.42 | 250 | 0.1 | 0.2 | 0.3 | 2.2 |
| h264_portrait | decode-grade | ✅ | 120 | 244.35 | 491 | 0.1 | 0.2 | 0.2 | 1.9 |
| h264_rot90 | decode-draw | ✅ | 180 | 408.53 | 441 | 0.1 | 0.2 | 1.3 | 0 |
| h264_rot90 | decode-grade | ✅ | 180 | 249.38 | 722 | 0.1 | 0.2 | 0.2 | 2.5 |
| h264_vfr | decode-draw | ✅ | 126 | 1188.68 | 106 | 0.1 | 0.2 | 0.4 | 0.7 |
| h264_vfr | decode-grade | ✅ | 126 | 630.63 | 200 | 0.1 | 0.1 | 0.2 | 1.2 |

## LUT transcode + mux (streaming target, no Base64)

| File | ok | codec | codec string | frames | fps | wall ms | peak heap Δ MB | audio pkts copied | output bytes | duration s | A/V start ms | A/V end ms | out video pkts | verify | snapshot | base64 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h264_aac_720p | ✅ | avc | avc1.64001f | 180 | 31.17 | 5775 | 17.6 | 283 | 4281046 | 6 | -21.33 | 0 | 180 | 7/7 ✅ | same/graded 7 | absent |
| h264_aac_1080p | ✅ | avc | avc1.640028 | 300 | 15.2 | 19740 | 24.8 | 470 | 15292735 | 10 | -21.33 | 0 | 300 | 7/7 ✅ | same/graded 5 | absent |
| vp9_opus_720p | ✅ | vp9 | vp09.00.31.08 | 180 | 32.65 | 5514 | 0 | 301 | 2975807 | 6 | -7 | -6 | 180 | 7/7 ✅ | same/graded 7 | absent |
| hevc_aac_360p | ✅ | avc | avc1.64001e | 90 | 107.94 | 834 | 31.3 | 142 | 630564 | 3 | -21.33 | 0 | 90 | 7/7 ✅ | same/graded 7 | absent |
| av1_opus_360p | ✅ | vp9 | vp09.00.31.08 | 120 | 82.39 | 1457 | 0 | 201 | 711702 | 4 | -7 | -6 | 120 | 7/7 ✅ | same/graded 7 | absent |
| h264_silent_720p | ✅ | avc | avc1.64001f | 180 | 34.72 | 5184 | 0 | — | 4183375 | 6 | — | — | 180 | 4/4 ✅ | same/graded 7 | absent |
| h264_portrait | ✅ | avc | avc1.64001f | 120 | 28.89 | 4154 | 1.1 | 189 | 3277341 | 4 | -21.33 | 0 | 120 | 7/7 ✅ | same/graded 5 | absent |
| h264_rot90 | ✅ | avc | avc1.64001f | 180 | 15.85 | 11355 | 28.1 | 283 | 4321310 | 6 | -21.33 | 0 | 180 | 7/7 ✅ | same/graded 215 | absent |
| h264_vfr | ✅ | avc | avc1.64001e | 126 | 111.28 | 1132 | 13.8 | 283 | 1106135 | 6 | -21.33 | 100 | 126 | 7/7 ✅ | same/graded 7 | absent |

## Output target / memory budget probes

| probe | ok | mode | estimate MB | budget MB | chunks | result | peak heap Δ MB |
|---|---|---|---|---|---|---|---|
| buffer-budget-overflow | ❌ | buffer | 25.6 | 1 | 0 | MemoryBudgetError: estimated output 25.6MB exceeds the 1MB memory budget | 0 |
| file-picker-unsupported | ❌ | file-picker | 11 | 512 | 0 | OutputTargetError: file picker dismissed at runtime: AbortError: Failed to execute 'showSaveFilePicker' on 'Window': The user aborted a request. | 0 |
| buffer-under-budget | ✅ | — | — | — | — | output verified | 11.7 |

## Cancel / rerun

| probe | aborted | ok | frames | verification | error | peak heap Δ MB |
|---|---|---|---|---|---|---|
| internal-abort | yes | ❌ | — | — | AbortError: transcode cancelled | 15.5 |
| external-cancel | yes | ❌ | — | — | AbortError: transcode cancelled | 20.5 |
| rerun-after-cancel | no | ✅ | 300 | 7/7 ✅ | — | — |

## Long export (45 s)

| frames | wall ms | fps | per-frame median/p95/max ms | heap slope MB/min | peak heap Δ MB | output bytes | verification |
|---|---|---|---|---|---|---|---|
| 1350 | 79132 | 17.06 | 46.3/130.5/550.6 | -0.68 | 18.8 | 26669627 | 6/6 ✅ |

## Automated assertions

- **ALL PASSED**

## Failures (expected unsupported cases are recorded, never faked)


Generated from results/video/*.json by scripts/summarize-video.mjs
