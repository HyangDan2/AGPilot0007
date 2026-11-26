# Q04 CP1.1 — Q01 협의 인터페이스 요구사항

작성: Q04 Application Engineer · 2026-11-27
브랜치: `feature/phase1-q04-application`
관련: CP1.1 교정 항목 APP-01(결과 전달 분리), APP-03(단계별 취소), APP-04(불변 편집 상태), APP-05(추천 레지스트리), APP-08(선택 역할 분리)

## 1. 원칙

- Q04 PoC(`src/poc/q04/`)에서 독립 교정 가능한 항목은 이미 수정했다. 아래 항목은 `src/engine/`, `src/stores/`, 공용 컴포넌트 등 **Q01이 소유한 공통 코드 변경이 필요**하므로, PoC에서는 어댑터/계약으로만 수용하고 Q01 인터페이스 확정 시 통합한다.
- 공통 Export/Store/Recipe 변경은 Q01과 협의 없이 진행하지 않는다(지시서 원칙).
- 각 요구사항은 “현재 PoC 동작 → 요구 계약 → 수용 기준” 순으로 기술한다.

## 2. IF-01 Export 렌더/인코딩 취소 가능성 (APP-03)

**현재**: `prepareExportImage(...)`(`src/engine/export/imageExporter.ts`)는 WebGL 렌더와 `canvas.toBlob` 인코딩을 한 번에 수행하며 `AbortSignal`을 받지 않는다. PoC는 렌더/인코딩 **전후**에만 취소를 관찰하고, 취소 시 결과 objectUrl을 해제한다. 취소 반응 지연은 1장 렌더 시간(수백 ms~수 초)에 비례한다.

**요구 계약**:

```ts
interface ExportRenderOptions {
  signal?: AbortSignal;               // 디코딩/렌더/인코딩 각 단계에서 확인
  onStage?: (stage: 'render' | 'encode') => void;
}
// 취소 시 DOMException('...', 'AbortError')를 던지고, 생성된 GPU 리소스/Blob을 즉시 해제
prepareExportImage(..., options: ExportRenderOptions): Promise<PreparedExport>;
```

- `toBlob`은 취소 API가 없으므로, 최소한 렌더 패스 사이에서 `signal.aborted`를 검사하고 인코딩 완료 후 결과를 폐기·해제하는 계약이라도 명시해야 한다.
- Workers/OffscreenCanvas 전환 시 인코딩 취소를 실제로 중단할 수 있다(별도 과제).

**수용 기준**: 1장 렌더 중 abort 시 (a) 가능한 한 빠르게 반환, (b) objectUrl/텍스처 누수 없음, (c) 오류 이름이 `AbortError`로 Queue에 cancelled 정산.

## 3. IF-02 렌더 결과와 사용자 전달(저장/공유)의 분리 (APP-01)

**현재 PoC**: `BatchQueue.deliver` + `job.renderSucceeded`/`job.deliveryError` + `counts.rendered`/`deliveryFailed`로 분리. `createDeliverySink(save)`가 objectUrl 해제를 보장하고 저장 실패를 전파한다.

**요구 계약(공용 Export API)**:

- 렌더 산출물(`PreparedExport`)과 “사용자 저장/공유”를 별개 단계로 노출한다. 저장(다운로드/공유 시트)은 사용자 제스처와 권한이 필요하므로 배치 라이브러리가 임의로 실행하지 않는다.
- objectUrl 수명 소유자를 명시한다: 생성자(렌더) → 소비자(저장/미리보기)로 이관, 해제는 멱등이어야 한다.
- 저장 실패는 “렌더 실패”와 구분되는 상태(예: `renderOk: true, deliveryError`)로 집계한다.

**수용 기준**: 저장 실패가 렌더 실패로 오표기되지 않고, 실패 후에도 objectUrl이 해제되며, 재시도가 신규 렌더로 수행된다.

## 4. IF-03 공용 선택 상태 계약 (APP-08)

**현재 PoC**: `SelectionState { ids, anchor, active }`, `clickSelection`, `clampSelection`, `primarySelection`. `active`는 항상 `ids`에 포함되거나 null이다.

**요구 계약(workspaceStore 또는 Q01 공통 상태)**:

```ts
interface SharedSelection {
  selectedIds: readonly string[];
  anchorId: string | null;     // Shift 범위 기준, 비선택 ID를 가리킬 수 있음
  activeId: string | null;     // 상세 편집/복사 대상(Primary), 반드시 선택 집합에 포함
  select(id: string, mods: { shiftKey?: boolean; toggle?: boolean }): void;
}
```

- “활성 사진 디코딩” 책임(`workspaceStore.select`)과 “선택 집합/편집 상태 원장”을 분리한다.
- toggle-off로 active가 사라지면 최근접 잔여 항목으로 이동해야 한다(anchor 사용 금지).
- 폴더 재스캔 시 `clampSelection`으로 ids/anchor/active를 함께 정리한다.

**수용 기준**: 선택 해제된 이미지가 상세 편집/일괄 복사 원본으로 쓰이는 경로가 없다.

## 5. IF-04 공용 편집 상태 저장소 (APP-04)

**현재 PoC**: `EditStateRegistry` — 지연 생성, 깊은 동결 스냅샷, 변경 시 새 객체, `subscribe(change)`, `applyToMany` per-id 복사.

**요구 계약**:

```ts
interface EditStateHost {
  getEditState(id: string): Readonly<EditState>;   // 없으면 ui 기본값으로 지연 생성
  setEditState(id: string, state: EditState): void;
  updateAdjustment<K extends keyof AdjustmentSettings>(id: string, key: K, value: AdjustmentSettings[K]): void;
  subscribe(listener: (change: { id: string; kind: 'create'|'set'|'delete'|'clear'; state: Readonly<EditState>|null }) => void): () => void;
  applyToMany(ids: readonly string[], state: EditState): number;
}
```

- `EditState`는 Recipe v7과 1:1 대응(`editStateFromRecipe`/`recipeFromEditState`). 스키마 변경 없이 기존 `editorStore` 슬라이스와 동기화할 수 있어야 한다.
- `useSyncExternalStore`로 React에 연결 가능한 알림 형태.
- 이미지 간 상태 오염 방지는 “동결 + per-id 깊은 복사”로 보장한다.

**수용 기준**: 한 이미지 편집이 다른 이미지 상태에 반영되지 않고, 동결 스냅샷 제자리 수정이 TypeError로 거부된다.

### 5.1 Q01 geometry 수용 계획 (SC-04)

Q01의 canonical `EditState`(`feature/phase1-pro-engine`, `src/engine/contracts/editState.ts`)는 v7 필드에 `geometry: GeometryTransform`(rotation 0/90/180/270, straighten ±45, flip, 정규화 crop)을 더한다. Q04 PoC의 `EditState`는 v7 그대로이므로, Q01 계약 확정 전까지 **구조적 어댑터**로 수용한다.

- 코드: `src/poc/q04/editStateAdapter.ts`
  - `SharedEditState = EditState & { geometry: unknown }` — Q01 모듈 병합 전까지의 구조적 미러. geometry는 **불투명 값**이며 정규화/검증은 Q01 `normalizeGeometry`/`validateRecipeV8Geometry`가 단독 소유한다(Q04가 중복 구현하지 않는다).
  - `toSharedEditState(edit, geometry)` / `fromSharedEditState(shared)`: 분리·병합. PoC 쪽으로 내려올 때 `createEditState`가 알려진 v7 필드만 복사하므로 geometry가 조용히 섞이지 않는다.
  - `recipeFromSharedEditState(shared, meta)`: 항상 v7 레시피를 산출하며 **geometry를 저장하지 않는다**.
  - `applyStoredRecipeToShared(shared, recipe)`: v7 레시피를 적용해도 그 사진의 geometry는 그대로 유지(레시피 적용이 프레이밍을 리셋하지 않음).
  - `assertStoredRecipeV7(recipe)`: `schemaVersion` 1~7(또는 미지정 legacy)만 허용, `geometry` 속성이 있으면 저장 거부. Q01 `RECIPE_SCHEMA_MAX = 7` 정책과 일치.
- 마이그레이션/활성화 순서:
  1. Q01이 `EditStateHost`와 `GeometryTransform` 렌더 체크포인트를 확정하고 v8 저장 상한을 8로 올린다.
  2. Q04는 어댑터의 구조적 타입을 Q01 `EditState`/`IDENTITY_GEOMETRY` import로 교체한다(공개 함수 시그니처 유지).
  3. v8 활성 시 `recipeFromSharedEditState`를 `toRecipeV8` 호출로 바꾸되, 기존 v1~v7 import 경로는 Q01 정책(미승인 geometry 제거)을 그대로 따른다.
- 비활성 기간 동안 geometry는 **사진별 UI 상태로만** 존재하며, 어떤 저장 경로(레시피 v1~v7, IndexedDB)에도 들어가지 않는다.
- 검증: `tests/q04Workspace.test.ts`의 "Q04 EditState ↔ Q01 shared state adapter" — 분리/병합 보존, v7 레시피에 geometry 부재, 레시피 적용 시 프레이밍 유지, v8 및 geometry 포함 레시피 거부.

## 6. IF-05 필름 추천 메타데이터 레지스트리 (APP-05)

**현재 PoC**: `recommendationRegistry.ts`의 `RecommendationMetadata` + `registerRecommendationMetadata`/`unregisterRecommendationMetadata`, 선언적 보너스 규칙, `deriveTargets` 폴백. 엔진에 필름 ID 분기 없음.

**요구 계약(프로파일 레지스트리 확장)**:

- 신규 Film Profile 추가 시 추천 타깃/보너스 메타데이터를 함께 등록하는 경로를 제공한다(코드 수정 없이 데이터 등록).
- 메타데이터가 없는 프로파일은 `defaultAdjustments` 파생 타깃으로 자동 참여(최소 동작 보장).
- 보너스 규칙은 조건(feature/op/value)의 데이터 배열로 표현해 UI에서 근거를 표시할 수 있어야 한다.

**수용 기준**: 런타임에 새 프로파일을 등록하면 추천 후보에 자동 포함되고, `recommendable: false`만 제외된다(테스트로 검증됨).

## 7. IF-06 Batch 상태 UI 훅 (참고)

PoC는 `subscribe(snapshot)`/`overallProgress`를 제공하지만 UI는 구현하지 않았다. Q01 공통 컴포넌트 확정 시 per-job `note`/`progress`, `renderSucceeded`/`deliveryError`, `counts.rendered/deliveryFailed`를 표시 항목으로 사용한다. 동시성/재시도 입력 UI는 Queue의 클램프 결과(실제 적용값)를 되비춰야 한다.

## 8. 미해결로 남기는 항목

- 렌더/인코딩 중 취소(IF-01)는 공용 엔진 변경이 필요해 PoC에서 완결할 수 없다.
- 저장 파일명 충돌 정책, 실기기(iOS/Android) 저장/공유 권한은 제품 UX와 함께 확정한다.
- 추천 메타데이터의 UI 편집·검증 절차와 대표 사진 평가 세트 운영은 `.private/`에서 관리한다.

## 9. IF 상태표 (SC-04 기준, 2026-11-27)

| IF | CP1.1 PoC 상태 | 소유자 | 남은 의존/다음 단계 |
| --- | --- | --- | --- |
| IF-01 export signal/onStage | **부분/대기(WO-CP2-01)** — Q04 `batchExport`는 6번째 인자로 `{ signal }`을 전달해 render/encode 단계 경계 abort를 사용한다. 그러나 Q01 `ExportModal.tsx`는 아직 `control`/`AbortController`를 배선하지 않아 사용자 대상 취소는 미완결(CP2-01-P1-01) | Q01 | Q01 최소 취소 배선 완료 후 실제 배선을 검증하고 PR #19 본문을 갱신. Q04는 어댑터 유지만 |
| IF-02 렌더/전달 분리 | **구현 완료**(PoC) — `deliver`, `renderSucceeded`/`deliveryError`, `disposePrepared`, `createDeliverySink` | Q01 (API 소유) | 공용 Export API에 동일 계약 반영, 저장 소유권 문구 확정 |
| IF-03 active selection | **구현 완료**(PoC) — `anchor`/`active` 분리, `primarySelection` | Q01 (workspaceStore 소유) | `workspaceStore.activeId`와 선택 집합 원장 분리 통합 |
| IF-04 EditStateHost | **어댑터 구현**(`editStateAdapter.ts`) + geometry 매핑/비저장 정책(§5.1) | Q01 | Q01 `EditStateHost` 확정 후 구조적 타입 → Q01 `EditState` import 교체. v8 저장은 Q01 기하 체크포인트 이후 |
| IF-05 recommendation registry | **구현 완료**(PoC) — 런타임 등록/해제, 파생 타깃 | Q01/Q04 | 프로파일 레지스트리 변경 시 메타데이터 동반 등록 절차 합의 |
| IF-06 batch UI hook | **연기** — 상태 API/`subscribe`만 제공 | Q01 (UI 소유) | 공통 진행 UI 확정 후 `subscribe` 연결 |

보강 (WO-CP2-01, 2026-11-27):

- **IF-01 정정:** Q01 `ExportControl` 계약은 merge(21fd6dc)로 들어왔고 Q04 어댑터는 이를 전달하지만, `ExportModal` 배선 전까지 "해소"로 표기하지 않는다. Q01 배선 병합 시 `tests/q04Batch.test.ts`에 batch adapter 취소 경로 테스트를 추가하고 PR 본문을 갱신한다.
- **HARNESS 소유권:** `docs/HARNESS_GUIDE.md`는 Q01 단독 소유다. PR #19가 추가한 `npm test`/`test:perf`/`test:all` 행은 Q01이 흡수하며, Q04는 이후 HARNESS를 직접 수정하지 않고 이 문서와 PR 본문으로만 제안한다(CP2-01-P3-01).
- **Recipe v8:** `geometry` 저장(v8 활성화)은 G1 이후 Q01 기하 체크포인트와 별도 PO 승인 전까지 금지한다. 어댑터는 v7 저장 정책을 유지한다.
- **Q00 문서:** `docs/phase1/MASTER_STATUS.md`, `EXECUTION_ENVIRONMENT.md`는 Q00 소유이며 Q04는 수정하지 않는다.
