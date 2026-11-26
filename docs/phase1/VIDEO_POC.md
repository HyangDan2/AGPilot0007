# Q03 Video Engine — CP1 기술 PoC

상태: 2026-11-27 측정 완료 · 브랜치 `feature/phase1-q03-imaging` · PoC 위치 `poc/q03-imaging/`

## 1. 목적과 제약

- WO-44~WO-48(Video Engine)의 CP1 기술 검증. WebCodecs 기반 디코드, WebGL2 LUT 적용, 인코드/먹싱, 오디오 유지와 A/V 동기, 메모리, 데스크톱/iOS 차이를 확인한다.
- 입력 영상은 ffmpeg로 만든 로컬 합성 fixture이며 서버로 전송하지 않는다. 모든 처리는 브라우저 안에서 수행한다.
- Q01 인터페이스 확정 전까지 `src/`의 기존 색상 엔진은 수정하지 않았다. PoC는 `poc/q03-imaging/video.html`에서 수행한다.

## 2. 결론 요약

| 검증 항목 | 결과 | 근거 |
|---|---|---|
| WebCodecs API | ✅ Chromium에서 VideoDecoder/Encoder, AudioDecoder/Encoder, VideoFrame/AudioData, ImageDecoder 모두 존재 | `results/video/capabilities.json` |
| 입력 디코드 | ✅ H.264/AAC, VP9/Opus, HEVC/AAC, AV1/Opus 5종 모두 `canDecode=true` | analysis 표 |
| 프레임 디코드 + WebGL2 LUT | ✅ 전 프레임 처리, 720p/1080p/360p 합성 fixture에서 오류 0 | bench 표, graded 이미지 |
| 인코드/먹싱 | ✅ MP4(H.264/AV1+AAC), WebM(VP9+Opus) 출력 생성, 재입력 검증 통과 | transcode 표 |
| 오디오 유지 | ✅ **재인코딩 없는 패킷 패스스루**. AAC 283/470, Opus 301/201 패킷 복사 | transcode 표 |
| A/V 동기 | ✅ 종료 시점 차이 0ms(MP4), -6ms(WebM). 시작 오프셋 AAC -21.33ms, Opus -7ms (코덱 프라이밍) | transcode 표 |
| 메모리 | ✅ 디코드 피크 0.7~10.5MB, 트랜스코드 피크 4.7~42.8MB | bench/transcode |
| iOS Safari | ⚠️ **문헌 조사만 수행, 실기기 미검증** (§8) | — |
| 정적 배포 | ✅ dist preview에서 analyze + LUT 벤치 재확인, 페이지 오류 0 | §7 |

핵심 판단: WebCodecs + mediabunny 조합으로 "디코드 → WebGL2 LUT → 인코드 + 오디오 무손실 패스스루"의 기술 경로는 성립한다. 다만 성능 수치는 소프트웨어 GL headless 환경이며, iOS Safari의 API/코덱/메모리 제약은 실기기 검증 전까지 "지원"으로 표시하지 않는다.

## 3. 재현 방법

```bash
cd poc/q03-imaging
npm ci
bash scripts/make-fixtures.sh          # ffmpeg 7.1.1 합성 fixture → testdata/video (Git 제외)
node scripts/run-video.mjs             # Chromium + Vite dev 자동 기동, 분석/벤치/트랜스코드
node scripts/summarize-video.mjs
npm run build && npm run preview
```

## 4. 측정 환경

| 항목 | 값 |
|---|---|
| Browser | HeadlessChrome/158 (Playwright Chromium 1254), macOS arm64 |
| WebGL2 | SwiftShader (소프트웨어 ANGLE), maxTextureSize 8192 |
| WebCodecs 인코더 후보(mediabunny) | avc, hevc, vp9, av1, vp8 / aac, opus, PCM 계열 |
| JS heap limit | 4192 MB |
| Fixtures | ffmpeg 7.1.1 합성(컬러바/톤/타임코드), 30fps, AAC/Opus 오디오 포함 |

## 5. 입력 분석과 디코드 벤치

입력 5종 (자세한 값: [`poc/q03-imaging/results/video/TABLE.md`](../../poc/q03-imaging/results/video/TABLE.md)):

| 파일 | 컨테이너 | 해상도 | 코덱 | 오디오 | 길이 | 디코드 가능 |
|---|---|---|---|---|---|---|
| h264_aac_720p | MP4 | 1280×720 | avc1.64001f | AAC 48k 스테레오 | 6s | ✅ |
| h264_aac_1080p | MP4 | 1920×1080 | avc1.640028 | AAC 48k 스테레오 | 10s | ✅ |
| vp9_opus_720p | WebM | 1280×720 | VP9 | Opus 48k 스테레오 | 6s | ✅ |
| hevc_aac_360p | MP4 | 640×360 | hvc1.1.6.L63.90 | AAC 48k 모노 | 3s | ✅ |
| av1_opus_360p | WebM | 640×360 | AV1 | Opus 48k 모노 | 4s | ✅ |

전 프레임 디코드(및 LUT 적용) 벤치:

| 파일 | 모드 | 프레임 | wall fps | wall ms | per-frame 중앙값 | p95 | 최대 | 피크 heap Δ |
|---|---|---|---|---|---|---|---|---|
| h264 720p | draw only | 180 | 215.5 | 835 | 0.1ms | 0.3 | 3.1 | 1.6MB |
| h264 720p | draw + LUT | 180 | 55.2 | 3259 | 0.1ms | 0.3 | 4.5 | 3.0MB |
| h264 1080p | draw only | 300 | 103.4 | 2902 | 0.2ms | 1.0 | 66.4 | 10.5MB |
| h264 1080p | draw + LUT | 300 | 49.4 | 6076 | 0.1ms | 0.3 | 1.2 | 10.3MB |
| vp9 720p | draw only | 180 | 134.1 | 1342 | 0.2ms | 0.5 | 7.2 | 2.4MB |
| vp9 720p | draw + LUT | 180 | 165.6 | 1087 | 0.1ms | 0.3 | 1.3 | 2.0MB |
| hevc 360p | draw only | 90 | 829.5 | 109 | 0.1ms | 0.2 | 5.4 | 0.7MB |
| hevc 360p | draw + LUT | 90 | 62.8 | 1433 | 0.1ms | 0.3 | 0.9 | 1.2MB |
| av1 360p | draw only | 120 | 1267.2 | 95 | 0.1ms | 0.3 | 11.8 | 0.7MB |
| av1 360p | draw + LUT | 120 | 1595.7 | 75 | 0.0ms | 0.2 | 1.1 | 0.9MB |

해석 주의:
- per-frame 시간은 셰이더 제출 구간만 측정되어 매우 작다. wall fps는 디코더 콜백·GPU 백프레셔·SwiftShader 실행을 포함한 처리율이다. 두 값의 차이가 크며, **소프트웨어 GL headless 수치이므로 실기기 GPU 성능의 근거로 사용하지 않는다.**
- VP9/AV1에서 LUT 모드가 draw 모드보다 빠른 역전은 측정 잡음/백프레셔 영향으로 판단한다. 절대값보다 "모든 포맷에서 실시간(30fps) 이상 처리"라는 사실에 의미를 둔다.
- 1080p draw only의 max 66.4ms는 디코더 초기화/첫 프레임 스파이크로 보인다.

## 6. LUT 트랜스코드와 A/V 동기

파이프라인: WebCodecs 디코드 → `VideoFrame` → WebGL2 캔버스(33³ warm-film LUT, strength 0.85) → `CanvasSource` 인코드 → mediabunny mux. 오디오는 `EncodedPacketSink`로 원본 패킷을 읽어 `EncodedAudioPacketSource`로 **재인코딩 없이** 전달한다.

| 입력 | 출력 컨테이너/코덱 | 프레임 | fps | wall ms | 오디오 패킷 | 피크 heap | 출력 크기 | 길이 | A/V 시작 오프셋 | A/V 종료 차 |
|---|---|---|---|---|---|---|---|---|---|---|
| h264 720p | MP4 / AVC | 180 | 13.3 | 13,547 | 283 | 24.5MB | 4.28MB | 6s | -21.33ms | 0ms |
| h264 1080p | MP4 / **AV1** | 300 | 4.3 | 69,160 | 470 | 42.8MB | 11.03MB | 10s | -21.33ms | 0ms |
| vp9 720p | WebM / VP9 | 180 | 14.9 | 12,078 | 301 | 5.1MB | 2.98MB | 6s | -7ms | -6ms |
| hevc 360p | MP4 / AVC | 90 | 37.0 | 2,432 | 142 | 11.0MB | 0.63MB | 3s | -21.33ms | 0ms |
| av1 360p | WebM / VP9 | 120 | 25.9 | 4,632 | 201 | 4.7MB | 0.71MB | 4s | -7ms | -6ms |

- 출력은 다시 mediabunny `Input`으로 열어 코덱·길이·첫 비디오/오디오 타임스탬프·패킷 수를 재검증했다. 전 항목 성공.
- AAC 시작 오프셋 -21.33ms는 AAC 인코더 프라이밍(1024 samples @48kHz) 특성이며, Opus의 -7ms도 프리롤 차이다. WebM 종료 -6ms는 Opus 트랙 길이(5.994s)와 비디오(6s)의 표현 차이로, 컨테이너 메타데이터상의 차이이며 재생 동기 깨짐으로 단정하지 않는다(실기기 재생 확인 필요).
- 출력 영상의 graded 스냅샷에서 LUT 적용이 육안 확인된다(`results/video/images/*_graded.jpg`).
- 인코드 fps는 소프트웨어 GL + SwiftShader + 단일 스레드 환경의 수치다. AV1 1080p 4.3fps는 실시간이 아니며, 하드웨어 가속 환경에서는 달라질 수 있다. 실기기 측정 전까지 "실시간 인코드 가능"으로 표시하지 않는다.

### 6.1 인코더 선택 로직의 한계 (수정 필요 항목)

`pickCodec`은 `avc1.42001f`(Baseline L3.1) 고정 문자열로 지원 여부를 묻는다. 1080p에서는 이 레벨이 거부되어 AV1로 폴백했고, 그 결과 1080p 출력이 MP4/AV1이 되었다. 제품화 시 해상도/프레임레이트에 맞는 프로파일·레벨 문자열(예: 1080p30 `avc1.640028`)을 계산해 질의해야 한다. 이번 PoC에서는 **폴백 동작이 정직하게 기록**되었으므로 결과를 그대로 남긴다.

## 7. 정적 배포 확인

- `npm run build` 산출물을 `vite preview`로 서빙하고 720p H.264를 analyze/bench: `avc`, 1280×720, 30fps, audio `aac`, `canDecode=true`, draw+LUT 180프레임 성공, 페이지 오류 0.
- 서버·모델·외부 API 없이 정적 호스팅만으로 동작한다. 코드는 mediabunny(MPL-2.0)와 브라우저 WebCodecs만 사용한다.
- video 청크 609.7kB(gzip 160.1kB). 재생/트랜스코드에 별도 WASM을 쓰지 않는다.

## 8. iOS Safari / 기기별 지원 (문헌 조사, 실기기 미검증)

| 항목 | 데스크톱 Chromium (이번 PoC 검증) | iOS Safari (문헌 기준) | 상태 |
|---|---|---|---|
| VideoDecoder/VideoEncoder | ✅ | Safari 16.4+ (iOS 16.4+) | 문헌만, 실기기 미검증 |
| AudioDecoder/AudioEncoder | ✅ | Safari 26.0+ (iOS 26.0+) | 문헌만, 실기기 미검증 |
| H.264 decode/encode | ✅ | 지원 | 문헌만 |
| HEVC decode | ✅ (헤드리스) | 지원(기기/OS 의존) | 문헌만 |
| VP9/AV1 decode | ✅ | 기기·OS 의존(AV1은 최신 기기 위주) | 미검증 |
| WebGL2 | ✅ (SwiftShader) | 지원 | 문헌만 |

- iOS 26 미만에서는 AudioDecoder가 없어 **오디오 디코드/재인코딩이 불가**하다. 이 경우 ① 오디오 트랙을 그대로 복사하는 컨테이너 먹싱(패스스루)만 제공하거나, ② 브라우저 `<video>`+MediaRecorder 폴백을 검토해야 한다. 단, 이번 PoC는 두 폴백을 구현·검증하지 않았다.
- 기기별 지원 판정은 `VideoDecoder.isConfigSupported`, `AudioDecoder.isConfigSupported`, `MediaCapabilities.decodingInfo`로 런타임에 수행하고, 미지원 포맷은 **선택 불가로 표시**해야 한다(⑪). PoC의 `capabilities()`가 이 구조를 보여준다.
- iOS 메모리 한도, 백그라운드 전환, 오디오 세션, 4K 디코드 여부는 미검증이다.

## 9. 한계와 미해결

- 실기기(iOS/Android) 검증 없음. 모든 성능 수치는 headless 소프트웨어 GL 환경.
- 회전 메타데이터(displayWidth/Height)는 분석했으나, 트랜스코드 시 회전 변환은 적용하지 않았다.
- 가변 프레임레이트(VFR) 입력, B프레임 재정렬, HDR/10-bit, 자막/다중 오디오 트랙은 미검증.
- 오디오 패스스루는 원본 패킷의 타임스탬프를 유지하지만, 컨테이너별 프라이밍 표현 차이(§6)의 재생 동기는 실기기 확인이 필요하다.
- 인코더 프로파일/레벨 자동 선택 로직은 미구현(§6.1).
- LUT는 PoC용 합성 warm-film LUT이며, 제품 LUT/필름 프로필과의 연결은 Q01 인터페이스 확정 후 진행한다.

## 10. 산출물

| 경로 | 내용 |
|---|---|
| `poc/q03-imaging/video.html`, `src/video/main.ts` | 분석/벤치/트랜스코드 러너, WebGL2 LUT 파이프라인, capability probe |
| `poc/q03-imaging/scripts/run-video.mjs` | 자동 측정 드라이버 |
| `poc/q03-imaging/scripts/make-fixtures.sh` | ffmpeg 합성 fixture 생성(재현용) |
| `poc/q03-imaging/results/video/TABLE.md` | 전체 측정 표 |
| `poc/q03-imaging/results/video/*.json` | capability/analysis/bench/transcode 원시값 |
| `poc/q03-imaging/results/video/images/` | 원본/graded 스냅샷 |
| `poc/q03-imaging/results/video/out_*` | 트랜스코드 출력(용량 관계로 Git 제외, 재생성 가능) |
| `docs/phase1/Q03_SUPPORT_MATRIX.md` | 디코드/인코드 매트릭스 |
| `docs/phase1/Q03_LICENSE_REVIEW.md` | 라이선스 검토 |
