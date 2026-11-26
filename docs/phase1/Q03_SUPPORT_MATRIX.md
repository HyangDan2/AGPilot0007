# Q03 지원 매트릭스 (RAW · Video)

상태: 2026-11-27 · 근거는 `poc/q03-imaging/results/`의 실제 측정값. **검증하지 않은 항목은 지원으로 표시하지 않는다.**

표기:
- ✅ **실측 통과**: 이 PoC에서 실제 파일을 처리해 성공을 확인.
- 🟡 **API/프로브만**: API 질의(`isConfigSupported`, `canDecode`) 또는 문헌으로만 확인. 실제 파일 처리 미검증.
- ⛔ **용도 제한/미지원**: PoC에서 명시적으로 거부되거나 사용하지 않음.
- ⚪ **미검증**: 이번 범위에서 확인하지 않음. 지원 주장 불가.

## 1. RAW 포맷 (FlashRaw 0.5.0)

| 포맷 계열 | 검증 샘플 | 센서 | 비트 | 상태 | 비고 |
|---|---|---|---|---|---|
| Canon CR3 | EOS R6 III `IMG_4243.CR3` | Bayer RGGB | 14 | ✅ | 센서 디코드, 경고 0 |
| Canon CR2 | EOS 1000D `IMG_9406.CR2` | Bayer RGGB | 12 | ✅ | 센서 디코드, 경고 0 |
| Fuji RAF | X-T4 `DSCF0268.RAF` | **X-Trans 6×6** | 14 | ✅ | Bayer 전용 디모자이크(ppg/rcd)는 명시적 거부 |
| Nikon NEF | Z6 `DSC_0757.NEF` | Bayer RGGB | 12 | ✅ | 센서 디코드, 경고 0 |
| Sony ARW | α7 III `_DSC0009.ARW` | Bayer RGGB | 14 | ✅ | 센서 디코드, 경고 0 |
| Olympus ORF | E-M10 `P3180165.ORF` | Bayer RGGB | 12 | ✅ | 센서 디코드, 경고 0 |
| Ricoh DNG | GR III `R0000357.DNG` | Bayer RGGB | 14 | ✅ | 센서 디코드, 경고 0 |
| JPEG/PNG 등 비RAW | `notraw.jpg` | — | — | ⛔ | `detectFormat=null`, `supportsFile=false`, 파싱 단계에서 거부 |
| 같은 확장자의 다른 압축 변형/기종 | — | — | — | ⚪ | **지원 주장 불가.** 기종·압축 모드별 추가 검증 필요 |
| 스마트폰 DNG, 압축(lossy) DNG, HEIF 계열 RAW | — | — | — | ⚪ | 미검증 |

RAW 처리 옵션 실측:

| 항목 | 검증 결과 |
|---|---|
| 출력 버퍼 | `raw-u16`, `normalized`, `linear-rgb`(f32/f16/rgb16), `rgba8`, `rgb16` 모두 생성 확인 |
| 디모자이크 | `auto`=bilinear(7종 모두 차이 0), `half-size`, `edge-aware`, `ahd` 동작. X-Trans `ppg`/`rcd` 거부 |
| 하이라이트 | `clip` 기준 `neutral`/`blend`/`reconstruct` 동작. 샘플 대부분 차이 0, ARW에서 0.14~0.79% 픽셀 변화 |
| 화이트밸런스 | `as-shot` 기본, `daylight`/`auto` 선택 가능(67~99% 픽셀 변화) |
| 영역 디코드 | `decodeRegion({x,y,width,height})` 1200×800 rgba8 성공. 전체 디코드와 내부(경계 8px 제외) 픽셀 일치 |
| 색 계약 (CP1.1) | 7종 모두 linear f16/f32 3ch, WB pre-matrix(matrix-exact), bridge ≤1 code, EXIF orientation 반영, 조기 클리핑/8-bit 양자화 없음 |
| 스레드 | ⚪ COOP/COEP 없어 1스레드로 동작. 멀티스레드 경로 미검증 |

## 2. Video 디코드

### 2.1 실측 (Chromium 158, WebCodecs)

| 컨테이너/코덱 | 샘플 | canDecode | 전 프레임 디코드+LUT | 비고 |
|---|---|---|---|---|
| MP4 / H.264 High@L3.1 (720p) | 합성 6s | ✅ | ✅ 180f | 오디오 AAC 2ch |
| MP4 / H.264 High@L4.0 (1080p) | 합성 10s | ✅ | ✅ 300f | 오디오 AAC 2ch |
| WebM / VP9 (720p) | 합성 6s | ✅ | ✅ 180f | 오디오 Opus 2ch |
| MP4 / HEVC `hvc1.1.6.L63.90` (360p) | 합성 3s | ✅ | ✅ 90f | hvc1 태그, 오디오 AAC 1ch |
| WebM / AV1 Main (360p) | 합성 4s | ✅ | ✅ 120f | 오디오 Opus 1ch |
| MP4 / H.264 **무음** (720p) | 합성 6s | ✅ | ✅ 180f | 오디오 트랙 없이 먹싱·검증 |
| MP4 / H.264 **세로** (720×1280) | 합성 4s | ✅ | ✅ 120f | coded·표시 모두 세로 |
| MP4 / H.264 **rotation 270°** (coded 1280×720) | 합성 6s | ✅ | ✅ 180f | 표시 720×1280. 출력은 픽셀 회전(태그 없음) |
| MP4 / H.264 **VFR** (360p, 33/133ms) | 합성 6s·126f | ✅ | ✅ 126f | 가변 간격 출력 PTS 유지 |
| MP4 / H.264 45초 (720p, 1350f) | 합성 45s | ✅ | ✅ 1350f | 장시간 export 스트레스 |
| VP8 / MP3 / FLAC decode | — | 🟡 | ⚪ | `isConfigSupported` 프로브만 |
| 4K, 10-bit/HDR, 다중 오디오, 자막 | — | ⚪ | ⚪ | 미검증 |

VFR 판별은 패킷 타임스탬프를 정렬한 뒤 간격을 계산한다(CP1.1 수정). B프레임 재정렬 때문에 디코드 순서 타임스탬프를 그대로 쓰면 CFR을 VFR로 오판했다.

### 2.2 인코드 (실제 파일 생성)

| 코덱 | 프로브 | 실제 인코드 | 사용 컨테이너 | 비고 |
|---|---|---|---|---|
| H.264 (AVC) | ✅ | ✅ 1080p/720p/360p | MP4 | 동적 문자열: `avc1.640028`(L4.0)/`avc1.64001f`(L3.1)/`avc1.64001e`(L3.0) |
| VP9 | ✅ `vp09.00.31.08` | ✅ 720p/360p | WebM | WebM 입력에서 선택 |
| AV1 | ✅ `av01.0.04M.08` | ⚪ | — | CP1에서는 1080p 폴백으로 실제 인코드했으나, CP1.1 동적 선택 후 자동 경로에서 선택되지 않음 |
| HEVC | ✅ `hvc1.1.6.L93.B0` | ⚪ | — | 프로브만, 실제 인코드 미검증 |
| VP8 | ✅ | ⚪ | — | 프로브만 |
| AAC / Opus 인코드 | ✅ | ⚪ | — | 이번 트랜스코드는 오디오 **패스스루**만 사용 |
| PCM 계열 | 🟡 mediabunny 목록 | ⚪ | — | 미검증 |

오디오 처리: `EncodedAudioPacketSource`로 AAC/Opus 원본 패킷을 재인코딩 없이 통과시켰다(AAC 283/470/142/189, Opus 301/201). 출력에서 다시 읽은 패킷 SHA-256이 입력과 일치했다. 오디오 **재인코딩** 경로는 사용하지 않았다.

### 2.3 출력·메모리·취소 (CP1.1)

| 항목 | 결과 |
|---|---|
| Streaming 출력 | ✅ `StreamTarget`(WritableStream)으로 chunk 단위 직접 쓰기. 제품 경로 Base64 없음 |
| 파일 저장 감지 | ✅ `showSaveFilePicker`/FileSystemWritable 런타임 감지. 거부 시 `OutputTargetError` |
| 메모리 예산 | ✅ 초과 시 시작 전 `MemoryBudgetError`(추정 25.6MB > 1MB). 예산 내 buffer는 검증 통과 |
| 장시간(45s) | ✅ heap slope −1.58 MB/min, 20.6~31.6MB 톱니파, 증가 없음 |
| 취소 | ✅ 내부 abort·외부 `cancelRun()` 모두 `AbortError` 후 해제, 직후 재실행 성공 |
| A/V 검증 | ✅ 프레임/패킷 수, 시작·종료 오프셋(입력 보존), 오디오 해시, 타임스탬프 단조성 |
| 스냅샷 | ✅ 10종 same-frame, 원본 vs 입력 독립 디코드 최대 0 code, graded LUT 적용 확인 |
| 4K/수 분/모바일 한도 | ⚪ 미검증 |

## 3. iOS Safari (문헌 기준, 실기기 미검증)

| 항목 | 상태 | 근거/비고 |
|---|---|---|
| VideoDecoder / VideoEncoder | 🟡 | Safari 16.4+ 문헌. iOS 실기기 미검증 |
| AudioDecoder / AudioEncoder | 🟡 | Safari 26.0+ 문헌. iOS 26 미만은 오디오 WebCodecs 불가로 예상 |
| WebGL2 | 🟡 | 문헌상 지원, 실기기 성능 미검증 |
| H.264 / HEVC 디코드 | 🟡 | 문헌상 지원, 기기·OS 의존 |
| VP9 / AV1 디코드 | ⚪ | 기기·OS 의존. 미검증 |
| 오디오 패스스루 먹싱 | ⚪ | AudioDecoder 없이도 가능한지 포함해 미검증 |
| 4K/장시간 메모리 한도 | ⚪ | 미검증 |

제품화 시 `capabilities()` + `isConfigSupported`/`MediaCapabilities`로 기기별 판정하고, 미지원 포맷은 UI에서 선택 불가로 표시한다.

## 4. 검증 환경 요약

| 항목 | 값 |
|---|---|
| Browser | HeadlessChrome/158 (Playwright Chromium 1254) |
| OS | macOS arm64 |
| WebGL2 | SwiftShader(소프트웨어 ANGLE), maxTexture 8192 |
| RAW WASM | FlashRaw 0.5.0 SIMD128, 1스레드 |
| Node | v22.23.4 (PoC 실행 환경) |
| ffmpeg | 7.1.1 (fixture 생성 전용, 제품 미포함) |
