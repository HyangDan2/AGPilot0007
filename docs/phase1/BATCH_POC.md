# Q04 CP1 — Batch Queue & Batch Export PoC

작성: Q04 Application Engineer · 2026-11-27
브랜치: `feature/phase1-q04-application`
범위: WO-33 ~ WO-36 (일괄 Recipe 적용, 비동기 Batch Export Queue, 진행률/취소/재시도/부분 실패 복구, 성능 측정)
개정: CP1.1 교정 (APP-01 결과 전달 분리, APP-02 입력 유한성 검증, APP-03 단계별 취소 계약, APP-07 통계 병기)

## 1. 기존 내보내기 구조 분석

- 단일 이미지 내보내기: `prepareExportImage(image, lut, adjustments, options, onProgress, camera, filmId, curves, colorMixer, sharpening)` — `src/engine/export/imageExporter.ts`. GPU 프로브 → 오프스크린 canvas WebGL2 렌더 → `toBlob` → `PreparedExport`(Blob/File/objectUrl).
- `ExportModal`은 이 함수를 직접 호출하고, 이전 `prepared.objectUrl`을 해제한 뒤 새 결과를 보관한다.
- LUT는 `loadCubeLut(path)`가 파일을 파싱한다. 기존 코드에 배치용 캐시는 없다.
- 원칙: **Preview와 Export의 연산 정합성** — 배치도 반드시 같은 `prepareExportImage`를 호출해야 한다.

## 2. PoC 설계

### 2.1 `src/poc/q04/batchQueue.ts` — 상태 기계

- `BatchQueue<Meta, Result>`: `add`, `subscribe`, `drain`, `retry`, `retryFailed`, `cancel`, `cancelAll`, `setConcurrency`, `destroy`.
- 동시성: 생성 시 상한, `setConcurrency`로 실행 중에도 조정(기기 상태 변화 대응). 큐는 FIFO.
- **입력 유한성(APP-02)**: `concurrency`/`retryLimit`/`setConcurrency(value)`는 `normalizeInteger`를 거쳐 `NaN`·`Infinity`는 기존 값(생성 시 기본값)으로, 소수는 내림, 범위 밖은 클램프한다. 큐 전역 안전 상한은 `MAX_CONCURRENCY = 8`, `MAX_RETRY_LIMIT = 10`이며, 기기별 권장값(`resources.ts`, ≤4)은 이 상한 아래에서만 의미가 있다. `retryLimit`은 읽기 전용 getter로 노출해 실제 적용값을 확인할 수 있다.
- 진행률: `overallProgress` = (settled 1 + running의 보고 progress) / total.
- 취소: 대기 작업은 즉시 cancelled, 실행 작업은 `AbortController.abort()` → 프로세서가 `AbortError`를 던지면 cancelled로 정산. **취소와 재시도가 경합해도 작업은 한 번만 실행**되며(`cancel/retry race` 테스트), 취소된 작업을 retry하면 새 실행 1회로 정산된다.
- 재시도: `retry(id)`는 failed/cancelled만, `retryLimit`(기본 3, attempts는 시작 시 증가)까지 허용. `retryFailed()`는 실패/취소만 골라 재투입 — **성공 결과는 유지되는 부분 실패 복구**.
- **결과 전달 분리(APP-01)**: 렌더 성공과 소비자 전달(저장/공유) 성공을 구분한다.
  - `deliver(job, result)` 옵션이 있으면 프로세서 성공 뒤 호출한다. 렌더가 성공했으므로 `job.renderSucceeded = true`와 진행률 0.98을 먼저 기록한 뒤 전달을 시도한다.
  - 전달이 던지면 작업은 `failed`가 되고 `job.deliveryError`(그리고 `error`)에 사유가 남는다. `onSettled`의 `outcome`은 `{ status: 'failed', renderSucceeded: true }`로 전달 단계 실패임을 표시한다. 렌더 자체 실패는 `renderSucceeded: false`다.
  - 집계 `BatchCounts`는 `succeeded`/`failed` 외에 `rendered`(렌더 성공 수)와 `deliveryFailed`를 별도 제공한다.
  - `retry(id)`는 `renderSucceeded`/`deliveryError`를 초기화하고 다시 렌더 → 전달 전체를 실행한다(전달 실패 시 신규 렌더 1회).
- 결과 비보관: 큐는 `Result`를 보관하지 않고 `onSettled`로 넘긴다. 소비자가 Blob/objectUrl의 수명을 소유한다.
- `outstanding` 카운터로 idle/drain 판정 O(1). `destroy()`는 running abort + queued 취소 + drain 해소.
- 예외 격리: 프로세서 오류는 failed로 정산하고 큐는 계속 진행. 리스너/싱크 오류도 큐를 멈추지 않는다.

### 2.2 `src/poc/q04/batchExport.ts` — 기존 파이프라인 어댑터

- `createExportProcessor({ exportOptions, deps? })` → `{ processor, lutCacheSize, clearLutCache }`.
- 작업 흐름: `entry.getFile()` → `decodeImageFile(file, name, signal)` → 필름별 LUT 캐시 → `prepareExportImage(...)` (진행률 0.3~0.98 매핑) → `PreparedExport`.
- **단계별 취소 계약(APP-03)**: `signal`은 `getFile` 전후, 디코딩 후, LUT 로드 후, 인코딩 전후에 검사한다. 취소가 감지되면 `DOMException('Export cancelled during <stage>', 'AbortError')`를 던져 어느 단계에서 중단됐는지 남긴다. `decodeImageFile`은 signal을 지원하므로 디코딩 중에도 중단된다.
  - `prepareExportImage`에는 `ExportControl { signal, onStage }`를 전달한다(Q01 SC-01). 렌더러가 render/encode 단계 경계에서 signal을 검사하고 `AbortError`를 던지므로, 취소는 배치 정산(`cancelled`)으로 이어지고 결과 objectUrl·디코딩 URL은 해제된다(`tests/q04Batch.test.ts` 취소 경로 2건).
- **결과 수명 관리(APP-01)**: `disposePrepared(prepared)`는 `WeakSet` 기반 멱등 해제(objectUrl 1회만 revoke). `createDeliverySink(save)`는 `save(prepared, { id, filename })`을 호출하고 **성공/실패와 무관하게 finally에서 objectUrl을 해제**한다. `save`가 던지면 그대로 전파되어 Queue가 전달 실패로 정산한다.
- 메모리:
  - 디코딩한 `image.sourceUrl`은 `finally`에서 해제,
  - 렌더 완료 후/취소 시 `prepared.objectUrl`을 해제하고 AbortError,
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

근거: export 1건은 디코딩 버퍼 + canvas + GPU 텍스처를 동시에 잡는다. 풀해상도 이미지 여러 장을 메모리에 동시에 들고 있지 않는다는 원칙상 3을 넘기지 않는다. Queue의 전역 안전 상한(8)은 “설정 실수 방지 상한”이고, 실제 운용값은 이 권장값(≤4) 이하로 둔다.

## 3. 성능 측정

### 3.1 단위(합성) 측정 — `tests/q04Perf.test.ts`, `tests/q04Batch.test.ts`

| 측정 | 조건 | 결과 |
| --- | --- | --- |
| BatchQueue 처리량 | 300 mock jobs, concurrency 4 | median 0.09 ms/job (min 0.015 / p95 0.25 / max 0.25, 단독 실행) |
| 100장 스트레스 | 100 mixed jobs (11 render 실패·17 전달 실패·5 취소), concurrency 4 | 1차 drain: failed 15 / succeeded 80 / rendered 85 / deliveryFailed 5 / cancelled 5 → retryFailed 후 succeeded 95, failed 0 |

`BatchQueue` 처리량은 벽시계 측정이므로 6라운드 min/median/p95/max를 함께 기록하고 판정은 median으로 한다(APP-07). 스트레스 테스트는 “성공 렌더 + 전달 실패”와 “렌더 실패”와 “취소”가 섞인 100건에서 최종 집계가 입력과 정확히 일치하는지 검증한다.

### 3.2 실제 브라우저 측정 — `tools/q04-bench/bench.mjs`

방식: Vite dev 서버(127.0.0.1) + Playwright headless Chromium에서 **PoC의 실제 `createExportProcessor`** 를 `public/samples` 사진으로 실행. 네트워크 업로드 없음. 원격 GPU 머신이 아닌 로컬 Mac(Apple Silicon, 8 cores, deviceMemory 8) 결과이며 참고 수치다. 작업별 소요는 min/median/p95/max를 함께 출력하며(APP-07), 판정은 median과 wall을 기준으로 한다.

```
Q04 CP1 batch export benchmark (Playwright Chromium, local samples)
device profile: deviceMemory=8GB cores=8 mobile=false -> recommended concurrency 3, webgl2=true

decode only (createImageBitmap):
  film_test_portrait.jpg  1264x848  10.3 ms
  portrait_test.png       1200x900  11.4 ms
  landscape_test.png      1200x900   4.9 ms
  about_preview.jpg        320x320   4.8 ms

cold first export (shader compile + LUT load): 96 ms -> 632x424, 98 KB

queue runs (scale 0.5, JPEG q0.85, real WebGL export):
  concurrency-2             8 jobs ok  wall=236 ms per-job=29 ms peak-heap=23 MB  out=632x424 98 KB
                            job ms min=30 median=44 p95=92 max=97 avg=57 (n=8)
  concurrency-3             8 jobs ok  wall=220 ms per-job=27 ms peak-heap=23 MB  out=632x424 98 KB
                            job ms min=34 median=72 p95=88 max=142 avg=77 (n=8)
  full-scale-concurrency-3  4 jobs ok  wall=145 ms per-job=36 ms peak-heap=23 MB  out=1264x848 360 KB
                            job ms min=27 median=118 p95=123 max=130 avg=100 (n=4)
```

관찰 (2026-11-27 CP1.1 실행):

- 첫 export만 셰이더 컴파일/LUT 로드로 수백 ms~수 초가 걸린다(실행마다 96ms~3.1s 변동). UI에서 "첫 작업 준비 중" 표시가 필요하다.
- concurrency-2/3의 wall은 236/220ms로 유사하지만 작업 median은 44/72ms로 3에서 증가한다. GPU 1개를 공유하는 렌더 단계 때문. **권장 2~3, 절대 상한 4** 정책과 일치한다.
- 개별 작업 min/max 편차가 크다(30~142ms). 최소값만으로 판정하면 회귀를 놓칠 수 있으므로 median/p95를 함께 본다.
- 피크 JS 힙은 23MB로 일정했다. 결과 Blob은 정산 즉시 objectUrl 해제, 디코딩 URL도 해제되므로 12건을 처리해도 누적되지 않는다.
- SwiftShader(소프트웨어) 모드에서는 동일 작업이 3~4초/장이었다(`Q04_BENCH_GPU` 미지정). 하드웨어 없는 원격 CI 수치를 기기 성능으로 인용하지 않는다.

수치는 측정 시점/호스트에 따라 달라지므로 위 블록은 2026-11-27 로컬 실행 기록이다.

## 4. 서사 시나리오별 동작

| 시나리오 | 동작 |
| --- | --- |
| 진행률 | subscribe로 스냅샷 수신, overallProgress + per-job note 표시 |
| 취소(전체) | cancelAll → running abort → cancelled 정산, drain 해소 |
| 개별 취소 | 대기: 즉시 cancelled / 실행: abort → cancelled (단계명이 오류에 포함) |
| 렌더는 성공, 저장 실패 | job failed + deliveryError, renderSucceeded=true, counts.rendered + deliveryFailed로 구분 집계 |
| 일시 오류 | failed로 정산, retry(id) 또는 retryFailed() |
| 부분 실패 복구 | 성공 결과는 유지, 실패/취소만 재실행, 중복 ID add는 무시 |
| 취소↔재시도 경합 | 작업당 실행 1회 보장, 재시도 시 renderSucceeded/deliveryError 초기화 |
| 잘못된 동시성/재시도 입력 | NaN/Infinity → 기존 값, 소수/범위 밖 클램프 |
| 탭 숨김/포커스 변경 | setConcurrency로 완화 가능(정책은 Q01 통합 시 결정) |
| 페이지 이탈 | destroy() — 모든 작업 abort, objectUrl은 `createDeliverySink`/소비자 책임 |

## 5. 모바일 제약

- iOS Safari는 백그라운드 탭 타이머 스로틀과 메모리 제한이 강해, 장시간 배치가 중단될 수 있다. PoC는 재시도 가능한 실패 처리까지만 제공하고 "백그라운드 완료 보장"은 주장하지 않는다.
- 모바일 동시성은 2로 제한. 대용량(수천만 화소) 사진에서 OOM 발생 시 failed→retry로 복구되지만, 동시성을 1로 낮추는 것이 안전하다(기기 메모리 기반 자동 조정은 CP2).
- 공유 시트(`navigator.share`)는 사용자 제스처가 필요하므로 배치 완료 후 자동 공유하지 않는다.

## 6. 미해결 / CP2

- Export 파일명 충돌 정책(시리즈 접미사, 덮어쓰기 금지)은 기존 `triggerSafeDownload` 동작과 함께 확정 필요.
- `prepareExportImage` 중간 취소는 Q01 `ExportControl`(0ca7ec7)로 지원된다. 다만 렌더는 GPU 동기 구간이므로 취소는 render/encode 단계 경계에서 관측되며, 진행 중 픽셀 작업을 즉시 중단하지는 않는다.
- 실제 iOS/Android 실기기 100장 배치 측정 미실시(합성 100-job 스트레스만 수행).
- 배치 진행 UI는 Q01 공통 컴포넌트 확정 후 구현(현 PoC는 상태 API만 제공).
- `retryLimit` 기본값(3)은 UX 결정 대상. Queue 상한(10)은 안전 상한일 뿐 권장값이 아니다.
