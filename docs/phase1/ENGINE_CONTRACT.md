# Phase 1 Engine Contract

상태: CP1.1 + SC-01 계약 중재 · QA 승인 대기 · 2026-11-27
기준: `feature/phase1-pro-engine` CP1 `3b22b6f` + beta merge `2a45290` + CP1.1

이 문서는 Q01~Q04가 공유하는 데이터 계약과 불변식을 정의한다. 계약을 바꾸려면 Q01 리뷰와 계약 테스트 갱신이 필요하다.

## 1. 모듈 진입점

| 목적 | 경로 |
| --- | --- |
| 단계 순서 | `src/engine/contracts/stages.ts` |
| 기하 | `src/engine/contracts/geometry.ts` |
| 기하 순/역매핑 | `src/engine/contracts/geometryMappings.ts` |
| 광학(Q02 연동) | `src/engine/contracts/optical.ts` |
| 마스크(계약 전용) | `src/engine/contracts/masks.ts` |
| 로컬 보정 그룹(계약 전용) | `src/engine/contracts/localAdjustments.ts` |
| 이미지/디코딩 경계 | `src/engine/contracts/imageBuffer.ts` |
| 모듈 Registry | `src/engine/contracts/moduleRegistry.ts` |
| 렌더 계획 | `src/engine/contracts/renderPlan.ts` |
| 렌더 컨텍스트/백엔드 | `src/engine/contracts/render.ts` |
| 편집 상태 | `src/engine/contracts/editState.ts` |
| 리소스 수명 | `src/engine/contracts/resources.ts` |
| 리소스 예산/Broker | `src/engine/contracts/resourceBudget.ts` |
| Recipe 버전/저장 정책 | `src/engine/contracts/recipeValidation.ts` |
| Recipe v8 | `src/engine/contracts/recipeV8.ts` |
| AI 확장(Phase 2) | `src/engine/contracts/ai.ts` |
| 공통 렌더 입력 | `src/engine/pipeline/renderSettings.ts` |
| 레시피 기능 registry | `src/engine/pipeline/recipeFeatures.ts` |
| 셰이더 기능 registry | `src/engine/pipeline/shaderChunks.ts` |

배럴 import는 `src/engine/contracts/index.ts`를 사용한다.

## 2. PipelineStage와 모듈

```ts
type PipelineStage =
  | 'source' | 'optical' | 'geometry' | 'tone' | 'look'
  | 'colorLab' | 'local' | 'detail' | 'composite' | 'output';

interface EditModule<T = unknown> {
  readonly id: string;
  readonly stage: PipelineStage;
  readonly requires?: readonly string[];
  readonly contractVersion: 1;
  readonly role?: 'feature' | 'stage';
  isActive?(settings: RenderSettings): boolean;
  resourceUsage?(settings: RenderSettings): ModuleResourceUsage;
  execute?(context: ModuleExecutionContext): void | Promise<void>;
  normalize?(value: unknown): T;
  validate?(value: unknown): void;
}
```

불변식:
- 모듈 ID는 비어 있지 않고 registry 내에서 유일하다.
- `requires`는 같은 단계 또는 이전 단계 모듈만 가리킨다. 이후 단계 의존은 금지한다.
- Registry는 단계 우선순위 + 의존성 위상 정렬로 순서를 반환한다. 역순 등록에서도 stage 순서를 지키며, 같은 입력이면 결과가 같다.
- 활성 모듈이 비활성 기능 모듈을 요구하면 `Active module requires inactive module: <id> -> <id>`로 중단한다.
- 순환 의존은 실행하지 않는다.
- 등록 시 모듈과 `requires`를 복사·동결한다. 외부 참조 변경은 registry에 반영되지 않는다.
- 핵심 기능은 `createCoreRenderRegistry()`에 모듈로 등록되며, 새 모듈 추가만으로 `resolveRenderPlan`이 활성화한다.

오류 문자열(테스트로 고정):
- `Invalid module id`
- `Duplicate module: <id>`
- `Unknown module stage: <stage>`
- `Unsupported module contract version: <n>`
- `Unknown module dependency: <id>`
- `Module dependency crosses later stage: <id>`
- `Circular module dependency`
- `Active module requires inactive module: <id> -> <id>`

## 3. Geometry / Optical 계약

### 3.1 GeometryTransform

```ts
interface GeometryTransform {
  rotation: 0 | 90 | 180 | 270;   // 시계 방향
  straighten: number;             // -45..45 도, 시계 방향 양수
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: { x: number; y: number; width: number; height: number } | null;
}
```

불변식:
- `crop`은 0..1 정규화 좌표, 좌상단 원점, 회전·스트레이트 이후 이미지 기준이다.
- `crop` 너비/높이는 최소 0.01이며 `x+width`, `y+height`는 1을 넘지 않는다.
- 전체 프레임 크롭은 `null`로 정규화한다(항등).
- 적용 순서: 좌우/상하 반전 → 90도 회전 → 스트레이트 → 크롭.
- 원본 픽셀을 수정하지 않고 렌더 시점에만 적용한다.
- `normalizeGeometry`는 잘못된 회전을 0, 스트레이트를 범위로 클램프하고 크롭을 프레임 안으로 제한한다. 가져오기 검증에는 `validateGeometry`를 사용해 잘못된 값을 거부한다.
- `GEOMETRY_TRANSFORM_ORDER = ['flip', 'rotate', 'straighten', 'crop']`이 유일한 적용 순서다.
- `sourceToGeometry(point, geometry, sourceAspect)`는 원본 NIS → 보정 NIS, `geometryToSource`는 그 역매핑이다. 90/270도 회전은 종횡비를 교환하고, 스트레이트는 빈 가장자리가 생기지 않도록 aspect 보정 후 확대한다.
- `geometryOutputAspect`는 회전·크롭 후 출력 종횡비를 계산한다. CPU 기준과 GLSL 기준의 일치는 `tests/e2e/geometry-contract.spec.ts`가 검증한다.

### 3.2 OpticalTransform (Q02 연동)

```ts
interface OpticalTransform {
  version: 1;
  homography: readonly number[];   // 9개, corrected NIS -> source NIS
  distortion?: { k1: number; k2?: number; k3?: number; p1?: number; p2?: number };
  perspective?: readonly [Point2, Point2, Point2, Point2]; // TL, TR, BR, BL
}
```

- Q02 PoC의 `OpticalGeometry`와 동일한 방향·좌표계(NIS, 좌상단 원점)를 사용한다.
- 왜곡은 centered space의 Brown-Conrady이고, 원근은 단위 정사각형 → 샘플링 quad 호모그래피다.
- `validateOpticalTransform`은 비유한/특이 행렬(`Optical homography is singular`), 범위를 벗어난 왜곡 계수, 볼록하지 않거나 비정상 범위의 quad를 거부한다.
- Q02는 선형 버퍼를 수정하지 않고 보정 매핑만 반환한다.
- **SC-01 중재:** Q02 통합 경계 타입은 `OpticalTransform` 하나다. Q02 PoC의 `OpticalGeometry`는 내부 표현으로만 허용하며, `validateOpticalTransform`을 통과한 결과만 렌더 단계에 전달한다.

## 4. MaskData / LocalAdjustmentState (계약 전용)

### 4.1 MaskData

- `MaskData`는 `brush | linear | radial | luminance | color` 유니온이다.
- 공통 필드: `id`, `name`, `enabled`, `blend(add|subtract|intersect)`, `opacity(0..1)`, `inverted`.
- 좌표는 정규화 이미지 좌표(0..1)이며, 반지름·feather는 보정된 이미지 짧은 변 기준이다.
- 최대 마스크 16개, 브러시 64스트로크, 스트로크당 1024포인트다.
- **SC-01 중재:** `MAX_MASKS=16`·`MAX_STROKES=64`·`MAX_STROKE_POINTS=1024`가 잠정 단일 정본이다. Q02의 8 masks/1024 segments와 충돌하므로 Q02가 GLSL uniform 예산을 제출한 뒤 Q01이 정본을 확정한다. 확정 전에는 Q01 수치를 계약으로 유지한다.
- Q02 PoC의 `LocalMask` 명명(start/end, lo/hi, rotation, feather)을 따른다. Q02는 통합 시 이 계약으로 맞춘다.
- 현재 어떤 렌더 단계도 마스크를 소비하지 않으며 EditState·RenderSettings·Recipe에 저장하지 않는다. UI도 없다.

### 4.2 LocalAdjustmentState

```ts
interface LocalAdjustmentGroup {
  id: string;
  name: string;
  enabled: boolean;
  masks: MaskData[];                 // 그룹 내 최대 16, 전체에서 ID 유일
  adjustment: Partial<AdjustmentSettings>; // filmStrength 제외
  opacity: number;                   // 0..1
  blend: 'add' | 'subtract' | 'intersect';
}
interface LocalAdjustmentState { enabled: boolean; groups: LocalAdjustmentGroup[] }
```

- 최대 그룹 수는 `MAX_LOCAL_GROUPS = 8`이다. 그룹·마스크 ID는 상태 전체에서 유일해야 한다.
- 보정 허용 키는 `LOCAL_ADJUSTMENT_KEYS`이며 `ADJUSTMENT_DEFINITIONS` 범위로 클램프/검증한다. `filmStrength`는 전역에만 둔다.
- 좌표 기준은 광학·기하 적용 후의 `corrected-nis`이고, 마스크 반지름/feather는 짧은 변 기준이다.
- 실행 순서는 `colorLab → local → detail`이며, 그룹 배열 순서대로 적용하고 그룹 내부 마스크는 `add/subtract/intersect` 순차 합성이다.
- `LOCAL_ADJUSTMENT_RECIPE_POLICY = 'not-persisted'`. 승인 전에는 Recipe·EditState·UI·렌더에 연결하지 않는다.
- 오류: `Invalid local adjustment group count`, `Invalid local adjustment parameter: <key>`, `Invalid local adjustment value: <key>`, `Invalid local mask identity across groups`, `Invalid local adjustment blend`.

## 5. ImageBuffer / DecodedSource

```ts
type SourcePrecision = 'sdr-srgb8' | 'hdr-linear16';
type ImageBufferFormat = 'rgba8' | 'rgba16f' | 'rgba32f';

interface DecodedSource {
  source: ImageSourceDescriptor;  // id, name, mimeType, width, height, precision, hasAlpha, decoderId
  working: ImageBuffer;           // colorSpace 'linear-srgb', rgba16f|rgba32f
  preview?: ImageBuffer;
  warnings: readonly string[];
}
```

불변식:
- 작업 버퍼는 항상 `linear-srgb`이며 float(16/32-bit) 저장이다. `rgba8` 작업 버퍼는 거부한다.
- **SC-01 중재:** 제품 경계는 Q01 `ImageBuffer`(linear-srgb, RGBA float)로 고정한다. Q03의 RGB 3채널 `SceneLinearFrame`은 내부 표현으로만 허용하고 `assertDecodedSource`에 전달하기 전 RGBA16F/32F 어댑터를 거쳐야 한다. SDR 입력도 float 작업 버퍼를 요구하며 `rgba8`로 대체하지 않는다.
- 작업 버퍼 크기는 원본 디스크립터와 같아야 하고 `sourceId`가 원본 `id`와 일치해야 한다.
- `memoryBytes`는 `width × height × 4 × bytesPerPixel`과 정확히 일치하고, data 길이는 `width × height × 4`여야 한다. 형식별 타입(`Uint8Array`/`Uint16Array`/`Float32Array`)도 일치해야 한다.
- Float 버퍼의 NaN/Infinity는 `Image buffer contains non-finite pixels`로 거부한다.
- GPU 버퍼는 `resourceOwner`(비어 있지 않은 문자열)와 `disposable`(boolean)을 명시해야 한다.
- SDR 입력은 sRGB EOTF로 선형화하고, RAW는 장면 선형을 유지한다. 디코더는 픽셀을 자르거나 임의 날짜로 대체하지 않는다.
- `assertDecodedSource(value)`로 검증한다. 오류: `Invalid decoded source`, `Invalid decoded source dimensions`, `Invalid decoded source precision`, `Decoded source must provide a working buffer`, `Working buffer must be linear-srgb`, `Working buffer requires 16-bit or 32-bit float storage`, `CPU working buffer requires 16-bit or 32-bit float data`, `Image buffer sourceId mismatch`, `Image buffer memoryBytes mismatch`, `Image buffer data length mismatch`, `Image buffer contains non-finite pixels`, `GPU image buffer requires resourceOwner`, `GPU image buffer requires disposable flag`.
- `validateImageBuffer(value, source?)`는 단독 버퍼 검증에도 사용한다.
- Q03만 디코딩을 구현한다. 다른 모듈은 디코딩 라이브러리를 직접 호출하지 않는다.

## 6. EditState

```ts
interface EditState {
  activeFilmId: FilmId;
  activePresetId: string | null;
  adjustments: AdjustmentSettings;
  curves: ToneCurves;
  camera: CameraSettings;
  colorMixer: ColorMixerSettings;
  sharpening: SharpeningSettings;
  geometry: GeometryTransform;
}
```

- `createEditState(input?, legacySharpness?)`가 기본값·범위·필름 ID를 정규화한다.
- 기존 v7 레시피의 `adjustments.sharpness > 0`은 `mode: 'legacy'`로 매핑한다.
- Undo/Redo는 이 스냅샷 단위이며 최대 50개(`HISTORY_LIMIT`)를 유지한다.
- 마스크는 포함하지 않는다(기능 승인 전).
- **SC-01 중재:** `EditState.geometry` 포함은 CP1.1 범위다. Q04 IF-03 공용 선택 상태와 IF-05 추천 레지스트리는 CP1.1에서 구현하지 않고 PO 승인 전까지 연기한다. IF-01 Export 취소는 §7.1의 최소 계약으로 구현한다.

## 7. RenderSettings / RenderPlan

- `RenderSettings`에 새 편집 그룹을 추가하면 Preview와 Export 양쪽 호출부가 반드시 같은 값을 전달한다.
- `geometry`는 추가되었으나 아직 렌더러가 소비하지 않는다. 기하 구현 전에는 비항등 기하를 호출부에서 전달하지 않는다.
- `resolveRenderPlan(settings, target, registry = createCoreRenderRegistry())`은 registry의 `role/stage/isActive/resourceUsage`만으로 `modules`, `activeModules`, `stages`, `features`, `floatIntermediate`, `previewOnly`를 계산한다.
- 내장 기능(`geometry`, `film`, `curves`, `colorMixer.*`, `sharpening`, `camera.*`)도 core registry 모듈이다. 새 모듈은 registry 등록만으로 계획에 참여하며 `renderPlan.ts` 분기를 수정하지 않는다.
- `renderPlanFingerprint(plan)`은 target과 previewOnly를 제외한 안정 문자열이다. 같은 설정이면 Preview/Export 지문이 같아야 한다.
- Preview 전용 요청 플래그: `compareMode`, `splitPos`, `sharpeningMask`, `sharpeningDraft`, `mixerReference`, `mixerVisualize`. Export는 `compareMode='none'`이며 이 플래그를 전달하지 않는다.
- `seed`, `sourceWidth`, `sourceHeight`는 픽셀 정합성에 필요하므로 두 경로가 같은 값을 공유한다.
- 계약 게이트: `tests/engineContracts.test.ts`, `tests/engineContractCorrective.test.ts`, `tests/e2e/render-parity.spec.ts`.

### 7.1 Export 취소 계약 (Q04 IF-01 / APP-03)

- `prepareExportImage(image, lut, settings, options, onProgress?, control?)`의 선택적 6번째 인자로 `ExportControl { signal?: AbortSignal; onStage?: (stage: 'render'|'encode'|'complete') => void }`를 받는다.
- `onStage`는 `render → encode → complete` 순서로 호출한다. 기존 `ExportOptions`와 호출부는 변경하지 않는다.
- 각 단계 경계에서 `signal.aborted`를 확인하고, 취소 시 `DOMException('Export cancelled', 'AbortError')`로 거부한 뒤 renderer/canvas를 즉시 해제한다.
- `canvas.toBlob`은 중단 API가 없으므로 인코딩 완료 후 결과 Blob/objectUrl을 생성하지 않고 폐기한다. 인코딩 자체의 즉시 중단은 후속 과제다.
- Q01 `ExportModal`이 `AbortController`를 생성해 `control`을 전달하고, 진행 중 `Cancel Export` 버튼으로 `abort()`를 호출한다. `AbortError`는 오류가 아니라 `Export cancelled.` 안내로 정산한다(`tests/exportModalCancel.test.tsx`).
- Q04 배치는 `AbortError`를 cancelled로 정산하고, GPU 리소스·objectUrl 누수가 없어야 한다.

## 8. Recipe 버전·저장·v8 계약

- `RECIPE_SCHEMA_MAX = 7`, `CURRENT_SCHEMA_VERSION = 7`이다. v8은 계약 정의만 존재한다.
- 버전 식별과 전체 검증을 분리한다.
  - `detectRecipeSchemaVersion(value)`: 선언된 정수 버전 또는 `null`(판별 전용).
  - `assertRecipeVersionSupported(value, max=7)`: 누락은 현재 상한으로 간주하고, 0 이하·정수 아님·상한 초과는 `Unsupported recipe version`.
  - `assertRecipePersistable(recipe, storageKey)`: 저장 키와 버전 상한을 함께 검사한다.
- 저장 키는 `RECIPE_STORAGE_KEYS.stable`/`.beta`로 분리되며 `resolveRecipeStorageKey(baseUrl)`가 `/beta/` 여부로 선택한다. Stable과 Beta 레시피가 섞이지 않는다.
- `persistRecipes`는 저장 전 `assertRecipePersistable`을 호출한다. 미래 스키마는 IndexedDB에 쓰지 않는다.
- v1~v7 가져오기에서 `geometry` 등 미승인 필드는 `migrateRecipe`의 명시 필드 구성으로 제거된다.
- `RECIPE_SCHEMA_V8 = 8`, `RecipeV8 = CustomRecipe & { schemaVersion: 8; geometry }`.
- `toRecipeV8(recipe)`는 기존 v1~v7 정규화 결과에 중립 기하를 추가한다. 8 이상 또는 0 이하 버전은 `Unsupported recipe version for v8 migration`으로 거부한다.
- `normalizeRecipeV8Geometry`, `validateRecipeV8Geometry`를 제공한다. `validateRecipeV8Geometry`는 `geometry` 래퍼가 없는 flat 객체(`{rotation,...}`), `geometry: undefined/null`, 배열을 `Invalid recipe geometry wrapper`/`Invalid recipe geometry`로 거부한다. 래퍼가 유효해도 세부 오류는 `validateGeometry`가 던진다. flat 입력의 무음 identity 강등은 허용하지 않는다.
- 실제 스키마 상향·저장 연결은 기하 렌더 구현 체크포인트에서 수행한다.
- 마스크·로컬 보정은 v8에 포함하지 않는다.

## 9. 리소스 수명과 예산

```ts
interface ResourceScope {
  disposed: boolean;
  resources: readonly GpuResource[];
  acquire<T extends GpuResource>(factory: () => T): T;
  release(resource: GpuResource): void;
  disposeAll(): void;
  abandon(): void;                  // 컨텍스트 손실: GL delete 없이 폐기
}
```

- `disposeAll()`은 역순으로 해제하며 한 리소스의 예외가 나머지 해제를 막지 않는다.
- `acquireAll(scope, factories)`는 부분 할당 실패 시 이미 획득한 리소스를 역순으로 해제하고 원래 오류를 다시 던진다.
- 해제 후 `acquire`는 `Resource scope disposed`로 실패한다.
- 이미 해제된 리소스의 `release`는 무시한다(중복 해제 방지).
- `createRenderSession(lease?)`의 `finish()`/`cancel()`은 멱등이며 scope와 예산 lease를 한 번만 해제한다.
- `ResourceBudget`은 CPU/GPU 바이트, 최대 텍스처, Preview 최대 변, 동시성, float render target 지원을 담는다.
- `decideResourceAllocation(request, budget)`은 `full | proxy | tile`과 타일 크기, 거부 사유/사용자 안내 문자열을 반환한다.
- `ResourceBroker`는 Batch Queue와 Renderer가 공유한다. `request()`는 동시성·메모리 예산을 예약하고 `grant.release()`로 반환한다.
- 거부 사유: `invalid-request`, `float-render-target-unsupported`, `budget-exceeded`, `concurrency-limit`.
- 렌더러는 컨텍스트 손실·비활성화·destroy에서 소유 리소스를 모두 해제해야 한다. 컨텍스트 손실 직후에는 `abandon()`을 사용한다.

## 10. AI 확장 (Phase 2)

- `AIModuleDescriptor`는 `id`, `version`, `capability`, `requiresGpu`, `input:'image-buffer'`, `output`을 허용한다.
- `output`은 `AI_OUTPUT_KINDS`(`image-buffer`, `mask`, `depth-map`, `embedding`, `recommendation`) 중 하나 또는 중복 없는 배열이다.
- `AIResult`는 `image`, `mask`, `depthMap`, `embedding`, `recommendations`, `metadata`를 수용한다. Depth map은 `Float32Array`+near/far, embedding은 모델 ID+차원+벡터다.
- 허용 capability: `enhance`, `denoise`, `upscale`, `subject-mask`, `sky-replace`, `style-transfer`.
- `CORE_AI_MODULES`는 비어 있고 `isAIModuleAvailable()`은 false다.
- Phase 1에서 AI 모듈 등록·UI·추론·원격 전송을 추가하지 않는다.

## 11. 검증 명령

```bash
npm test
npx tsc --noEmit
npm run build
npm run build:beta
npx playwright test tests/e2e/render-parity.spec.ts
npx playwright test tests/e2e/geometry-contract.spec.ts --project=chromium
```

CP1.1 계약 변경 시 최소 `tests/engineContractCorrective.test.ts`, `tests/engineContracts.test.ts`, `tests/recipeCompat.test.ts`, 전체 Unit, Stable/Beta 빌드를 실행한다. Preview/Export·레시피 저장·기하 매핑을 건드리면 패리티·기하 E2E를 추가로 실행한다.

## 12. 변경 통제

- 공통 파일 수정은 `MODULE_OWNERSHIP.md`의 Q01 리뷰 대상이다.
- 기존 테스트 삭제·단정 완화·기준 이미지 무단 교체로 실패를 숨기지 않는다.
- 미구현 기능을 위한 빈 핸들러·더미 데이터·Mock UI·숨은 플래그를 추가하지 않는다.
- 비밀·평가 자료는 `.private/`에만 두고 Git·빌드 산출물에 포함하지 않는다.
