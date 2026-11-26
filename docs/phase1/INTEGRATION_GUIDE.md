# Phase 1 Interface Integration Guide (Q02/Q03/Q04)

상태: CP1.1 + SC-01 중재 · QA 승인 대기 · 2026-11-27
대상: Q02 Optical, Q03 Imaging, Q04 Application
공통 진입점: `src/engine/contracts/index.ts`

이 문서는 공통 계약을 어떤 순서와 형태로 소비해야 하는지만 정의한다. 각 모듈의 실제 구현·UI는 담당 작업 주문이 소유하며, 공통 파일 수정은 Q01 리뷰가 필요하다.

## 0. SC-01 중재 결정 (2026-11-27)

| 항목 | 결정 | 영향 |
| --- | --- | --- |
| 버퍼 경계 | 제품 경계는 Q01 `ImageBuffer`(linear-srgb, RGBA float). Q03 RGB 3ch `SceneLinearFrame`은 내부 전용이며 RGBA16F/32F 어댑터 필수. SDR도 float 작업 버퍼, `rgba8` 금지 | Q03 |
| 광학 경계 | Q02는 통합 시 Q01 `OpticalTransform(version:1, homography, distortion, optional perspective)`만 사용. Q02 `OpticalGeometry`는 내부 전용 | Q02 |
| 마스크 한도 | `MAX_MASKS=16`·`MAX_STROKES=64`·`MAX_STROKE_POINTS=1024`를 잠정 정본으로 유지. Q02 GLSL uniform 예산 제출 후 Q01이 확정 | Q02 |
| 간섭 마스크 수 | Q02 PoC의 8 masks/1024 segments는 통합 전 조정 대상이며 제품 계약이 아니다 | Q02 |
| EditState | `geometry` 포함은 CP1.1 범위 | Q04 |
| IF-01 Export 취소 | `ExportControl { signal?, onStage? }` 최소 계약을 CP1.1에 구현 | Q04 |
| IF-03 선택 상태 | CP1.1 미구현. PO 승인 전 연기. Q04 PoC 타입을 제품 계약으로 승격하지 않음 | Q04 |
| IF-05 추천 레지스트리 | CP1.1 미구현. PO 승인 전 연기 | Q04 |
| HARNESS_GUIDE | Q01 단독 소유. Q03/Q04는 직접 수정하지 않고 Q01에 변경 요청 | Q03/Q04 |

IF-03/IF-05 연기 사유: 두 항목은 애플리케이션 계층 상태·레지스트리로, CP1.1 공통 엔진 계약의 소비자가 아직 없고 제품 UX 결정(PO)이 선행되어야 한다. 계약을 먼저 고정하면 Q04 PoC 타입이 제품 계약으로 굳을 위험이 있다.

## 1. 공통 모듈 등록

```ts
import {
  createCoreRenderRegistry,
  resolveRenderPlan,
  type EditModule,
} from '../engine/contracts';

const registry = createCoreRenderRegistry();
const module: EditModule = {
  id: 'q02.optical.lens',
  stage: 'optical',
  contractVersion: 1,
  role: 'feature',
  requires: ['core.source'],
  isActive: (settings) => settings.optical !== undefined,
  resourceUsage: () => ({ floatIntermediate: false, textures: 2 }),
  execute: async ({ target, settings }) => {
    // target: 'preview' | 'export'; settings는 공통 RenderSettings
  },
};

registry.register(module);
const plan = resolveRenderPlan(settings, 'export', registry);
```

- 등록 후 원본 객체를 수정해도 registry는 바뀌지 않는다(내부 복사·동결).
- `requires`는 같은 단계 또는 이전 단계만 가능하다. 역순 등록은 허용되지만 stage 우선순위가 유지된다.
- 활성 모듈이 비활성 기능 모듈을 요구하면 계획 해석이 실패한다. 의존은 stage 모듈(`core.source`, `core.tone`)이나 반드시 활성인 모듈로 건다.
- 새 기능은 `renderPlan.ts`를 수정하지 않고 registry 등록만으로 `features`/`stages`/`floatIntermediate`에 반영된다.
- Preview/Export는 같은 `RenderSettings`에서 같은 지문을 가져야 한다. Preview 전용 값은 `RenderRequest`에만 둔다.

## 2. Q02 Optical 연동

1. 광학 수학은 Q01 `OpticalTransform`으로 결과를 낸다. Q02 PoC의 `OpticalGeometry`는 내부 표현으로만 사용하고 경계를 넘기지 않는다.
   - `homography`: corrected NIS → source NIS, 9개 row-major.
   - `distortion`: Brown-Conrady `k1,k2,k3,p1,p2`, centered space.
   - `perspective`: 단위 정사각형이 매핑되는 TL/TR/BR/BL quad.
2. `validateOpticalTransform(result)`를 통과해야 한다. 특이/비유한 행렬, 범위 초과 왜곡, 비볼록 quad는 렌더 전에 거부한다.
3. 좌표는 픽셀이 아니라 NIS(0..1, 좌상단)와 짧은 변 단위를 사용한다. Preview(≤2048)와 Export 원본 해상도에서 같은 값이어야 한다.
4. 마스크는 `src/engine/contracts/masks.ts`의 `MaskData`를 사용하고, 로컬 보정 그룹은 `LocalAdjustmentState`(`corrected-nis`)를 따른다. 자체 마스크 저장 포맷을 만들지 않는다.
5. 광학 단계는 원본 `ImageBuffer`를 수정하지 않고 샘플링 매핑만 반환한다.

```ts
import { createOpticalTransform, validateOpticalTransform } from '../engine/contracts';

const optical = createOpticalTransform({ distortion: { k1: -0.08 } });
validateOpticalTransform(optical);
```

Q02 PoC의 `poc/optical/**`는 통합 전 로컬 참고 자료이며 공개 문서·빌드 산출물에 포함하지 않는다.

## 3. Q03 Imaging 연동

1. 디코딩 결과는 `DecodedSource`를 만족해야 한다.
   - `working.colorSpace = 'linear-srgb'`
   - `working.format = 'rgba16f' | 'rgba32f'`
   - 원본 `source.id`와 버퍼 `sourceId` 일치, 원본 크기와 버퍼 크기 일치
2. `assertDecodedSource(value)`를 경계에서 호출한다. 추가로 `validateImageBuffer(buffer, source)`를 단독 사용할 수 있다.
3. `memoryBytes`는 `width × height × 4 × bytesPerPixel`, data 길이는 `width × height × 4`여야 한다. Float 버퍼의 NaN/Infinity는 거부된다.
4. GPU 버퍼를 넘길 때는 `resourceOwner`(비어 있지 않은 문자열)와 `disposable`(boolean)을 반드시 채운다. 소유자가 아니면 delete를 호출하지 않는다.
5. RAW/고정밀 경로에서 8-bit 작업 버퍼로의 암묵적 변환을 금지한다. SDR도 sRGB EOTF 후 float 작업 버퍼를 사용한다.
6. 디코더는 크롭·색 보정·날짜 합성을 하지 않는다. EXIF 방향/날짜는 별도 메타데이터로 전달한다.

```ts
import { assertDecodedSource } from '../engine/contracts';

const decoded = decode(file); // Q03 구현
assertDecodedSource(decoded); // 실패 시 파이프라인 진입 금지
```

## 4. Q04 Application 연동

### 4.1 편집 상태

- 분석/선택/복사-붙여넣기는 `EditState`를 사용하고 자체 편집 상태 타입을 만들지 않는다.
- IF-03 공용 선택 상태와 IF-05 추천 레지스트리는 CP1.1 범위 밖이다. PO 승인 전까지 Q04 PoC 타입을 공통 계약으로 승격하지 않는다.
- 로컬 보정은 `LocalAdjustmentState` 계약만 참조한다. 승인 전 UI·저장·렌더 활성화는 금지다.

### 4.2 배치/동시성/메모리

```ts
import {
  budgetForDevice,
  detectDeviceCapabilities,
  createResourceBroker,
  createRenderSession,
} from '../engine/contracts';

const budget = budgetForDevice(detectDeviceCapabilities());
const broker = createResourceBroker(budget);

const result = broker.request({
  width: source.width,
  height: source.height,
  format: 'rgba16f',
  floatIntermediate: true,
  mode: 'export',
});

if (!result.allowed) {
  showGuidance(result.decision.reason, result.decision.message);
} else {
  const session = createRenderSession(result.grant);
  try {
    await runExport(session.scope);
  } finally {
    session.finish(); // 멱등: scope와 grant를 한 번만 해제
  }
}
```

- `decideResourceAllocation`은 `full | proxy | tile`과 타일 크기를 돌려준다. 타일/축소를 임의로 우회하지 않는다.
- 거부 사유는 `invalid-request`, `float-render-target-unsupported`, `budget-exceeded`, `concurrency-limit`이며 `RESOURCE_GUIDANCE`의 사용자 안내를 사용한다.
- 취소·실패·완료 모든 경로에서 `session.cancel()`/`finish()`로 예산 lease를 반환한다.
- 컨텍스트 손실 직후에는 `scope.abandon()`을 사용하고, 복구 후 새 scope/session을 만든다. 손실된 GL 객체에 delete를 호출하지 않는다.
- 부분 할당 실패는 `acquireAll(scope, factories)`로 처리한다.

### 4.3 Export 취소 (IF-01)

```ts
import { prepareExportImage } from '../engine/export/imageExporter';
import type { ExportControl } from '../engine/contracts';

const controller = new AbortController();
const control: ExportControl = { signal: controller.signal, onStage: (stage) => setStage(stage) };
await prepareExportImage(image, lut, settings, options, onProgress, control);
```

- `onStage`는 `render → encode → complete` 순서다. 각 경계에서 취소를 확인한다.
- 취소 시 `AbortError`로 거부하고 renderer/canvas를 즉시 해제한다. `toBlob` 완료 후에는 Blob/objectUrl을 만들지 않고 폐기한다.
- `ExportOptions`는 변경하지 않는다. 기존 호출부는 6번째 인자를 생략하면 동작이 동일하다.
- Q01 `ExportModal`은 이미 `AbortController` + 진행 중 `Cancel Export` 버튼으로 배선되어 있다. Q04 배치·다른 호출부도 동일하게 controller를 소유하고 `AbortError`를 cancelled로 정산한다.

### 4.4 레시피 저장

- `resolveRecipeStorageKey(baseUrl)`가 Stable/Beta IDB 키를 선택한다. Beta 레시피를 Stable 키에 쓰지 않는다.
- 저장 전 `assertRecipePersistable(recipe, key)`를 통과해야 한다. 현재 상한은 7이며 v8 geometry는 저장되지 않는다.
- v1~v7 가져오기는 기존 `validateRecipeJSON`/`migrateRecipe`를 그대로 사용한다. 미승인 필드는 저장 스키마로 복사되지 않는다.

## 5. 검증 게이트

```bash
npm test
npx tsc --noEmit
npm run build
npm run build:beta
npx playwright test tests/e2e/render-parity.spec.ts
npx playwright test tests/e2e/geometry-contract.spec.ts --project=chromium
```

- Q01 계약 변경: `tests/engineContractCorrective.test.ts` + `tests/engineContracts.test.ts`.
- 레시피: `tests/recipeCompat.test.ts` (v1~v7).
- Preview/Export: `tests/e2e/render-parity.spec.ts` 실제 픽셀 비교.
- 기하: `tests/e2e/geometry-contract.spec.ts` CPU/GPU 매핑 일치.

## 6. 금지 사항

- 공통 파일 무단 변경, 자체 렌더 경로/자체 EditState 생성.
- `docs/HARNESS_GUIDE.md` 직접 수정(Q01 단독 소유, 변경은 Q01에 요청).
- 미구현 기능의 Mock UI·가짜 데이터·숨은 활성 플래그.
- 8-bit 작업 버퍼, 비선형 작업 버퍼, 검증 우회.
- main/beta 직접 수정, 승인 전 운영 배포.
- 기존 테스트 삭제·단정 완화.
