# Q03 Imaging PoC (RAW · Video)

Film Studio 2.0 Phase 1 — Q03 Imaging Engineer CP1 기술 검증용 독립 정적 PoC.

- **이 앱의 `src/`(제품 코드)와 무관**하며, 제품 빌드/배포에 포함되지 않는다. `feature/phase1-q03-imaging` 브랜치에서만 관리한다.
- 결과 문서: [`docs/phase1/RAW_POC.md`](../../docs/phase1/RAW_POC.md), [`docs/phase1/VIDEO_POC.md`](../../docs/phase1/VIDEO_POC.md), [`docs/phase1/Q03_SUPPORT_MATRIX.md`](../../docs/phase1/Q03_SUPPORT_MATRIX.md), [`docs/phase1/Q03_LICENSE_REVIEW.md`](../../docs/phase1/Q03_LICENSE_REVIEW.md).

## 구성

| 경로 | 역할 |
|---|---|
| `index.html` | PoC 안내 페이지 |
| `raw.html` + `src/raw/main.ts` | RAW 디코드 매트릭스, 정밀도/디모자이크/WB/영역/LibRaw 참고 측정 |
| `video.html` + `src/video/main.ts` | WebCodecs 분석/벤치/트랜스코드, WebGL2 LUT 파이프라인 |
| `scripts/fetch-raw-samples.sh` | raw.pixls.us 공개 샘플 + JPEG 제어 파일 다운로드 |
| `scripts/make-fixtures.sh` | ffmpeg 합성 비디오 fixture 생성 |
| `scripts/run-raw.mjs`, `run-video.mjs` | Chromium(Playwright 캐시) + Vite dev 자동 측정 드라이버 |
| `scripts/build-summary.mjs`, `summarize-raw.mjs`, `summarize-video.mjs` | 결과 JSON → 표 생성 |
| `results/` | 측정 JSON/표/이미지 (트랜스코드 출력 mp4/webm은 Git 제외) |

## 실행

```bash
npm ci
bash scripts/fetch-raw-samples.sh
bash scripts/make-fixtures.sh
node scripts/run-raw.mjs
node scripts/run-video.mjs
node scripts/build-summary.mjs && node scripts/summarize-raw.mjs
node scripts/summarize-video.mjs
npm run build && npm run preview
```

- 드라이버는 `http://localhost:5199`에 Vite dev를 띄우고 Playwright Chromium 1254를 headless(SwiftShader)로 실행한다. 경로는 `scripts/run-*.mjs` 상단 `CHROME` 상수.
- 측정 중에는 소스/설정 파일을 수정하지 않는다. Vite 재시작으로 실행 컨텍스트가 파괴된다.
- `RAW_FILES=cr3_canon_r6m3`로 개별 RAW 재측정, `RAW_LIBRAW=0`으로 LibRaw 참고 생략.
- `testdata/`(원본/합성 입력)는 Git 제외. 결과의 out_*.mp4/webm도 Git 제외이며 드라이버로 재생성한다.

## 주의

- 수치는 headless 소프트웨어 GL, RAW는 1스레드 WASM 기준이다. 실기기 성능 근거로 사용하지 않는다.
- 지원하지 않는 포맷/코덱은 성공으로 표시하지 않는다. `results/raw/unsupported_probe.json`, X-Trans의 ppg/rcd 거부, 코덱 폴백 기록을 유지한다.
- 내장 JPEG 프리뷰는 `reference-only`로만 저장하며 현상 결과로 대체하지 않는다.
