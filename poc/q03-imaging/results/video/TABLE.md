# Q03 Video PoC — generated result tables

## Environment

| 항목 | 값 |
|---|---|
| Browser | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36 |
| WebCodecs APIs | VideoDecoder=yes, VideoEncoder=yes, AudioDecoder=yes, AudioEncoder=yes, VideoFrame=yes, AudioData=yes, ImageDecoder=yes |
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

| File | Container | Duration s | Video codec | Codec string | canDecode | px | fps | pkts | Audio codec | Audio canDecode |
|---|---|---|---|---|---|---|---|---|---|---|
| h264_aac_720p | MP4 | 6 | avc | avc1.64001f | ✅ | 1280×720 | 30 | 180 | aac | ✅ |
| h264_aac_1080p | MP4 | 10 | avc | avc1.640028 | ✅ | 1920×1080 | 30 | 300 | aac | ✅ |
| vp9_opus_720p | WebM | 6 | vp9 | vp09.00.31.08.01.02.02.02.00 | ✅ | 1280×720 | 30 | 180 | opus | ✅ |
| hevc_aac_360p | MP4 | 3 | hevc | hvc1.1.6.L63.90 | ✅ | 640×360 | 30 | 90 | aac | ✅ |
| av1_opus_360p | WebM | 4 | av1 | av01.0.01M.08 | ✅ | 640×360 | 30 | 120 | opus | ✅ |

## Decode / grade benchmarks (all frames, no encode)

| File | mode | ok | frames | fps | wall ms | per-frame median ms | p95 ms | max ms | peak heap Δ MB |
|---|---|---|---|---|---|---|---|---|---|
| h264_aac_720p | decode-draw | ✅ | 180 | 215.47 | 835 | 0.1 | 0.3 | 3.1 | 1.6 |
| h264_aac_720p | decode-grade | ✅ | 180 | 55.23 | 3259 | 0.1 | 0.3 | 4.5 | 3 |
| h264_aac_1080p | decode-draw | ✅ | 300 | 103.39 | 2902 | 0.2 | 1 | 66.4 | 10.5 |
| h264_aac_1080p | decode-grade | ✅ | 300 | 49.37 | 6076 | 0.1 | 0.3 | 1.2 | 10.3 |
| vp9_opus_720p | decode-draw | ✅ | 180 | 134.14 | 1342 | 0.2 | 0.5 | 7.2 | 2.4 |
| vp9_opus_720p | decode-grade | ✅ | 180 | 165.64 | 1087 | 0.1 | 0.3 | 1.3 | 2 |
| hevc_aac_360p | decode-draw | ✅ | 90 | 829.49 | 109 | 0.1 | 0.2 | 5.4 | 0.7 |
| hevc_aac_360p | decode-grade | ✅ | 90 | 62.79 | 1433 | 0.1 | 0.3 | 0.9 | 1.2 |
| av1_opus_360p | decode-draw | ✅ | 120 | 1267.16 | 95 | 0.1 | 0.3 | 11.8 | 0.7 |
| av1_opus_360p | decode-grade | ✅ | 120 | 1595.74 | 75 | 0 | 0.2 | 1.1 | 0.9 |

## LUT transcode + mux

| File | ok | codec | frames | fps | wall ms | per-frame median ms | p95 ms | encode await median ms | audio pkts copied | peak heap Δ MB | output | output bytes | duration s | A/V start offset ms | A/V end delta ms | out video pkts | out audio pkts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h264_aac_720p | ✅ | avc | 180 | 13.29 | 13547 | 48.5 | 120.2 | 48.3 | 283 | 24.5 | out_h264_aac_720p.mp4 | 4281030 | 6 | -21.33 | 0 | 180 | 283 |
| h264_aac_1080p | ✅ | av1 | 300 | 4.34 | 69160 | 163.5 | 530.2 | 160.5 | 470 | 42.8 | out_h264_aac_1080p.mp4 | 11026134 | 10 | -21.33 | 0 | 300 | 470 |
| vp9_opus_720p | ✅ | vp9 | 180 | 14.9 | 12078 | 48.7 | 186.4 | 48.6 | 301 | 5.1 | out_vp9_opus_720p.webm | 2975739 | 6 | -7 | -6 | 180 | 301 |
| hevc_aac_360p | ✅ | avc | 90 | 37.01 | 2432 | 17.6 | 43.4 | 17.3 | 142 | 11 | out_hevc_aac_360p.mp4 | 630556 | 3 | -21.33 | 0 | 90 | 142 |
| av1_opus_360p | ✅ | vp9 | 120 | 25.9 | 4632 | 25.8 | 94.2 | 25.4 | 201 | 4.7 | out_av1_opus_360p.webm | 711710 | 4 | -7 | -6 | 120 | 201 |

## Failures (expected unsupported cases are recorded, never faked)


Generated from results/video/*.json by scripts/summarize-video.mjs
