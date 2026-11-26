# Q04 CP1 — Workspace & 다중 선택 PoC

작성: Q04 Application Engineer · 2026-11-27
브랜치: `feature/phase1-q04-application` · 기준: `main` b850f82
범위: WO-30 ~ WO-36 (Workspace & Batch Engine) 중 선택·이미지별 편집 상태·파라미터 복사/붙여넣기·대용량 폴더 가상화

> CP1 원칙에 따라 **기존 Store(`workspaceStore`, `editorStore`, `recipeStore`)와 기존 컴포넌트는 수정하지 않았다.** 모든 코드는 `src/poc/q04/`의 독립 PoC이며 기존 엔진 함수는 읽기 전용으로 재사용한다. Q01 공통 상태/Recipe 인터페이스 확정 후 통합한다.

## 1. 기존 구조 분석

| 영역 | 현재 구현 | 파일 |
| --- | --- | --- |
| 폴더 연결 | `showDirectoryPicker` + webkitdirectory 대체, 점진 배치(200개) 스캔 | `src/engine/image/workspace.ts` |
| 활성 사진 | 단일 활성 이미지(`activeId`), 선택 시 이전 디코딩 취소, `generation` 토큰으로 경합 방지 | `src/stores/workspaceStore.ts` |
| 사진별 세션 | `Map<string, Session>`에 보정값·zoom/pan·Undo/Redo 보존, 최근 50장 이후 이력은 1단계로 압축 | `src/stores/workspaceStore.ts` |
| 썸네일 | Worker 2개, 192×128 JPEG q0.7, 64개/8MiB LRU, epoch 기반 일괄 해제 | `src/engine/image/thumbnails.ts` |
| 가상 스크롤 | `virtualRange(count, scroll, width, itemWidth=116, overscan=3)` | `src/engine/image/workspace.ts` |
| 레시피 | 스키마 v7, v1~v6 마이그레이션, IndexedDB(idb-keyval) | `src/stores/recipeStore.ts` |

관찰한 한계(WO 요구 대비):

- 선택은 단일 `activeId`만 존재한다. Shift/Ctrl 다중 선택을 위한 순서 기반 선택 모델이 없다.
- 세션 Map은 이름이 `select` 경로 안에 캡슐화되어 있어, “선택한 여러 장에 같은 편집 적용” 같은 배치 연산의 진입점이 없다.
- 편집 상태는 editorStore의 개별 슬라이스로 흩어져 있고, 이미지 사이 이동/복사에 쓸 직렬화 단위가 없다.
- 폴더 스캔은 있으나 EXIF 인덱싱·검색·통계 추천은 없다(별도 문서).

## 2. PoC 설계

기존 코드 변경 없이 통합 가능한 순수 모듈 4개를 추가했다.

### 2.1 선택 모델 — `src/poc/q04/selection.ts`

- `SelectionState { ids: string[]; anchor: string | null }`
- `clickSelection(current, orderedIds, id, { shiftKey, toggle })`
  - Shift: 현재 폴더 정렬 순서(`orderedIds`) 기준 anchor→id **포함 범위** 선택. anchor가 사라졌으면 단일 선택으로 폴백.
  - Ctrl/Cmd(toggle): 해당 ID 추가/제거. 제거 시 anchor 유지, 빈 선택이면 anchor 해제.
  - Shift가 toggle보다 우선한다.
- `rangeBetween`, `clampSelection`(폴더 재스캔 후 사라진 ID 정리), `isSelected`, `primarySelection`(상세 편집 대상 = 마지막 클릭 항목).

### 2.2 이미지별 편집 상태 — `src/poc/q04/editState.ts`

- `EditState`: `activeFilmId`, `activePresetId`, `adjustments`, `curves`, `camera`, `colorMixer`, `sharpening` — **기존 레시피 v7과 1:1 대응**하는 직렬화 단위.
- `sanitizeAdjustments`는 `ADJUSTMENT_DEFINITIONS`의 min/max로 클램프, `createEditState`는 기존 normalizer(`normalizeCurves`, `normalizeCamera`, `normalizeColorMixer`, `normalizeSharpening`)를 그대로 호출한다. 따라서 PoC 값과 저장 레시피 값의 스키마가 갈라지지 않는다.
- `editStateFromRecipe` / `recipeFromEditState`: v7 `CustomRecipe`와 상호 변환. **스키마 변경 없음, 하위 호환 유지.**
- `copyParameters(state, groups)` → `ParameterClip`. 그룹: `film | tone | grain | curves | camera | colorMixer | sharpening`. 붙여넣기는 클립에 담긴 그룹만 대상에 반영하고 나머지는 유지한다(부분 복사/붙여넣기).
- `EditStateRegistry`:
  - `ensure(id)`는 지연 생성(이미지 1만 장이라도 실제 편집한 사진만 상태 보유),
  - `applyToMany(ids, update)`는 깊은 복사로 이미지 간 참조 공유를 막고,
  - `copyFrom`/`pasteTo`/`pasteToMany`로 다중 선택 일괄 붙여넣기,
  - 결과는 항상 새 객체 — 원본 편집 상태의 비파괴성 보장.

### 2.3 가상화 — `src/poc/q04/virtualization.ts`

- `computeVirtualWindow`는 기존 `virtualRange`를 그대로 호출한다(이중 구현 금지).
- `scrollOffsetForIndex`, `indexAtOffset`만 추가해 선택된 항목으로 스크롤 이동을 지원.
- 항목 폭 116px/overscan 3은 기존 Explorer와 동일 상수.

### 2.4 메타데이터 인덱스(요구 ⑦, 상세는 RECOMMENDATION_POC.md)

`src/poc/q04/metadata.ts` — exifr로 로컬 파싱만 수행하고 업로드하지 않는다. 증분 인덱싱(`indexed/skipped/failed`), AbortSignal, 동시성 2, 정렬/필터 검색. `Intl.Collator(numeric)` + WeakMap 캐시로 1만 장 검색 3.2ms/op.

## 3. API 계약 제안 (Q01 통합 시)

```ts
// Q01 Store가 소유할 것을 제안하는 최소 계약
interface MultiSelection {
  selectedIds: readonly string[];
  anchorId: string | null;
  select(id: string, mods: { shiftKey?: boolean; toggle?: boolean }): void;
}
interface EditStateHost {
  getEditState(id: string): EditState;          // 없으면 현재 ui defaults로 생성
  setEditState(id: string, state: EditState): void;
  editSelected(update: (state: EditState) => EditState): void; // 다중 일괄
}
```

- 기존 `workspaceStore.select`는 “활성 사진 디코딩” 책임을 유지하고, 선택 집합·편집 상태 원장은 Q01의 공통 상태로 분리하는 것이 충돌이 적다.
- `EditState` ≈ 기존 세션 `Session`에서 `zoom/pan/history`를 제외한 부분 + `sharpening`. 세션은 “화면 상태”, 편집 상태는 “직렬화 가능한 데이터”로 분리한다.
- `recipeFromEditState`가 v7을 그대로 산출하므로 Q01이 Recipe 인터페이스를 확정해도 마이그레이션이 필요 없다.

## 4. 검증 결과

`tests/q04Workspace.test.ts` (PASS):

- Shift 범위 선택: anchor 포함, 역방향, anchor 소실 폴백, toggle 병행.
- 편집 상태: 클램프, 클론 독립성, 레시피 v7 왕복, 그룹 복사/붙여넣기, 다중 일괄 적용 시 원본 불변.
- 가상화: 1만/10만 항목 윈도우 경계, 인덱스↔오프셋 왕복.

`tests/q04Perf.test.ts` (PASS, full suite 기준):

| 측정 | 반복 | ms/op |
| --- | --- | --- |
| Shift 범위 선택, 1만 항목 | 2,000 | 0.043 |
| 가상 윈도우 10만 항목 | 10,000 | 0.0001 |

측정 방식: vitest 병렬 실행 노이즈를 줄이기 위해 6라운드로 나눠 측정하고 **가장 빠른 라운드**를 사용(임계값은 그대로). 알고리즘 회귀이면 임계값을 넘긴다.

## 5. 대용량 폴더 정책

- **메모리**: 편집 상태는 사진당 수 KB JSON. 원본 디코딩 버퍼는 활성 사진 1장 + 배치 동시성(≤3)으로 제한된다. 세션/편집 상태에 이미지 버퍼를 넣지 않는다.
- **가상화**: Explorer는 기존처럼 화면 주변만 DOM으로 렌더링하고, 추가 PoC도 동일 상수를 쓴다.
- **썸네일**: 기존 64개/8MiB LRU를 그대로 사용. 1만 장 폴더에서는 캐시 밖 항목이 재요청되므로 Worker 2개 큐가 병목이 된다(개선 후보: 스크롤 정지 후 우선순위 프리페치).
- **모바일**: iOS Safari는 폴더 선택 API가 없어 webkitdirectory 입력을 쓴다. 파일을 복사하지 않고 `File` 핸들 참조만 유지하며, 대용량 폴더에서 메모리 경고가 나면 배치 크기를 줄이는 정책이 필요하다(CP2).

## 6. 미해결 / CP2 이후

- 실제 1만 장 OS 폴더에서의 스캔·썸네일 처리량은 PoC 범위 밖(합성 목록 측정만). 실기기 측정 필요.
- 다중 선택 UI(Shift/Ctrl 드래그, 선택 카운터, 일괄 편집 표시)는 Q01 공통 UI 확정 후 구현.
- 선택 항목 일괄 Recipe 적용 시 Undo 단위(사진별 1스텝 vs 그룹 1스텝)는 UX 결정 필요.
