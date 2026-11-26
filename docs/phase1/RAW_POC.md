# Q03 RAW Development Engine — CP1 기술 PoC

상태: 2026-11-27 측정 완료 · 브랜치 `feature/phase1-q03-imaging` · PoC 위치 `poc/q03-imaging/`

## 1. 목적과 제약

- WO-22~WO-29(RAW Development Engine)의 CP1 기술 검증. 브라우저에서 RAW 센서 데이터를 실제로 디코드하고, 기존 3D LUT 색 처리 앞에 연결할 선형 고정밀 버퍼 사양을 확인한다.
- 표시 원칙: 지원하지 않는 포맷을 지원으로 표시하지 않는다. 내장 JPEG 썸네일을 RAW 현상 결과로 대체하지 않는다.
- Q01 인터페이스 확정 전까지 `src/`의 기존 색상 엔진은 수정하지 않았다. PoC는 독립 정적 페이지(`poc/q03-imaging/raw.html`)에서 수행했다.

## 2. 결론 요약

| 검증 항목 | 결과 | 근거 |
|---|---|---|
| 7개 RAW 포맷 실제 센서 디코드 | ✅ CR3/CR2/RAF/NEF/ARW/ORF/DNG 모두 성공. `source=sensor`, `incomplete=false`, 경고 0 | `results/raw/TABLE.md` decode matrix |
| 비RAW 입력 정직성 | ✅ JPEG 제어 파일은 `detectFormat=null`, `supportsFile=false`, `UnsupportedFormatError: ... no recognisable header`로 거부 | `results/raw/unsupported_probe.json` |
| Bayer / 비Bayer 구분 | ✅ X-Trans에서 `ppg`/`rcd`는 명시적 오류로 거부, `auto`/`bilinear`/`edge-aware`만 허용 | `raf_fuji_xt4.json` |
| 내장 썸네일 비대체 | ✅ 내장 프리뷰는 `usage: "reference-only: not used as the RAW development result"`로만 저장, 현상 결과와 분리 | `src/raw/main.ts`, `results/raw/images/*_embeddedPreview.jpg` |
| 선형 고정밀 버퍼 | ✅ f32/f16/linear-rgb16 출력 확인. f16은 f32 대비 8-bit sRGB 결과 최대 1 code 차이 | 정밀도 표 |
| 메모리/시간 측정 | ✅ 24~26MP에서 f32 출력 245~297MB, 피크 heap 360~607MB, 0.24~1.39초(1스레드 WASM SIMD) | decode matrix |
| 정적 배포 가능성 | ✅ `vite build` 산출물을 `vite preview`로 서빙해 실제 CR3 디코드 재확인. 서버·모델·네트워크 업로드 없음 | §8, `results/raw/TABLE.md` |
| 라이선스 | ✅ FlashRaw MIT OR Apache-2.0. LibRaw-Wasm은 참고용으로만 사용(내부 LibRaw LGPL-2.1/CDDL — 배포 검토 필요) | `docs/phase1/Q03_LICENSE_REVIEW.md` |

권장 연결안: RAW는 **linear-rgb f16**으로 디코드해 선형 상태로 전달하고, 기존 엔진의 `srgbToLinear` 단계 앞에서 sRGB 도메인으로 변환한 뒤 기존 33³ LUT 파이프라인에 합류한다. 8-bit LUT/필름 프로필·레시피 스키마는 변경하지 않는다(§7).

## 3. 재현 방법

```bash
cd poc/q03-imaging
npm ci
bash scripts/fetch-raw-samples.sh      # canonical URL 다운로드 + SHA-256 manifest 검증 → testdata/ (git 제외)
node scripts/run-raw.mjs               # main + color contract + robustness + release, 30~45분
node scripts/build-summary.mjs && node scripts/summarize-raw.mjs
node scripts/check-raw.mjs             # 114개 assertion, 실패 시 exit 1
npm run build && npm run preview       # 정적 산출물 확인
```

- `RAW_FILES=cr3_canon_r6m3`처럼 파일을 지정해 개별 재측정할 수 있다. `RAW_LIBRAW=0`이면 LibRaw 비교를 생략한다.
- 단계별 재실행: `RAW_SKIP_MAIN=1`(계약/손상/해제만), `RAW_SKIP_CONTRACT=1`, `RAW_SKIP_ROBUSTNESS=1`, `RAW_SKIP_RELEASE=1`. 단계별 실행은 기존 결과 JSON을 지우지 않는다.
- 측정 중에는 다른 브라우저/대용량 작업을 동시에 실행하지 않는다. 또한 **측정 중 `src/`를 수정하면 Vite HMR 리로드로 실행이 중단**되므로 금지한다. 최초 ARW 측정은 병행 작업 영향으로 비정상 수치가 나와, 단독 재측정 값으로 대체했다(§5.4).

## 4. 측정 환경

| 항목 | 값 |
|---|---|
| Browser | HeadlessChrome/158 (Playwright Chromium 1254, macOS arm64) |
| WASM | FlashRaw 0.5.0, SIMD128, **1스레드** (COOP/COEP 미설정 → SharedArrayBuffer 없음) |
| GPU | SwiftShader(소프트웨어 ANGLE). RAW 경로는 WebGL 미사용 |
| JS heap limit | 4192 MB, `hardwareConcurrency` 8 |
| 샘플 | raw.pixls.us 공개 원본 7종 (각 제조사 1기종) |

샘플은 포맷별 최소 1개 기종만 검증한 것이다. 같은 확장자의 모든 압축 변형·기종을 지원한다고 주장하지 않는다(§9, `Q03_SUPPORT_MATRIX.md`).

## 5. 측정 결과

전체 표는 [`poc/q03-imaging/results/raw/TABLE.md`](../../poc/q03-imaging/results/raw/TABLE.md). 원본 JSON은 `results/raw/*.json`.

### 5.1 실제 센서 디코드 확인

| 파일 | 포맷 | 센서 레이아웃 | CFA | RAW 크기 | 비트 | 활성 영역(현상 출력) | 입력 |
|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | CR3 | bayer | RGGB | 4512×2994 | 14 | 4320×2880 | 14.1 MB |
| cr2_canon_1000d | CR2 | bayer | RGGB | 3948×2622 | 12 | 3888×2592 | 10.5 MB |
| raf_fuji_xt4 | RAF | **x-trans** | 6×6 GGRGGB… | 6384×4182 | 14 | 6240×4160 | 25.7 MB |
| nef_nikon_z6 | NEF | bayer | RGGB | 4548×3030 | 12 | 4528×3018 | 12.9 MB |
| arw_sony_a7m3 | ARW | bayer | RGGB | 6048×4024 | 14 | 6000×4000 | 24.5 MB |
| orf_olympus_em10 | ORF | bayer | RGGB | 4640×3472 | 12 | 4608×3456 | 14.6 MB |
| dng_ricoh_gr3 | DNG | bayer | RGGB | 6112×4064 | 14 | 6000×4000 | 31.8 MB |

- 7종 모두 `source: sensor`, `incomplete: false`, `warnings: []`. black level·white level·as-shot WB 배율·CFA 패턴을 프레임에서 읽었다.
- 현상 결과가 내장 프리뷰 해상도와 다른 파일(CR2/RAF/ARW/ORF)이 있어도 결과는 센서 디코드에서 나온다. 내장 프리뷰는 참고 이미지로만 저장된다.
- 시각 확인: CR3·RAF의 현상 결과가 LibRaw 참고 출력과 같은 장면·구도를 보였다. 다만 본 PoC의 현상 결과는 **톤 커브 없는 선형→sRGB 변환**이므로 LibRaw(카메라 프로세싱·자동 밝기 포함)와 색·콘트라스트가 다르다. 최종 룩은 기존 엔진의 톤 단계에서 결정된다.

### 5.2 성능/메모리 (중앙값, 3회 반복은 linear f32/rgba8)

| 파일 | raw-u16 ms | linear f32 ms | f32 출력 MB | linear f16 ms | f16 출력 MB | rgba8 ms | rgba8 출력 MB | 1200×800 영역 ms |
|---|---|---|---|---|---|---|---|---|
| CR3 4320×2880 | 137.6 | 246.9 | 142.4 | 248.3 | 71.2 | 368.3 | 47.5 | 171.7 |
| CR2 3888×2592 | 88.6 | 242.6 | 115.3 | 188.6 | 57.7 | 296.0 | 38.4 | 188.3 |
| RAF 6240×4160 | 532.6 | 1391.8 | 297.1 | 1392.3 | 148.5 | 1873.2 | 99.0 | 546.3 |
| NEF 4528×3018 | 108.8 | 238.0 | 156.4 | 240.1 | 78.2 | 352.5 | 52.1 | 346.4 |
| ARW 6000×4000 | 104.6 | 326.4 | 274.7 | 327.0 | 137.3 | 627.2 | 91.6 | 100.5 |
| ORF 4608×3456 | 370.6 | 396.6 | 182.3 | 433.6 | 91.1 | 486.2 | 60.8 | 723.7 |
| DNG 6000×4000 | 427.9 | 481.8 | 274.7 | 516.2 | 137.3 | 624.5 | 91.6 | 320.5 |

- f32 디코드 피크 heap 증가: 156.7~607.1 MB (ARW 최대). 26MP f32를 동시에 여러 장 유지하면 모바일에서 위험하다. **f16 작업 버퍼**가 메모리 절반, 정밀도 손실은 8-bit 출력 기준 무시 가능(§5.3).
- 영역 디코드(`decodeRegion`)는 1200×800 rgba8 기준 100~724 ms로, 전체 프레임 대비 확실히 저렴하다. 프리뷰/패닝용으로 유효하다.
- 1스레드 WASM 기준이며, COOP/COEP를 설정하면 FlashRaw 스레드 빌드로 추가 단축 여지가 있다. 단, 이 PoC에서는 스레드 경로를 검증하지 않았다(환경상 활성화 불가).

### 5.3 정밀도 (linear 출력 vs f32, sRGB 8-bit 표시 환산)

| 파일 | f16 MAE | f16 maxAbs | f16 sRGB8 차이 px | f16 최대 code Δ | linear-rgb16 MAE | linear-rgb16 maxAbs | linear-rgb16 sRGB8 차이 px | linear-rgb16 최대 code Δ |
|---|---|---|---|---|---|---|---|---|
| CR3 | 1.1e-5 | 2.4e-4 | 0.54% | 1 | 4e-6 | 0.0105 | 0.41% | 1 |
| CR2 | 1.7e-5 | 3.0e-4 | 0.66% | 1 | 4e-6 | 0.173 | 0.23% | 1 |
| RAF | 1.1e-5 | 4.9e-4 | 0.56% | 1 | 1.4e-5 | 0.150 | 0.33% | 1 |
| NEF | 1.7e-5 | 4.9e-4 | 0.63% | 1 | 5e-6 | 0.118 | 0.26% | 1 |
| ARW | 2.6e-5 | 4.9e-4 | 0.77% | 1 | 1.7e-4 | 0.460 | 0.17% | 1 |
| ORF | 1.7e-5 | 2.4e-4 | 0.65% | 1 | 4e-6 | 0.051 | 0.21% | 1 |
| DNG | 1.9e-5 | 4.7e-4 | 0.69% | 1 | 4e-6 | 0.426 | 0.23% | 1 |

- f16 반올림 오차는 8-bit sRGB에서 픽셀의 1% 미만, 최대 1 code 차이다. **linear-rgb16**은 하이라이트에서 0.4~0.46까지 벌어지는 픽셀이 소수 존재하지만(전체의 1% 미만) 표시 8-bit 차이는 역시 최대 1 code다.
- 결론: 편집·미리보기 작업 버퍼는 f16, 필요 시 f32로 승격하는 전략이 정밀도/메모리 균형상 합리적이다.

### 5.4 디모자이크·하이라이트·화이트밸런스

- `auto`는 7종 모두 `bilinear`와 동일 결과였다(차이 픽셀 0). 기본값을 auto로 두면 예측 가능한 품질이 나온다.
- `edge-aware`는 1.0~6.5초, `ahd`는 0.6~3.5초(1스레드, 24~26MP). mean code Δ는 1.3~4.3으로 미세하지만 차이는 존재한다. 실시간 기본값으로는 bilinear/auto, 고품질 현상 옵션으로 edge-aware를 두는 구성이 현실적이다.
- X-Trans에서 `ppg`/`rcd`는 `InvalidArgumentError`로 거부된다(정직성 확인 항목).
- 하이라이트 복구: 대부분 샘플에서 clip 대비 차이 픽셀 0. ARW에서만 neutral 0.14%, blend 0.54%, reconstruct 0.79%로 실제 변화가 있었다. 복구 옵션은 UI 노출 가치가 있으나, 기대 효과는 장면 의존적이다.
- 화이트밸런스: daylight/auto 선택지가 as-shot 대비 67~99% 픽셀을 바꾼다. 카메라 as-shot WB를 기본값으로 두고 daylight/auto를 사용자 선택으로 노출하는 근거가 된다.
- ARW는 최초 타 작업과 병행 측정에서 비정상 수치(f16·rgba8·demosaic 등 수 초~수십 초)가 나왔다. 단독 재측정(§5.2 값)으로 대체했고, 최초 수치는 폐기했다.

### 5.5 LibRaw-Wasm 참고 디코드

| 파일 | FlashRaw rgba8 ms | LibRaw open ms | LibRaw imageData ms | 결과 |
|---|---|---|---|---|
| CR3 | 368.3 | 190.8 | 1137.2 | ok |
| CR2 | 296.0 | 157.4 | 1393.2 | ok |
| RAF | 1873.2 | 3007.2 | **29126.5** | ok |
| NEF | 352.5 | 751.0 | 3375.1 | ok |
| ARW | 627.2 | 405.5 | 1943.2 | ok |
| ORF | 486.2 | 147.9 | 1603.6 | ok |
| DNG | 624.5 | 355.4 | 2486.8 | ok |

LibRaw은 카메라 WB·sRGB 8-bit 기본값의 참고 출력이며 픽셀 일치 비교 대상이 아니다. X-Trans(RAF)에서 29초로 실사용이 어렵다. 라이선스 검토 결과(§`Q03_LICENSE_REVIEW.md`)에 따라 **PoC 참고용으로만** 사용하고 제품 번들에서는 제외하는 것을 권장한다.

### 5.6 CP1.1 교정 결과 (IMG-01/03/06/09/10/11)

측정: 2026-11-27 · FlashRaw 0.5.0 SIMD 1스레드 · 명령 `node scripts/run-raw.mjs` (전체), `node scripts/check-raw.mjs` → **114/114 assertion 통과**.

#### IMG-01 RAW 색 파이프라인 계약 (`src/shared/imagingContract.ts`, `q03-contract/1.0.0`)

| 파일 | SDR 브리지 vs 디코더 maxCode | WB 순서 | 최적 모델 p99 | EXIF orientation | 원본 해상도 = crop | P3 요청 |
|---|---|---|---|---|---|---|
| CR3 | 1 | **pre-matrix** (matrix-exact) | 2.8e-6 | 적용 | 4320×2880 | honored |
| CR2 | 1 | pre-matrix (matrix-exact) | 4.1e-6 | 적용 | 3888×2592 | — (미측정) |
| RAF | 1 | pre-matrix (matrix-exact) | 1.1e-6 | 적용 | 6240×4160 | honored |
| NEF | 1 | pre-matrix (matrix-exact) | 1.2e-6 | 적용 | 4528×3018 | — |
| ARW | 1 | pre-matrix (matrix-exact) | 1.2e-6 | 적용 | 6000×4000 | — |
| ORF | 1 | pre-matrix (matrix-exact) | 0.9e-6 | 적용 | 4608×3456 | — |
| DNG | 1 | pre-matrix (matrix-exact, D65 `color[1]`) | 2.1e-6 | 적용 | 6000×4000 | — |

- **버퍼 계약**: scene-linear 경로는 RGB 3채널, f16/f32, transfer=linear, 무제한 값(클리핑 없음)으로 고정. SDR 경로는 sRGB RGBA8 표시 전용으로 분리했다. 브리지(`linear→sRGB`)와 디코더의 `rgba8(tone:'linear')`은 최대 1 code 차이.
- **WB/매트릭스 순서**: WB 배율을 2배로 바꿨을 때 출력이 `T·diag(2,1,1)·T⁻¹`(카메라 공간 pre-matrix)와 1e-6 수준으로 일치하고, 출력 공간 대각(`post-matrix`) 가설은 기각(p99 0.13~0.43). DNG는 ColorMatrix 2개(A/D65)를 모두 후보로 평가해 D65에서 정확히 성립했다.
- **조기 클리핑 없음**: CR3/RAF에서 +2EV 시 선형 max 1.87, >1 비율 6.39%, 정확히 1.0에 붙은 픽셀 0. f16 반포화(>65504) 0.
- **해상도/Orientation**: 디코드 크기 = 파일 crop 크기, EXIF orientation 반영, source=sensor. 내장 프리뷰는 `reference-only`로 분리 유지.

#### IMG-06 손상·제한·자원 해제 (`results/raw/robustness.json`, `release.json`)

| 입력 | 결과 |
|---|---|
| JPEG 제어 파일 / 랜덤 1MB | `UnsupportedFormatError` (파싱 단계 거부) |
| truncated CR3 / RAF (10% 절단) | `CorruptFileError` (strict·recover 동일), 파일 핸들 해제 |
| truncated DNG (0.5% 절단) | 정상 디코드(손상 허용 범위), 핸들 해제 |
| maxDimension=1000 / maxSamples=2e6 | `LimitExceededError`, 핸들 해제 |
| 동일 파일 open+decode 4회 반복 (gc 후) | JS heap 정착 증가 **0 MB**(CR3/RAF), **−24.4 MB**(ARW) — 누수 없음 |
| 디코드 중 취소 (AbortSignal) | `cancelled=true`, 프레임/파일 해제 확인 |

#### IMG-09 영역 디코드 좌표 교정 (`region`)

- region 좌표는 센서 버퍼 기준이며, 전체 디코드 인덱싱 시 기본 crop 원점(예: CR3 180,108)을 뺀다.
- 1200×800 중심/코너 영역 모두 **8px 내부는 전체 디코드와 완전 일치(diff 0)**. 경계 8px는 전체 프레임 디모자이크 문맥 부재로 최대 수십 code 차이가 날 수 있어 내부와 분리 보고한다.

#### IMG-10 Exposure/WB/Highlight 후 f16 vs f32 (`precisionAfterAdjustments`)

| 파일 | exposure+2 sRGB8 평균 code Δ | WB daylight | highlight blend | 하이라이트 밴드(>1.0) 평균 code Δ | 선형 maxAbs |
|---|---|---|---|---|---|
| CR3 | 1 | 1 | 1 | 1 | 9.8e-4 |
| CR2 | 1 | 1 | 1 | 1 | 1.2e-3 |
| RAF | 1 | 1 | 1 | 1 | 2.0e-3 |
| NEF | 1 | 1 | 1 | 1 | 2.0e-3 |
| ARW | 1 | 1 | 1 | 1 | 2.0e-3 |
| ORF | 1 | 1 | 1 | 0 | 9.8e-4 |
| DNG | 1 | 1 | 1 | 1 | 1.9e-3 |

- 보정 이후에도 sRGB 8-bit 표시 차이는 평균 1 code 이하. f16 작업 버퍼 유지 근거가 강화됐다.

#### IMG-03 샘플 재현·SHA-256

- canonical 경로 `https://raw.pixls.us/download/data/<Make>/<Model>/<file>`로 수정(기존 `/data/...`는 301 리다이렉트 의존).
- `scripts/raw-samples.sha256`에 7개 원본 해시 고정, `fetch-raw-samples.sh`가 다운로드 후 `shasum -c`로 검증. `Q03_TESTDATA=/tmp/... scripts/fetch-raw-samples.sh`로 신규 디렉터리 재현 확인. 원본은 `testdata/`(Git 제외)에만 존재.

#### IMG-11 라이선스 고지

- `poc/q03-imaging/THIRD_PARTY_NOTICES.md`: FlashRaw(MIT/Apache-2.0, WASM 6종), Mediabunny(MPL-2.0, 미수정 번들 시 소스 위치 고지), LibRaw-Wasm 제품 번들 제외(LGPL/CDDL), raw.pixls.us 샘플(CC0, 재배포 안 함) 명시.

## 6. 정직성 체크리스트 (QA 확인용)

- 비RAW 파일은 파싱 단계에서 거부된다. UI에서 "지원"으로 표시할 근거가 없다.
- 내장 JPEG 프리뷰는 결과 이미지로 쓰이지 않는다. 결과 JSON에서 `usage`로 분리되어 있다.
- 실패한 디모자이크(비Bayer ppg/rcd)는 성공으로 기록되지 않고 오류 메시지로 남는다.
- 지원 매트릭스는 "이 PoC에서 실제 디코드한 7종"과 "문헌/API 조사만 한 항목"을 분리한다(`Q03_SUPPORT_MATRIX.md`).

## 7. Q01 연동 사양 (제안)

기존 엔진: 8-bit sRGB 텍스처 → 단일 패스 셰이더(srgbToLinear → exposure → WB → … → linearToSrgb → LUT) → 33³ RGBA8 LUT. RAW는 이 체인의 **앞단**에 선형 데이터로 들어가야 한다.

1. **버퍼**: `FlashRaw.decode({ output: 'linear-rgb', sampleType: 'f16' })`을 작업 버퍼로 사용(필요 시 f32 승격). 채널 3, 선형, black/white level 및 as-shot WB 적용된 상태.
2. **어댑터 경계**: RAW 모듈은 `LinearFrame { width, height, data: Float16Array|Float32Array, channels: 3, colorSpace: 'linear-srgb'|'camera-linear', meta }`를 반환하고, 렌더러는 기존 렌더러 인터페이스에 텍스처 업로더만 추가한다(WebGL2 `RGBA16F`/`RGB16F`, `HALF_FLOAT`). **8-bit LUT와 필름 프로필은 변경하지 않는다.**
3. **도메인 브리지**: 선형 → sRGB 변환은 기존 셰이더의 `linearToSrgb`에 해당하는 OETF를 CPU/GPU 한 번만 적용해 기존 sRGB 입력과 동일한 도메인으로 맞춘다. Preview와 Export가 같은 변환 함수를 공유해야 한다(⑧).
4. **카메라 WB/매트릭스**: 기본 WB는 as-shot, daylight/auto 선택 가능. CP1.1에서 FlashRaw가 WB 배율을 **카메라 매트릭스 이전**에 적용함을 수치로 확인했다(§5.6). 매트릭스 해석은 DNG처럼 다중 illuminant 파일이 있으므로 파일별 후보 평가가 필요하다. 색 정확도(ΔE)는 Q01 확정 시 별도 색차 검증 항목으로 둔다.
5. **레시피**: CP1에서는 RAW 현상 파라미터(demosaic/highlights/WB)를 Recipe v7에 넣지 않는다. Q01 인터페이스 확정 후 스키마 확장 여부를 결정한다(⑦).
6. **메모리**: f16 버퍼 + 원본 파일 미보존(비파괴 원본은 사용자 파일 그대로), 디코드 후 WASM 프레임은 즉시 `frame.close()`/`raw.close()`로 해제한다. 26MP f32 동시 유지 금지.
7. **모바일**: 이번 측정은 데스크톱 headless 1스레드다. iOS Safari/Android 실기기 메모리·시간은 미검증이며, f16 + 영역 디코드 + 2048px 프리뷰 제한을 기본 전략으로 제안한다.

## 8. 정적 배포 가능성

- `npm run build` 산출물(dist, Git 제외)을 `vite preview`로 서빙하고 실제 CR3를 다시 디코드: `format CR3`, `rgba8 359.9 ms`, `source sensor`, 경고 0, 페이지 오류 0.
- WASM/JS만으로 동작하며 서버 업로드·모델 파일·외부 API 호출이 없다. threads는 COOP/COEP가 없으면 자동으로 1스레드 폴백한다(현재 환경).
- 번들: 총 27.8MB(원본) / gzip 9.1MB. 초기 로드에 필요한 것은 simd wasm 1.27MB(gzip) 수준이고, jxl/gpu/threads 변형은 지연 로드된다. 제품화 시 사용하지 않는 변형을 빌드에서 제외하면 배포 크기를 줄일 수 있다.
- `public/flashraw` 같은 별도 복사본 없이 번들러가 해석한 `import.meta.url` 자산만으로 동작하도록 정리했다(중복 26MB 제거).

## 9. 한계와 미해결

- 제조사·압축 변형 커버리지는 7개 샘플 1기종씩만 확인했다. CR3/ARW/NEF의 다른 압축 모드, 스마트폰 DNG, 압축 DNG 등은 미검증.
- 카메라 컬러 매트릭스의 색 정확도(ΔE), 렌즈 보정, 색수차, 핫픽셀/배드픽셀 보정은 검증하지 않았다. 검증한 것은 **매트릭스 적용 순서**(WB가 매트릭스 이전)와 디코더가 쓰는 매트릭스 해석이 후보 모델과 수치적으로 일치한다는 점이다.
- 영역 디코드 경계 8px는 전체 프레임 디모자이크 문맥이 없어 값이 다를 수 있다(내부는 완전 일치). 프리뷰 용도에는 영향이 없으나, 픽셀 단위 QA 비교는 내부 영역으로 한정해야 한다.
- 노출/WB/하이라이트 후 f16-f32 비교는 CR3/RAF 외 파일에도 수행했지만, +2EV >1 보존 검증은 CR3/RAF 2종만 수행했다.
- 26MP f32 프레임 2장 동시 유지 시 heap peak 약 1.4GB(RAF/DNG 측정 668~715MB)까지 증가한다. 모바일에서는 f16 단일 버퍼 정책이 필요하며 실기기 측정은 미수행.
- 1스레드/소프트웨어 환경 수치다. COOP/COEP 스레드 빌드, 실기기 GPU, iOS Safari 메모리 한도는 미검증.
- 디모자이크 기본값(auto=bilinear)은 품질 옵션과 성능 트레이드오프가 있으며, 최종 기본값은 Q01/QA에서 결정해야 한다.
- RAW 개발 결과의 최종 색은 기존 엔진 톤 단계에 의존하므로, 이번 PoC 이미지로 제품 룩을 판단하지 않는다.

## 10. 산출물

| 경로 | 내용 |
|---|---|
| `poc/q03-imaging/raw.html`, `src/raw/main.ts` | RAW PoC 러너(디코드 매트릭스, 정밀도, 디모자이크, WB, 영역, LibRaw 참고) |
| `poc/q03-imaging/scripts/run-raw.mjs` | 자동 측정 드라이버(main / contract / robustness / release) |
| `poc/q03-imaging/scripts/check-raw.mjs` | assertion 검사기(실패 시 exit 1) |
| `poc/q03-imaging/scripts/fetch-raw-samples.sh` | canonical URL 샘플 다운로드 + SHA-256 검증 |
| `poc/q03-imaging/scripts/raw-samples.sha256` | 7개 원본 해시 manifest |
| `poc/q03-imaging/src/shared/imagingContract.ts` | Q01 연동용 버퍼/색 계약(`q03-contract/1.0.0`) |
| `poc/q03-imaging/THIRD_PARTY_NOTICES.md` | PoC 의존성 고지(FlashRaw/Mediabunny/LibRaw 제외/샘플 CC0) |
| `poc/q03-imaging/results/raw/TABLE.md` | 전체 측정 표 |
| `poc/q03-imaging/results/raw/*.json` | 파일별 원시 측정값, `color_contract_*.json`, `robustness.json`, `release.json`, `assertions.json` |
| `poc/q03-imaging/results/raw/images/` | 현상 결과 / 내장 프리뷰(참고) / LibRaw 참고 이미지 |
| `docs/phase1/Q03_SUPPORT_MATRIX.md` | 포맷 지원 매트릭스(검증/미검증 구분) |
| `docs/phase1/Q03_LICENSE_REVIEW.md` | 라이선스 검토 |
