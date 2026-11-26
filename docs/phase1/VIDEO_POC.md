# Q03 Video Engine — CP1 기술 PoC

상태: CP1 2026-11-27 측정 · CP1.1 교정 2026-11-27 · 브랜치 `feature/phase1-q03-imaging` · PoC 위치 `poc/q03-imaging/`

## 1. 목적과 제약

- WO-44~WO-48(Video Engine)의 CP1 기술 검증. WebCodecs 기반 디코드, WebGL2 LUT 적용, 인코드/먹싱, 오디오 유지와 A/V 동기, 메모리, 데스크톱/iOS 차이를 확인한다. CP1.1(IMG-02/04/05/07/08)에서 스트리밍 출력·동적 코덱 선택·취소/재실행·A/V 자동 검증을 추가했다.
- 입력 영상은 ffmpeg로 만든 로컬 합성 fixture이며 서버로 전송하지 않는다. 모든 처리는 브라우저 안에서 수행한다.
- Q01 인터페이스 확정 전까지 `src/`의 기존 색상 엔진은 수정하지 않았다. PoC는 `poc/q03-imaging/video.html`에서 수행한다.

## 2. 결론 요약

| 검증 항목 | 결과 | 근거 |
|---|---|---|
| WebCodecs API | ✅ Chromium에서 VideoDecoder/Encoder, AudioDecoder/Encoder, VideoFrame/AudioData, ImageDecoder 모두 존재 | `results/video/capabilities.json` |
| 입력 디코드 | ✅ H.264/AAC, VP9/Opus, HEVC/AAC, AV1/Opus + 무음/세로/회전/VFR/45초 10종 모두 `canDecode=true` | analysis 표 |
| 프레임 디코드 + WebGL2 LUT | ✅ 전 프레임 처리, 720p/1080p/360p 합성 fixture에서 오류 0 | bench 표, graded 이미지 |
| 인코드/먹싱 | ✅ MP4(AVC 720p/1080p/360p/세로/회전/VFR/45s), WebM(VP9) 출력 생성, 재입력 검증 통과 | transcode 표 |
| 오디오 유지 | ✅ **재인코딩 없는 패킷 패스스루**. AAC 283/470/142/189, Opus 301/201 패킷 복사, SHA-256 일치 | transcode 표 |
| 동적 코덱/레벨 선택 (IMG-04) | ✅ 해상도·fps·비트레이트로 프로파일/레벨 계산. 720p `avc1.64001f`(L3.1), 1080p `avc1.640028`(L4.0), 360p `avc1.64001e`(L3.0) | transcode 표 `encoder` |
| Streaming 출력 (IMG-02) | ✅ `StreamTarget` + harness WritableStream으로 출력 파일 직접 기록. 제품 경로에서 Base64 변환 **없음** (`outputBase64: "absent"`) | budget probe |
| 파일 저장 런타임 감지 | ✅ `showSaveFilePicker`/FileSystemWritable 감지, 파일 선택기 거부 시 `OutputTargetError`로 구조화 오류 반환 | budget probe `file-picker-unsupported` |
| 메모리 예산 초과 | ✅ 1MB 예산에서 `MemoryBudgetError: estimated output 25.6MB exceeds the 1MB memory budget` | budget probe |
| 장시간 Export 메모리 | ✅ 45초(1350프레임)에서 heap slope −0.68 MB/min, 샘플 20.6~31.7MB(증가 없음) | `long_export.json` |
| 취소/재실행 (IMG-07) | ✅ 내부 abort·외부 `cancelRun()` 모두 `AbortError`로 중단·해제, 직후 1080p 재실행 성공 | `cancel.json` |
| A/V·오디오 자동 검증 (IMG-08) | ✅ 프레임/패킷 수, 시작·종료 오프셋(입력 기준 보존), 오디오 패킷 SHA-256 일치, 출력 독립 디코드·타임스탬프 단조성 | transcode `outputVerification` |
| 동일 프레임 스냅샷 (IMG-05) | ✅ 10종 전부 `sameFrameVerified=true`, LUT 적용 확인(`gradingApplied=true`), 픽셀 diff 기록 | transcode `snapshotVerification` |
| iOS Safari | ⚠️ **문헌 조사만 수행, 실기기 미검증** (§8) | — |
| 정적 배포 | ✅ dist 빌드 성공. CP1에서 preview 서빙 analyze + LUT 벤치 재확인(오류 0) | §7 |

핵심 판단: WebCodecs + mediabunny 조합으로 "디코드 → WebGL2 LUT → 스트리밍 인코드 + 오디오 무손실 패스스루"의 기술 경로는 성립하며, 45초 Export까지 메모리가 증가하지 않는다. 다만 성능 수치는 소프트웨어 GL headless 환경이며, iOS Safari의 API/코덱/메모리 제약은 실기기 검증 전까지 "지원"으로 표시하지 않는다.

## 3. 재현 방법

```bash
cd poc/q03-imaging
npm ci
npm run verify                         # tsc --noEmit + Q01 계약/어댑터 테스트 + 계약 SHA sync
bash scripts/make-fixtures.sh          # ffmpeg 7.1.1 합성 fixture 10종 → testdata/video (Git 제외)
node scripts/run-video.mjs             # Chromium + Vite dev 자동 기동, 분석/벤치/트랜스코드/예산/취소/장시간 + assertion
node scripts/summarize-video.mjs
npm run build && npm run preview
```

- 스위치: `VIDEO_FILES=...`(선택 파일만), `VIDEO_SKIP_BENCH=1`, `VIDEO_SKIP_BUDGET=1`, `VIDEO_SKIP_CANCEL=1`, `VIDEO_SKIP_LONG=1`. 실패 시 `results/video/assertions.json`에 기록되고 exit 1.
- 자동화 출력 경로: `page.exposeFunction('__q03Sink')`로 Node fs 스트림을 제공한다. **제품 경로에는 Base64 버퍼가 없고**, 하네스도 chunk를 그대로 파일 위치에 쓴다(`outputBase64: "absent"`).
- 측정 중 `src/`를 수정하면 Vite HMR 리로드로 실행이 중단된다.

## 4. 측정 환경

| 항목 | 값 |
|---|---|
| Browser | HeadlessChrome/158 (Playwright Chromium 1254), macOS arm64 |
| WebGL2 | SwiftShader (소프트웨어 ANGLE), maxTextureSize 8192 |
| WebCodecs 인코더 후보(mediabunny) | avc, hevc, vp9, av1, vp8 / aac, opus, PCM 계열 |
| JS heap limit | 4192 MB |
| Fixtures | ffmpeg 7.1.1 합성(컬러바/톤/타임코드), 30fps, AAC/Opus 오디오 포함 |

## 5. 입력 분석과 디코드 벤치

입력 10종 (자세한 값: [`poc/q03-imaging/results/video/TABLE.md`](../../poc/q03-imaging/results/video/TABLE.md)):

| 파일 | 컨테이너 | 해상도 | 코덱 | 오디오 | 길이 | 디코드 가능 |
|---|---|---|---|---|---|---|
| h264_aac_720p | MP4 | 1280×720 | avc1.64001f | AAC 48k 스테레오 | 6s | ✅ |
| h264_aac_1080p | MP4 | 1920×1080 | avc1.640028 | AAC 48k 스테레오 | 10s | ✅ |
| vp9_opus_720p | WebM | 1280×720 | VP9 | Opus 48k 스테레오 | 6s | ✅ |
| hevc_aac_360p | MP4 | 640×360 | hvc1.1.6.L63.90 | AAC 48k 모노 | 3s | ✅ |
| av1_opus_360p | WebM | 640×360 | AV1 | Opus 48k 모노 | 4s | ✅ |
| h264_silent_720p | MP4 | 1280×720 | avc1.64001f | 없음 | 6s | ✅ |
| h264_portrait | MP4 | 720×1280 | avc1.64001f | AAC 48k 모노 | 4s | ✅ |
| h264_rot90 | MP4 | 1280×720 + rotation 270° (표시 720×1280) | avc1.64001f | AAC 48k 모노 | 6s | ✅ |
| h264_vfr | MP4 | 640×360 | avc1.64001e | AAC 48k 모노 | 6s (126프레임) | ✅ |
| h264_aac_720p_45s | MP4 | 1280×720 | avc1.64001f | AAC 48k 모노 | 45s (1350프레임) | ✅ |

- VFR fixture는 30fps 소스에서 10프레임 중 3프레임을 제거한 가변 간격(33.3/133.3ms)이며, 패킷 타임스탬프가 B프레임 때문에 디코드 순서와 다르다. CP1.1에서 VFR 판별을 "정렬된 타임스탬프 기준"으로 수정해 CFR 파일이 VFR로 오판되던 오류를 바로잡았다(무음/45s/720p 모두 `vfr=false`, VFR fixture만 `true`).

전 프레임 디코드(및 LUT 적용) 벤치:

| 파일 | 모드 | 프레임 | wall fps | wall ms | per-frame 중앙값 | p95 | 최대 | 피크 heap Δ |
|---|---|---|---|---|---|---|---|---|
| h264 720p | draw only | 180 | 281.7 | 639 | 0.1ms | 0.3 | 9.5 | 4.7MB |
| h264 720p | draw + LUT | 180 | 229.2 | 786 | 0.1ms | 0.2 | 1.1 | 2.9MB |
| h264 1080p | draw only | 300 | 150.3 | 1996 | 0.2ms | 0.4 | 3.8 | 10.5MB |
| h264 1080p | draw + LUT | 300 | 128.0 | 2343 | 0.1ms | 0.2 | 1.8 | 0.3MB |
| vp9 720p | draw only | 180 | 464.9 | 387 | 0.1ms | 0.2 | 3.5 | 0MB |
| vp9 720p | draw + LUT | 180 | 254.7 | 707 | 0.1ms | 0.2 | 0.3 | 7.6MB |
| hevc 360p | draw only | 90 | 1404.1 | 64 | 0.1ms | 0.2 | 0.3 | 0.8MB |
| hevc 360p | draw + LUT | 90 | 419.0 | 215 | 0.1ms | 0.2 | 0.2 | 1.3MB |
| av1 360p | draw only | 120 | 3038.0 | 40 | 0.1ms | 0.2 | 2.7 | 0MB |
| av1 360p | draw + LUT | 120 | 1673.6 | 72 | 0.0ms | 0.2 | 0.6 | 0.6MB |

해석 주의:
- per-frame 시간은 셰이더 제출 구간만 측정되어 매우 작다. wall fps는 디코더 콜백·GPU 백프레셔·SwiftShader 실행을 포함한 처리율이다. 두 값의 차이가 크며, **소프트웨어 GL headless 수치이므로 실기기 GPU 성능의 근거로 사용하지 않는다.** 같은 코드에서도 실행마다 720p draw 215~282fps처럼 크게 변동한다.
- VP9/AV1에서 LUT 모드가 draw 모드보다 빠른 역전은 측정 잡음/백프레셔 영향으로 판단한다. 절대값보다 "모든 포맷에서 실시간(30fps) 이상 처리"라는 사실에 의미를 둔다.
- 1080p draw only의 max 스파이크는 이번 실행 3.8ms(이전 66.4ms)로, 디코더 초기화 구간 변동이다.

## 6. LUT 트랜스코드·출력·검증 (CP1.1)

파이프라인: WebCodecs 디코드 → `VideoFrame` → WebGL2 캔버스(33³ warm-film LUT, strength 0.85) → `CanvasSource` 인코드 → mediabunny mux → `StreamTarget`(WritableStream). 오디오는 `EncodedPacketSink`로 원본 패킷을 읽어 `EncodedAudioPacketSource`로 **재인코딩 없이** 전달한다. 자동화에서는 WritableStream을 Playwright `__q03Sink`(Node fs)로 연결했고, 제품 경로에는 오디오·비디오 blob을 Base64로 만드는 단계가 없다(`outputBase64: "absent"`).

| 입력 | 출력 컨테이너/코덱 | 프레임 | fps | wall ms | 오디오 패킷 | 피크 heap | 출력 크기 | 길이 | A/V 시작 | A/V 종료 차 |
|---|---|---|---|---|---|---|---|---|---|---|
| h264 720p | MP4 / AVC 64001f | 180 | 31.2 | 5,775 | 283 | 17.6MB | 4.28MB | 6s | -21.33ms | 0ms |
| h264 1080p | MP4 / **AVC 640028** | 300 | 15.2 | 19,740 | 470 | 24.8MB | 15.29MB | 10s | -21.33ms | 0ms |
| vp9 720p | WebM / VP9 | 180 | 32.7 | 5,514 | 301 | 0MB | 2.98MB | 6s | -7ms | -6ms |
| hevc 360p | MP4 / AVC 64001e | 90 | 107.9 | 834 | 142 | 31.3MB | 0.63MB | 3s | -21.33ms | 0ms |
| av1 360p | WebM / VP9 | 120 | 82.4 | 1,457 | 201 | 0MB | 0.71MB | 4s | -7ms | -6ms |
| h264 무음 720p | MP4 / AVC 64001f | 180 | 34.7 | 5,184 | — | 0MB | 4.18MB | 6s | — | — |
| h264 세로 720×1280 | MP4 / AVC 64001f | 120 | 28.9 | 4,154 | 189 | 1.1MB | 3.28MB | 4s | -21.33ms | 0ms |
| h264 회전 270° | MP4 / AVC 64001f (720×1280 출력) | 180 | 15.9 | 11,355 | 283 | 28.1MB | 4.32MB | 6s | -21.33ms | 0ms |
| h264 VFR | MP4 / AVC 64001e | 126 | 111.3 | 1,132 | 283 | 13.8MB | 1.11MB | 6s | -21.33ms | 100ms(입력과 동일) |

- 1080p 출력은 CP1의 AV1 폴백(4.3fps)에서 **AVC L4.0**으로 교정됐다(이번 실행 15.2fps, 이전 11.7fps). 인코드 fps는 SwiftShader 소프트웨어 GL 수치로 실행마다 크게 변동한다(720p 13~31fps, 피크 heap도 0~31MB). 실기기 GPU 성능 근거로 쓰지 않는다.
- 무음 입력은 오디오 트랙 없이 mux되고 검증도 4항목(화면·프레임 수·디코드·타임스탬프)만 수행된다.
- AAC 시작 오프셋 -21.33ms는 AAC 인코더 프라이밍(1024 samples @48kHz), Opus -7ms는 프리롤 차이다. 검증 기준은 절대값이 아니라 **입력의 오프셋이 그대로 보존되는지**(시작 ≤1ms, 종료 ≤5ms)이다. VFR의 100ms 종료 차는 입력 자체의 비디오(5.9s)/오디오(6.0s) 길이 차이이며 출력도 동일하다.
- VFR: 입력의 가변 간격이 출력 PTS에 유지된다(ffprobe: 33.3ms ×109 + 133.3ms ×17). 출력 프레임 수 126, 길이 6s.
- 회전: 입력은 coded 1280×720 + rotation side data(표시 720×1280)다. 출력은 **픽셀이 캔버스에서 회전되어 coded 720×1280**으로 기록되고 rotation 태그는 없다(ffprobe 확인). 모바일 재생기는 태그 없이도 올바른 방향으로 표시한다.
- 출력 영상의 graded 스냅샷은 육안 및 픽셀로 LUT 적용이 확인된다(`results/video/images/*_graded.jpg`).

### 6.1 동적 코덱/프로파일/레벨 선택 (IMG-04)

`pickCodec`은 해상도·프레임레이트·목표 비트레이트(≈0.1bpp)로 후보를 계산하고 `VideoEncoder.isConfigSupported`로 순서대로 질의해 첫 지원 후보를 쓴다. 결과:

| 해상도 | 선택된 문자열 | 프로파일/레벨 | 비트레이트 |
|---|---|---|---|
| 1920×1080@30 | `avc1.640028` | High / 4.0 | 6.22 Mbps |
| 1280×720@30 | `avc1.64001f` | High / 3.1 | 2.76 Mbps |
| 640×360@30 | `avc1.64001e` | High / 3.0 | 1.00 Mbps |

- 컨테이너는 입력 컨테이너를 따르며(MP4→MP4/AVC, WebM→WebM/VP9), 미지원 문자열은 다음 후보로 넘어간다. 거부된 후보도 `encoder.candidates`에 오류와 함께 기록된다.
- HEVC/AV1/VP8 인코드는 이번 자동 측정에서 선택되지 않았다(웹 컨테이너 호환성 우선). 실제 인코드 지원 여부는 여전히 "프로브만/미검증" 구분을 유지한다(`Q03_SUPPORT_MATRIX.md`).

### 6.2 Streaming 출력과 메모리 예산 (IMG-02)

| 검사 | 결과 |
|---|---|
| 출력 대상 감지 | `showSaveFilePicker`, FileSystemWritableFileStream, secure context, user activation을 런타임에 보고 |
| 스트리밍 출력 | harness WritableStream에 1~16 chunk로 직접 기록, `bytes` 일치, backpressure write 기록 |
| 파일 저장 요청 | 자동화에서 파일 선택기는 `AbortError`로 거부됨 → `OutputTargetError`로 구조화해 반환(앱 상태 손상 없음) |
| 예산 초과 | buffer 출력 + 1MB 예산 → `MemoryBudgetError: estimated output 25.6MB exceeds the 1MB memory budget` (힌트 포함) |
| 예산 내 buffer | 예산 내 buffer 출력은 완료 후 독립 검증 통과 |

- 예상 크기는 비트레이트×길이 기반 추정치이며, 예산 초과 시 **시작 전에** 오류로 중단해 메모리 급증을 막는다. 스트리밍 대상에서는 예산을 디스크로 대체한다.
- 파일 저장은 사용자 제스처가 필요하므로 자동화에서는 스트리밍 대상으로만 측정했다. 데스크톱 Chrome의 실제 파일 선택기 성공 경로는 실기기 브라우저에서 수동 확인이 필요하다.

### 6.3 취소와 재실행 (IMG-07)

| 검사 | 결과 |
|---|---|
| 내부 abort(`abortAfterMs`) | `AbortError: transcode cancelled`, `aborted=true`, 피크 heap 15.5MB |
| 외부 `cancelRun()` | 반환 true, `aborted=true`, 피크 heap 20.5MB |
| 취소 직후 재실행 | 1080p 300프레임 완료, 출력 독립 검증 7/7 통과 |

- 취소 경로에서 `VideoFrame`/`CanvasSource`/`Input`/`Output`을 finally에서 해제하고, 재실행 시 상태가 남지 않는 것을 확인했다. 인코더 `flush()` 중 취소도 동일하게 `AbortError`로 정리된다.

### 6.4 장시간 Export 메모리 (IMG-02)

- 45초·1350프레임 720p export: wall 79.1초(17.1fps, CP1.1 최초 측정 33.8초/39.9fps — 동일 코드, 소프트웨어 GL 부하 변동), 출력 26.7MB.
- heap 샘플 45개: 20.6~31.7MB 범위의 톱니파, **선형 증가 없음**(slope −0.68 MB/min). 비디오 전체를 메모리에 쌓지 않는다는 근거다.
- 45초를 넘는 길이·4K·모바일 한도는 미검증이다. 예산 추정치로 사전 차단하는 구조만 확인했다.

### 6.5 동일 프레임 스냅샷과 픽셀 비교 (IMG-05)

- 각 트랜스코드에서 지정 시각(1.0s)의 **렌더 완료 후** 원본/graded 두 이미지를 캡처하고, 같은 타임스탬프의 프레임에서 나왔는지(`sameFrameVerified`), LUT 적용이 픽셀에 반영됐는지(`gradingApplied`)를 검사했다. 10종 전부 true.
- 캡처 원본은 출력 파일과 별도로 입력에서 다시 디코드한 프레임과 9점 그리드 비교해 **최대 0 code 차이**였다. graded는 원본 대비 평균 70~87 code 차이(차이 픽셀 35~46%)로 LUT 적용이 뚜렷하다.
- 회전 입력(270°)도 원본과 graded를 **같은 표시 방향 소스**(파이프라인에 들어간 회전 반영 캔버스)에서 캡처하도록 수정했다. 원본 vs 독립 디코드 차이 0 code, graded는 45.8% 픽셀이 5~215 code 변해 공간 오프셋 없이 LUT만 반영된다. 표시 방향은 디코드→렌더 경계에서 정규화하고, Q01 파이프라인에서 회전 단계가 LUT **앞**에 와야 한다는 의존성을 PR에 기록했다.

### 6.6 출력 독립 검증과 자동 Assertion (IMG-08)

출력 파일을 다시 열어 다음을 자동 검사한다(모두 통과):

- 표시 해상도 = 입력 표시 해상도(회전 포함)
- 비디오 패킷 수 = 인코드 프레임 수, 디코드 프레임 수 = 패킷 수
- A/V 시작 오프셋 입력 대비 ≤1ms, 종료 차 ≤5ms(입력 기준)
- 오디오 패킷 SHA-256 = 입력 원본(재인코딩 없음)
- 출력 디코드 오류 0 + 타임스탬프 단조 증가
- 장시간 export는 첫/마지막 프레임 디코드 추가 확인

실패는 `results/video/assertions.json`에 누적되고 드라이버가 exit 1로 종료한다.

## 7. 정적 배포 확인

- `npm run build` 산출물을 `vite preview`로 서빙하고 720p H.264를 analyze/bench: `avc`, 1280×720, 30fps, audio `aac`, `canDecode=true`, draw+LUT 180프레임 성공, 페이지 오류 0. (CP1 측정. CP1.1 코드 변경 후 `npx vite build` 성공을 재확인했고, preview 재측정은 이번 라운드에서 반복하지 않았다.)
- 서버·모델·외부 API 없이 정적 호스팅만으로 동작한다. 코드는 mediabunny(MPL-2.0)와 브라우저 WebCodecs만 사용한다.
- video 청크 609.7kB(gzip 160.1kB). 재생/트랜스코드에 별도 WASM을 쓰지 않는다.
- 스트리밍 대상은 브라우저 WritableStream이면 되므로 GitHub Pages 같은 정적 호스팅에서도 동작한다. 서버 업로드는 없다.

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

- 실기기(iOS/Android) 검증 없음. 모든 성능 수치는 headless 소프트웨어 GL 환경이며 실행마다 수십 % 변동한다.
- 회전: 메타데이터(270°)를 픽셀에 구워 출력하는 경로만 확인했다(출력에 rotation 태그 없음, 표시 해상도 유지). 스냅샷 원본/graded 모두 표시 방향으로 캡처해 회전 입력도 픽셀 비교가 성립한다. Q01 파이프라인에서는 회전 정규화가 LUT 적용보다 앞서야 한다.
- VFR fixture 1종만 확인했다. B프레임 재정렬된 장편·가변 fps 인코드, HDR/10-bit, 다중 오디오/자막 트랙은 미검증이다.
- 오디오 패스스루는 원본 패킷 바이트와 타임스탬프 시작·종료 오프셋을 유지하지만, 컨테이너별 프라이밍 표현 차이(§6)의 실제 재생 동기는 실기기 확인이 필요하다.
- 파일 선택기 직접 저장은 자동화에서 거부되어 `OutputTargetError` 경로만 측정했다. 데스크톱 Chrome의 실제 저장 성공 흐름, 대용량 디스크 지속 쓰기 오류 처리는 미검증이다.
- 메모리 예산은 비트레이트×길이 추정치다. 추정이 실제보다 작게 나오는 극단 케이스(가변 비트레이트 급증)는 미검증이다.
- 장시간 스트레스는 45초 720p 1종이다. 4K/수 분 길이/mobile 메모리 한도는 미검증이다.
- HEVC/AV1/VP8 인코드는 프로브만 했고 이번 트랜스코드에서 선택되지 않았다.
- LUT는 PoC용 합성 warm-film LUT이며, 제품 LUT/필름 프로필과의 연결은 Q01 인터페이스 확정 후 진행한다.

## 10. 산출물

| 경로 | 내용 |
|---|---|
| `poc/q03-imaging/video.html`, `src/video/main.ts` | 분석/벤치/트랜스코드 러너, WebGL2 LUT 파이프라인, capability probe, 스트리밍 출력·예산·취소 |
| `poc/q03-imaging/scripts/run-video.mjs` | 자동 측정 드라이버(`__q03Sink` 스트림, 예산/취소/장시간, assertion) |
| `poc/q03-imaging/scripts/make-fixtures.sh` | ffmpeg 합성 fixture 10종 생성(무음/세로/회전/VFR/45s 포함) |
| `poc/q03-imaging/results/video/TABLE.md` | 전체 측정 표 |
| `poc/q03-imaging/results/video/*.json` | capability/analysis/bench/transcode/budget/cancel/long/assertions 원시값 |
| `poc/q03-imaging/results/video/images/` | 원본/graded 스냅샷(회전 포함 10종) |
| `poc/q03-imaging/results/video/out/`, `out_*` | 트랜스코드 출력(용량 관계로 Git 제외, 재생성 가능) |
| `poc/q03-imaging/THIRD_PARTY_NOTICES.md` | FlashRaw/Mediabunny/LibRaw 제외/샘플 고지 |
| `docs/phase1/Q03_SUPPORT_MATRIX.md` | 디코드/인코드 매트릭스 |
| `docs/phase1/Q03_LICENSE_REVIEW.md` | 라이선스 검토 |
