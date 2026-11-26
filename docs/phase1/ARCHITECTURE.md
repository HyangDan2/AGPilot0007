# Phase 1 Engine Architecture

상태: CP1 설계안 · QA 승인 대기 · 2026-11-27
기준 Commit: main `b850f82`, beta `d8ec276`, integration `feature/phase1-pro-engine` (CP0 `c31c790`)
범위: Phase 1 Non-AI. AI 추론·생성·외부 API·서버 기능은 Phase 2 계약만 정의하고 구현하지 않는다.

## 1. 설계 목표

- 기존 필름 프로파일, LUT, 색 수학, 레시피 v1~v7 동작을 보존한다.
- Preview와 Export가 같은 `RenderSettings`와 같은 파이프라인 계획을 사용한다.
- 원본 픽셀은 수정하지 않는다. 자르기·회전·광학 보정·색 처리는 렌더 시점에만 적용한다.
- Q02(광학), Q03(이미징/RAW), Q04(애플리케이션)가 공통 파일을 고치지 않고 모듈을 등록할 수 있게 한다.
- 리소스는 소유 범위를 명시하고 컨텍스트 손실·비활성화·종료 시 즉시 해제한다.
- 미구현 기능은 계약만 두며 UI·가짜 데이터·Mock 동작을 추가하지 않는다.

이번 CP1은 계약과 문서, 순수 검증 함수만 추가한다. 렌더러·셰이더·스토어의 대규모 리팩토링과 기하 보정의 실제 렌더 연결은 QA 승인 뒤 CP1 구현 단계에서 수행한다.

## 2. 현재 엔진 (as-is)

- WebGL2 단일 프래그먼트 프로그램이 색 처리와 광학/그레인/날짜를 한 번에 계산한다.
- Preview는 최대 2048px 축소 캔버스, Export는 `prepareExportImage(image, lut, settings, options)`로 원본 해상도를 처리한다.
- 상태는 Zustand 스토어(editor/ui/workspace/recipe)가 소유하고, `editorStore`의 `EditorSnapshot` 이력은 최대 50개다.
- 레시피는 `CURRENT_SCHEMA_VERSION = 7`이며 camera/curves/sharpening/colorMixer 기능 그룹을 registry로 정규화한다.
- CP0에서 다음 공통 기반을 추가했다.
  - `src/engine/pipeline/renderSettings.ts`: `RenderSettings`, `RenderRequest`
  - `src/engine/pipeline/recipeFeatures.ts`: `RECIPE_FEATURES`
  - `src/engine/pipeline/shaderChunks.ts`: `FRAGMENT_FEATURE_CHUNKS`
  - `src/engine/renderer/renderTarget.ts`: `RenderTarget`
  - `tests/recipeCompat.test.ts`, `tests/e2e/render-parity.spec.ts`

기존 셰이더의 처리 순서는 다음과 같다(변경 금지, 계약의 기준선).
sRGB 입력 → 선형화/노출/화이트밸런스 → RGB Base → 하이라이트/섀도 → 대비 → Whites/Blacks → 3D LUT → 톤 커브 → Color Lab → 전체 채도 → 광학/그레인/비네트 → 고급 샤프닝 보조 단계 → 날짜 합성.

## 3. 목표 파이프라인

단계 순서는 `src/engine/contracts/stages.ts`의 `PIPELINE_STAGES`가 유일한 기준이다.

| 단계 | 소유 | 모듈 ID(예약) | 상태 | 입력 → 출력 |
| --- | --- | --- | --- | --- |
| source | Q03 | `q03.imaging.decode` | PoC | 파일/비디오 프레임 → `DecodedSource.working`(linear-srgb float) |
| optical | Q02 | `q02.optical.lens`, `q02.optical.perspective` | PoC | 보정 전 선형 버퍼 → 렌즈/원근 보정 버퍼 |
| geometry | Q01 | `q01.geometry.transform` | 계약만 | 보정 버퍼 → 회전/반전/스트레이트/크롭 적용 버퍼 |
| tone | Core(Q01) | `core.tone.base` | 기존 | 노출·WB·RGB Base·하이라이트/섀도·대비·Whites/Blacks |
| look | Core(Q01) | `core.look.film`, `core.look.curves` | 기존 | LUT 혼합, 톤 커브 |
| colorLab | Core(Q01) | `core.colorLab.mixer` | 기존 | Spectrum/Color Focus/RGB Base, 전체 채도 |
| detail | Core(Q01) | `core.detail.sharpening` | 기존 | 고급 샤프닝(FBO 중간 버퍼) |
| composite | Core(Q01) | `core.composite.camera` | 기존 | Glow/Halation/Softness, 그레인/비네트, 날짜 |
| output | Core(Q01) | `core.output.encode` | 기존 | 캔버스/PNG/JPEG/공유 |

광학 보정을 기하보다 먼저 두는 이유는 렌즈·원근 보정이 전체 프레임을 대상으로 하고, 자르기·스트레이트는 보정된 화면을 기준으로 사용자가 정하기 때문이다. Q02는 보정 좌표를 정규화 이미지 좌표로 반환하고, Q01 기하는 그 결과에 크롭을 적용한다.

## 4. 모듈 Registry와 의존성

- 모든 기능 모듈은 `EditModuleRegistry`에 `{ id, stage, requires, contractVersion: 1 }`으로 등록한다.
- `requires`는 같은 단계 또는 이전 단계 모듈만 가리킬 수 있다. 이후 단계 의존은 등록/해석 시 오류다.
- 실행 순서는 `PIPELINE_STAGES` 순서를 유지하는 안정적 위상 정렬이다. 등록 순서가 같으면 결과도 같다.
- 순환 의존, 중복 ID, 알 수 없는 의존은 예외로 중단한다. 암묵적 순서에 의존하지 않는다.
- 셰이더 기능은 `FRAGMENT_FEATURE_CHUNKS`에, 레시피 기능은 `RECIPE_FEATURES`에 등록한다. 렌더러에 기능별 분기를 하드코딩하지 않는다.

## 5. 데이터 흐름과 계약

```
File / Video frame
  → Q03 decode: DecodedSource { source, working(linear-srgb rgba16f/32f), preview? }
  → Q02 optical (정규화 좌표, 원본 비파괴)
  → Q01 geometry (rotation/flip/straighten/crop, 정규화 좌표)
  → core tone/look/colorLab/detail/composite (기존 WebGL 파이프라인)
  → Preview canvas 또는 Export blob
```

- `ImageBuffer`는 CPU/GPU 저장 위치와 float 형식을 명시한다. 작업 버퍼는 반드시 `linear-srgb`이며 `rgba8`을 허용하지 않는다.
- `EditState`는 한 사진의 편집 상태다. CP1부터 `geometry`를 포함하며, 로컬 마스크는 계약 타입만 있고 상태·레시피에 저장하지 않는다.
- `RenderSettings`는 Preview/Export 공통 입력이다. 새 편집 그룹은 반드시 여기에 추가한다.
- `RenderRequest`의 비교/분할/마스크 보기/드래프트/reference/visualize 플래그는 Preview 전용이며 Export 픽셀에 영향을 주지 않는다.
- `RenderPlan`은 활성 단계·기능과 float 중간 버퍼 필요 여부를 계산한다. Preview와 Export는 같은 설정에서 같은 `renderPlanFingerprint`를 가져야 한다.

## 6. Preview/Export 정합성

1. 두 경로 모두 `RenderSettings`를 동일하게 정규화한다.
2. `resolveRenderPlan(settings, target)`으로 활성 기능을 결정하고, target 외에는 동일한 계획을 사용한다.
3. Export는 `compareMode = 'none'`으로 렌더하며 Preview 전용 플래그를 전달하지 않는다.
4. 그레인 seed, 샤프닝 반경 환산용 `sourceWidth/sourceHeight`처럼 픽셀에 영향을 주는 값은 두 경로가 같은 값을 공유한다.
5. 게이트: `npx playwright test tests/e2e/render-parity.spec.ts` (PNG 0~1, JPEG ≤8), `tests/engineContracts.test.ts`의 계획 지문 동등성.

## 7. Undo/Redo와 GPU 수명

- Undo/Redo 단위는 `EditState` 스냅샷이다. 기존 `editorStore`의 최대 50개 이력을 유지한다.
- 기하·광학·마스크가 편집 이력에 들어갈 때도 원본 `ImageBuffer`를 복제하지 않고 설정값만 저장한다.
- GPU/Worker 리소스는 `ResourceScope`로 획득하고 역순으로 해제한다. 컨텍스트 손실·복구·비활성화·destroy에서 누수가 없어야 한다.
- 기존 `RenderTarget`은 샤프닝 중간 버퍼를 소유하며 CP0에서 해제 경로를 갖췄다. 신규 모듈도 같은 규칙을 따른다.
- 대용량 원본은 세션에 보관하지 않는다(기존 workspace 정책 유지).

## 8. RAW/고정밀 경계

- Q03이 디코딩을 소유한다. SDR JPEG/PNG/WebP는 sRGB EOTF로 선형화하고, RAW는 장면 선형 float로 유지한다.
- 공통 파이프라인 입력은 항상 `WorkingColorSpace = 'linear-srgb'`, `rgba16f` 또는 `rgba32f`다.
- `assertDecodedSource`가 형식·색공간·차원 일치를 검사한다. 8-bit 작업 버퍼는 거부한다.
- Phase 1 출력은 sRGB 8-bit PNG/JPEG다. 16-bit/ICC/Display-P3 출력은 제품 범위 밖이며 주장하지 않는다.
- 디코더는 원본을 자르거나 클리핑하지 않고, 메타데이터(EXIF 날짜/방향)를 별도로 전달한다.

## 9. Recipe v8

- v8 = v7 + `geometry`. 상세는 `docs/phase1/RECIPE_SCHEMA.md`.
- `src/engine/contracts/recipeV8.ts`의 `toRecipeV8`은 기존 v7 정규화 결과에 중립 기하를 추가하는 순수 함수다.
- 실제 `CURRENT_SCHEMA_VERSION` 상향과 레시피 저장 연결은 기하 렌더 구현이 완료되는 시점에 수행한다. 그 전까지 기존 v7 저장/내보내기 동작을 바꾸지 않는다.
- 마스크는 v8에 저장하지 않는다. 마스크 기능이 승인되면 v9에서 정의한다.

## 10. AI 확장 경계 (Phase 2)

- `src/engine/contracts/ai.ts`는 설명자·요청·결과·모듈 인터페이스만 정의한다.
- `CORE_AI_MODULES`는 비어 있고 `isAIModuleAvailable()`은 항상 false다.
- Phase 1에서는 AI UI, 모델 다운로드, 추론, 원격 전송을 추가하지 않는다. Phase 2에서도 별도 승인·라이선스·번들 검증이 선행되어야 한다.

## 11. 병렬 작업과 통합

- Q01은 공통 계약·파이프라인·레시피·렌더러를 소유한다.
- Q02는 optical, Q03은 imaging/source, Q04는 application 모듈을 소유한다.
- 각 작업 주문은 자기 파일만 수정하고, 공통 파일 변경은 Q01 리뷰를 요청한다. 세부 소유권은 `MODULE_OWNERSHIP.md`.
- 통합 순서는 source(Q03) → optical(Q02) → geometry(Q01) → 기존 색 파이프라인 → application(Q04)이며, 각 단계는 계약 테스트와 회귀 게이트를 통과해야 한다.
- main/beta 병합과 운영 배포는 QA 승인 이후에만 수행한다.
