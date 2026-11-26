# Q04 CP1 — Batch Queue & Batch Export PoC

작성: Q04 Application Engineer · 2026-11-27
브랜치: `feature/phase1-q04-application`
범위: WO-33 ~ WO-36 (일괄 Recipe 적용, 비동기 Batch Export Queue, 진행률/취소/재시도/부분 실패 복구, 성능 측정)

## 1. 기존 내보내기 구조 분석

- 단일 이미지 내보내기: `prepareExportImage(image, lut, adjustments, options, onProgress, camera, filmId, curves, colorMixer, sharpening)` — `src/engine/export/imageExporter.ts`. GPU 프로브 → 오프스크린 canvas WebGL2 렌더 → `toBlob` → `PreparedExport`(Blob/File/objectUrl).
- `ExportModal`은 이 함수를 직접 호출하고, 이전 `prepared.objectUrl`을 해제한 뒤 새 결과를 보관한다.
- LUT는 `loadCubeLut(path)`가 파일을 파싱한다. 기존 코드에 배치용 캐시는 없다.
- 원칙: **Preview와 Export의 연산 정합성** — 배치도 반드시 같은 `prepareExportImage`를 호출해야 한다.

## 2. PoC 설계

### 2.1 `src/poc/q04/batchQueue.ts` — 상태 기계

- `BatchQueue<Meta, Result>`: `add`, `subscribe`, `drain`, `retry`, `retryFailed`, `cancel`, `cancelAll`, `setConcurrency`, `destroy`.
- 동시성: 생성 시 상한, `setConcurrency`로 실행 중에도 조정(기기 상태 변화 대응). 큐는 FIFO.
- 진행률: `overallProgress` = (settled 1 + running의 보고 progress) / total.
- 취소: 대기 작업은 즉시 cancelled, 실행 작업은 `AbortController.abort()` → 프로세서가 `AbortError`를 던지면 cancelled로 정산.
- 재시도: `retry(id)`는 failed/cancelled만, `retryLimit`(기본 3, attempts는 시작 시 증가)까지 허용. `retryFailed()`는 실패/취소만 골라 재투입 — **성공 결과는 유지되는 부분 실패 복구**.
- 결과 비보관: 큐는 `Result`를 보관하지 않고 `onSettled`로 넘긴다. 소비자가 Blob/objectUrl의 수명을 소유한다.
- `outstanding` 카운터로 idle/drain 판정 O(1). `destroy()`는 running abort + queued 취소 + drain 해소.
- 예외 격리: 프로세서 오류는 failed로 정산하고 큐는 계속 진행. 리스너/싱크 오류도 큐를 멈추지 않는다.

### 2.2 `src/poc/q04/batchExport.ts` — 기존 파이프라인 어댑터

- `createExportProcessor({ exportOptions, deps? })` → `{ processor, lutCacheSize, clearLutCache }`.
- 작업 흐름: `entry.getFile()` → `decodeImageFile(file, name, signal)` → 필름별 LUT 캐시 → `prepareExportImage(...)` (진행률 0.3~0.98 매핑) → `PreparedExport`.
- 정합성: `deps` 기본값은 실제 `decodeImageFile`/`prepareExportImage`/`loadCubeLut`이며 단위 테스트만 주입으로 대체한다. 프로덕션 경로는 ExportModal과 동일 함수.
- 메모리:
  - 디코딩한 `image.sourceUrl`은 `finally`에서 해제,
  - 렌더 완료 후 abort면 `prepared.objectUrl`을 해제하고 AbortError,
  - LUT는 필름 수(최대 10)만큼만 캐시 — 장수에 비례하지 않는다.
- 이미지별 편집 상태(`EditState`)를 그대로 전달하므로 선택 항목 각각 다른 필름/보정으로 일괄 내보내기가 가능하다.

### 2.3 기기 동시성 정책 — `src/poc/q04/resources.ts`

`recommendedConcurrency(profile)`:

| 조건 | 값 |
| --- | --- |
| 기본 | 2 |
| deviceMemory ≤ 2GB / ≤ 4GB | 1 / 2 |
| deviceMemory > 4GB | 3 |
| cores-1 제한 | min(위 값, max(1, cores-1)) |
| 모바일 UA | min(위 값, 2) |
| 절대 상한 | 4 |

근거: export 1건은 디코딩 버퍼 + canvas + GPU 텍스처를 동시에 잡는다. 풀해상도 이미지 여러 장을 메모리에 동시에 들고 있지 않는다는 원칙상 3을 넘기지 않는다.

## 3. 성능 측정

### 3.1 단위(합성) 측정 — `tests/q04Perf.test.ts`

| 측정 | 조건 | 결과 |
| --- | --- | --- |
| BatchQueue 처리량 | 300 mock jobs, concurrency 4 | 0.008 ms/job |

### 3.2 실제 브라우저 측정 — `tools/q04-bench/bench.mjs`

방식: Vite dev 서버(127.0.0.1) + Playwright headless Chromium에서 **PoC의 실제 `createExportProcessor`** 를 `public/samples` 사진으로 실행. 네트워크 업로드 없음. 원격 GPU 머신이 아닌 로컬 Mac(Apple Silicon, 8 cores, deviceMemory 8) 결과이며 참고 수치다.

```
Q04 CP1 batch export benchmark (Playwright Chromium, local samples)
device profile: deviceMemory=8GB cores=8 mobile=false -> recommended concurrency 3, webgl2=true

decode only (createImageBitmap):
  film_test_portrait.jpg  1264x848  28.3 ms
  portrait_test.png       1200x900  26.5 ms
  landscape_test.png      1200x900  12.5 ms
  about_preview.jpg        320x320   4.8 ms

cold first export (shader compile + LUT load): 255 ms -> 632x424, 98 KB

queue runs (scale 0.5, JPEG q0.85, real WebGL export):
  concurrency-2             8 jobs ok  wall=288 ms per-job=36 ms avg-job=72 ms  peak-heap=22 MB  out=632x424 98 KB
  concurrency-3             8 jobs ok  wall=331 ms per-job=41 ms avg-job=111 ms peak-heap=22 MB  out=632x424 98 KB
  full-scale-concurrency-3  4 jobs ok  wall=173 ms per-job=43 ms avg-job=123 ms peak-heap=22 MB  out=1264x848 360 KB
```

관찰:

- 첫 export만 셰이더 컴파일/LUT 로드로 수백 ms~수 초가 걸린다(실행마다 205ms~3.1s 변동). UI에서 "첫 작업 준비 중" 표시가 필요하다.
- 동시성 3은 처리량(wall)이 비슷하거나 약간 나쁘고, 개별 작업 체류(avg-job)는 늘었다. GPU 1개를 공유하는 단계가 있기 때문. **기본 2, 상한 3** 정책과 일치한다.
- 피크 JS 힙은 22~23MB로 일정했다. 결과 Blob은 정산 즉시 objectUrl 해제, 디코딩 URL도 해제되므로 12건을 처리해도 누적되지 않는다.
- SwiftShader(소프트웨어) 모드에서는 동일 작업이 3~4초/장이었다(`Q04_BENCH_GPU` 미지정). 하드웨어 없는 원격 CI 수치를 기기 성능으로 인용하지 않는다.

가장 최근의 수치·환경은 측정 시점에 따라 달라질 수 있으므로 이 표는 2026-11-27 로컬 실행 기록이다.

## 4. 서사 시나리오별 동작

| 시나리오 | 동작 |
| --- | --- |
| 진행률 | subscribe로 스냅샷 수신, overallProgress + per-job note 표시 |
| 취소(전체) | cancelAll → running abort → cancelled 정산, drain 해소 |
| 개별 취소 | 대기: 즉시 cancelled / 실행: abort → cancelled |
| 일시 오류 | failed로 정산, retry(id) 또는 retryFailed() |
| 부분 실패 복구 | 성공 결과는 유지, 실패/취소만 재실행, 중복 ID add는 무시 |
| 탭 숨김/포커스 변경 | setConcurrency로 완화 가능(정책은 Q01 통합 시 결정) |
| 페이지 이탈 | destroy() — 모든 작업 abort, objectUrl은 소비자 책임 |

## 5. 모바일 제약

- iOS Safari는 백그라운드 탭 타이머 스로틀과 메모리 제한이 강해, 장시간 배치가 중단될 수 있다. PoC는 재시도 가능한 실패 처리까지만 제공하고 "백그라운드 완료 보장"은 주장하지 않는다.
- 모바일 동시성은 2로 제한. 대용량(수천만 화소) 사진에서 OOM 발생 시 failed→retry로 복구되지만, 동시성을 1로 낮추는 것이 안전하다(기기 메모리 기반 자동 조정은 CP2).
- 공유 시트(`navigator.share`)는 사용자 제스처가 필요하므로 배치 완료 후 자동 공유하지 않는다.

## 6. 미해결 / CP2

- Export 파일명 충돌 정책(시리즈 접미사, 덮어쓰기 금지)은 기존 `triggerSafeDownload` 동작과 함께 확정 필요.
- 실제 iOS/Android 실기기 100장 배치 측정 미실시.
- 배치 진행 UI는 Q01 공통 컴포넌트 확정 후 구현(현 PoC는 상태 API만 제공).
- `retryLimit` 기본값(3)은 UX 결정 대상.
