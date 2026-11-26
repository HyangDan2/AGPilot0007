# Phase 1 Recipe Schema (v8)

상태: CP1 정의 · QA 승인 대기 · 2026-11-27
현재 저장 스키마: **7** (v8은 계약 정의만 완료, 기하 구현 체크포인트에서 활성화)

## 1. 버전 이력

| 버전 | 상태 | 저장 내용 |
| --- | --- | --- |
| 1~6 | 읽기 지원 | 기본 보정·필름·프리셋. 누락된 기능 그룹은 마이그레이션 시 중립값으로 채움 |
| 7 | 현재 저장 | v6 + `camera`, `curves`, `sharpening`, `colorMixer` (누락 허용) |
| 8 | 계약 정의 | v7 + `geometry` (회전/반전/스트레이트/크롭) |

- 미래 버전(현재 8 초과)은 가져오기 오류 `Unsupported recipe version`으로 거부한다.
- v8 활성화 시 허용 상한을 8로 올리고 1~7 마이그레이션을 유지한다.
- 마스크는 어느 버전에도 저장하지 않는다. 마스크 기능 승인 시 v9에서 정의한다.
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

## 4. 마이그레이션 흐름

```
Import JSON
  → validateRecipeJSON
      · name/baseFilmId/preset 검증
      · schemaVersion 1..현재 상한 검증
      · RECIPE_FEATURES 기능 검증(camera/curves/sharpening/colorMixer)
      · v8 활성화 후 validateRecipeV8Geometry
  → migrateRecipe
      · 필름/프리셋/보정/기능 그룹 정규화
      · schemaVersion을 현재 버전으로 설정
  → (v8 활성화 시) toRecipeV8
      · geometry 누락 → IDENTITY_GEOMETRY
  → 메모리 저장 및 IndexedDB persist
```

- `toRecipeV8(recipe)`는 순수 함수이며 1~7 입력만 허용한다. 8 이상은 `Unsupported recipe version for v8 migration`으로 거부한다.
- 기존 v1~v7 레시피는 가져오기·저장·Undo/Redo에서 계속 동작해야 한다.
- 누락된 camera는 날짜 OFF·광학 효과 0, curves는 대각선, sharpening은 neutral, Color Lab은 중립값으로 채운다.
- presetId/presetVersion은 기존 Margarine 호환 규칙을 유지한다.

## 5. 정규화/검증 API

| 함수 | 역할 | 오류 |
| --- | --- | --- |
| `normalizeRecipeV8Geometry(value)` | geometry 정규화, 누락 시 항등 | 없음(클램프) |
| `validateRecipeV8Geometry(value)` | 가져오기용 엄격 검증 | `Invalid recipe geometry`, `Invalid geometry ...` |
| `toRecipeV8(recipe)` | v7 → v8 순수 변환 | `Unsupported recipe version for v8 migration` |
| `isRecipeV8(value)` | schemaVersion 8 판별 | 없음 |

`CURRENT_SCHEMA_VERSION`은 기하 렌더·UI가 실제로 연결되는 체크포인트에서 8로 올린다. 그 전에는 v7로 저장해 기존 앱·베타와의 호환을 유지한다.

## 6. v8 예시

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
- 검증: `tests/engineContracts.test.ts`(v8 계약), `tests/recipeCompat.test.ts`(v1~v7), 기하 구현 후 v8 왕복 E2E.

## 8. 범위 밖

- 마스크·로컬 보정 값 저장(v9 예정).
- AI 프롬프트/모델/결과 메타데이터.
- 원본 파일 경로·업로드 URL·서버 동기화 정보.
- 16-bit/ICC/Display-P3 출력 프로파일.
