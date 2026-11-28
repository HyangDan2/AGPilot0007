# Phase 1 Recipe Schema (v10)

상태: CP4 계약 반영 · 2026-11-28
읽기 범위: **1~10** (`RECIPE_SCHEMA_MAX = 10`). 쓰기: 기본 v8, 광학/로컬 활성 시 v9, 렌즈 블러/현상 활성 시 v10.

## 1. 버전 이력

| 버전 | 상태 | 저장 내용 |
| --- | --- | --- |
| 1~6 | 읽기 지원 | 기본 보정·필름·프리셋. 누락된 기능 그룹은 마이그레이션 시 중립값으로 채움 |
| 7 | 읽기 지원 | v6 + `camera`, `curves`, `sharpening`, `colorMixer` (누락 허용) |
| 8 | 기본 저장 | v7 + `geometry` (회전/반전/스트레이트/크롭) |
| 9 | 조건부 저장 | v8 + `optical`, `localAdjustments`. 광학 또는 로컬 보정이 활성일 때만 기록 |
| 10 | 조건부 저장 | v9 + `lensBlur`, `develop`. 둘 중 하나가 활성일 때만 기록 |

- 상한 초과 버전(현재 11 이상)은 가져오기 오류 `Unsupported recipe version`으로 거부한다.
- 쓰기 상한은 `RECIPE_SCHEMA_MAX = 10`, `CURRENT_SCHEMA_VERSION = 10`이다. 실제 저장 버전은 활성 기능에 따라 v8/v9/v10으로 낮춰 쓴다.
- v10 필드(`lensBlur`/`develop`)가 v9 이하에 선언되면 `Unexpected v10 field in recipe`로 거부한다(v9 `optical`/`localAdjustments`와 동일 규칙).
- v1~v9 레시피는 가져오기·적용 시 계속 동작하며, 저장 시점에만 상위 버전으로 재기록된다.
- Stable/Beta는 서로 다른 IndexedDB 키(`RECIPE_STORAGE_KEYS.stable`/`.beta`)를 사용한다. Beta 경로 여부로만 선택하며 레시피를 교차 저장하지 않는다.
- AI 메타데이터·모델 정보는 Phase 1 레시피에 넣지 않는다.

## 2. 공통 필드

```ts
interface CustomRecipe {
  id: string;
  name: string;
  baseFilmId: FilmId;
  profileVersion: string;
  adjustments: AdjustmentSettings;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  presetId?: string;        // Margarine preset, baseFilmId와 호환될 때만 보존
  presetVersion?: string;
  camera?: CameraSettings;
  curves?: ToneCurves;
  sharpening?: SharpeningSettings;
  colorMixer?: ColorMixerSettings;
}
```

- FilmId와 preset ID는 별개다. preset이 존재해도 `baseFilmId`는 실제 필름이다.
- 기존 `adjustments.sharpness`(0~100)는 새 샤프닝이 없을 때 `mode:'legacy'`, `amount`로 매핑한다. 새 advanced 값을 편집하면 advanced로 전환한다.
- 모든 수치는 `ADJUSTMENT_DEFINITIONS` 범위로 클램프한다.

## 3. v8 추가 필드: geometry

```ts
interface GeometryTransform {
  rotation: 0 | 90 | 180 | 270;   // 시계 방향 90도 단위
  straighten: number;             // -45..45, 시계 방향 양수
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: { x: number; y: number; width: number; height: number } | null;
}
```

- `crop`은 정규화 좌표(0..1), 좌상단 원점, 회전·스트레이트 이후 이미지 기준이다.
- 너비/높이 최소 0.01, `x+width ≤ 1`, `y+height ≤ 1`.
- 전체 프레임 크롭은 `null`(항등)로 정규화한다.
- 누락된 `geometry`는 항등값으로 채운다.
- 잘못된 회전·범위 초과 스트레이트·프레임 밖 크롭은 가져오기 오류다.
- 원본 픽셀은 저장·수정하지 않는다. 레시피는 변환 값만 보관한다.

## 4. v9/v10 추가 필드

```ts
interface RecipeV10 {
  schemaVersion: 10;
  geometry: GeometryTransform;            // v10에서도 필수
  optical?: OpticalTransform;             // v9
  localAdjustments?: LocalAdjustmentState; // v9
  lensBlur?: LensBlurState;               // v10
  develop?: RawDevelopState;              // v10
}
```

- `lensBlur`: `enabled/focusPlane/focusRange/aperture/bladeCount/rotationDeg/quality/highlightBoost/depthMask`. `depthMask`는 v9 마스크 레이어 스키마(`MaskData[]`)를 그대로 재사용한다.
- `develop`: `wb`(as-shot 또는 custom 2000~12000K·tint ±100), `exposureEV`(-5~+5), `highlightRecovery`(0~1).
- 알 수 없는 필드는 v9 검증 `Unknown recipe v9 field`, v10 검증 `Unknown recipe v10 field`로 거부한다.

## 5. 마이그레이션 흐름

```
Import JSON
  → detectRecipeSchemaVersion / assertRecipeVersionSupported
      · 버전 식별과 지원 여부만 판정(0 이하·비정수·상한 초과 거부)
  → validateRecipeJSON
      · name/baseFilmId/preset 검증
      · RECIPE_FEATURES 기능 검증(camera/curves/sharpening/colorMixer)
      · v8 활성화 후 validateRecipeV8Geometry
  → migrateRecipe
      · 필름/프리셋/보정/기능 그룹 정규화
      · 미승인 geometry 등 여분 필드 제거
      · schemaVersion을 현재 버전으로 설정
  → (v8 활성화 시) toRecipeV8
      · geometry 누락 → IDENTITY_GEOMETRY
  → 메모리 저장 및 IndexedDB persist
      · assertRecipePersistable(recipe, storageKey)로 버전·키 재확인
```

- `toRecipeV8(recipe)`는 순수 함수이며 1~7 입력만 허용한다. 8 이상은 `Unsupported recipe version for v8 migration`으로 거부한다.
- 기존 v1~v7 레시피는 가져오기·저장·Undo/Redo에서 계속 동작해야 한다.
- 누락된 camera는 날짜 OFF·광학 효과 0, curves는 대각선, sharpening은 neutral, Color Lab은 중립값으로 채운다.
- presetId/presetVersion은 기존 Margarine 호환 규칙을 유지한다.

## 6. 정규화/검증 API

| 함수 | 역할 | 오류 |
| --- | --- | --- |
| `normalizeRecipeV8Geometry(value)` | geometry 정규화, 누락 시 항등 | 없음(클램프) |
| `validateRecipeV8Geometry(value)` | 가져오기용 엄격 검증 | `Invalid recipe geometry`, `Invalid geometry ...` |
| `toRecipeV8(recipe)` | v7 → v8 순수 변환 | `Unsupported recipe version for v8 migration` |
| `isRecipeV8(value)` | schemaVersion 8 판별 | 없음 |
| `validateRecipeV9(value)` | v9 엄격 검증(optical/local 포함) | `Unknown recipe v9 field`, 위임 오류 |
| `validateRecipeV10(value)` | v10 엄격 검증(lensBlur/develop 포함) | `Unknown recipe v10 field`, 위임 오류 |
| `validateLensBlur(value)` | 렌즈 블러 범위·마스크 검증 | `Invalid lens blur ...` |
| `validateDevelop(value)` | 현상 WB/EV/하이라이트 검증 | `Invalid develop ...` |
| `shouldWriteRecipeV9(state)` | optical/local 활성 여부 | 없음 |
| `shouldWriteRecipeV10(state)` | lensBlur/develop 활성 여부 | 없음 |
| `detectRecipeSchemaVersion(value)` | 선언 버전 식별(전체 검증 아님) | 없음(null) |
| `assertRecipeVersionSupported(value)` | 지원 상한 검사 | `Unsupported recipe version` |
| `assertRecipePersistable(recipe, key)` | 저장 키·버전 가드 | `Unknown recipe storage key`, `Unsupported recipe version` |
| `resolveRecipeStorageKey(baseUrl)` | Stable/Beta IDB 키 선택 | 없음 |

`CURRENT_SCHEMA_VERSION`은 `RECIPE_SCHEMA_MAX`를 참조하며, 저장 시에는 `shouldWriteRecipeV9/V10` 결과로 실제 버전을 낮춘다.

## 7. v8 예시

```json
{
  "id": "recipe-phase1-001",
  "name": "Framed Portrait",
  "baseFilmId": "FS-010",
  "profileVersion": "1.0.0",
  "schemaVersion": 8,
  "adjustments": {
    "exposure": 0.2,
    "temperature": 0,
    "tint": 0,
    "highlights": 0,
    "shadows": 0,
    "contrast": 10,
    "saturation": 0,
    "grain": 0,
    "sharpness": 0,
    "vignette": 0,
    "filmStrength": 100,
    "whites": 0,
    "blacks": 0
  },
  "geometry": {
    "rotation": 90,
    "straighten": -1.5,
    "flipHorizontal": false,
    "flipVertical": false,
    "crop": { "x": 0.1, "y": 0.05, "width": 0.8, "height": 0.9 }
  },
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

기능 그룹(camera/curves/sharpening/colorMixer)은 값이 있을 때만 저장한다. v8에서도 각 그룹의 기존 정규화·검증 규칙을 그대로 사용한다.

## 7. 왕복 및 회귀 요구사항

- v8 Export → Import 왕복에서 id/name/film/preset/adjustments/기능 그룹/geometry가 보존되어야 한다.
- identity geometry는 `null` 크롭과 0 회전으로 정규화되어야 한다.
- 잘못된 geometry를 포함한 JSON은 부분 적용하지 않고 전체 가져오기를 거부한다.
- v7 레시피 내보내기 결과는 v8 활성화 전까지 `schemaVersion: 7`을 유지한다.
- Undo/Redo·프리셋 적용·사진 교체는 geometry를 포함해 원자적으로 복원해야 한다(기하 구현 체크포인트).
- 검증: `tests/engineContracts.test.ts`(v8 계약), `tests/engineContractCorrective.test.ts`(v1~v7·저장 키·geometry 제거), `tests/recipeCompat.test.ts`(v1~v7), 기하 구현 후 v8 왕복 E2E.

## 8. 범위 밖

- 마스크·로컬 보정 값 저장(v9 예정, `LocalAdjustmentState` 계약은 미저장).
- AI 프롬프트/모델/결과 메타데이터.
- 원본 파일 경로·업로드 URL·서버 동기화 정보.
- 16-bit/ICC/Display-P3 출력 프로파일.
