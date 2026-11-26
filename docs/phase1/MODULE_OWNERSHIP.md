# Phase 1 Module Ownership

상태: CP1.1 소유권 보완 · QA 승인 대기 · 2026-11-27

목적: Q02/Q03/Q04가 공통 파일을 건드리지 않고 자기 모듈을 구현하도록 경계를 고정한다. 소유 경로 밖 변경은 Q01 리뷰 후에만 수행한다.

## 1. 브랜치와 작업 공간

| 작업 | 브랜치 | 로컬 경로 | 기준 |
| --- | --- | --- | --- |
| Stable | `main` | `AGPilot0007` | `b850f82` |
| Beta | `beta` | 원격 | `d8ec276` |
| Q01 Core / Integration | `feature/phase1-pro-engine` | `AGPilot0007-phase1` | CP1 `3b22b6f` + beta merge `2a45290` + CP1.1 |
| Q02 Optical | `feature/phase1-q02-optical` | `AGPilot0007-wt/feature-phase1-q02-optical` | `b850f82` + PoC |
| Q03 Imaging | `feature/phase1-q03-imaging` | `AGPilot0007-q03-imaging` | `b850f82` + PoC |
| Q04 Application | `feature/phase1-q04-application` | `AGPilot0007-q04` | `b850f82` + PoC |

main 직접 수정·병합, beta 직접 병합, 다른 작업 주문의 worktree 수정은 금지한다.

## 2. 경로 소유권

### Q01 — Core / Integration

- `src/engine/contracts/**` (신규 계약 전체)
  - `geometryMappings.ts`: 기하 순/역매핑·적용 순서 기준
  - `optical.ts`: Q02 광학 데이터 계약(호모그래피/원근/왜곡)
  - `localAdjustments.ts`: 마스크 그룹·그룹별 보정 계약(미활성)
  - `resourceBudget.ts`: 기기 예산·proxy/tile/full·공유 Broker
  - `recipeValidation.ts`: 버전 판별·저장 키·저장 가드
- `src/engine/pipeline/**` (`renderSettings`, `recipeFeatures`, `shaderChunks`)
- `src/engine/renderer/**` (`webglRenderer`, `shaderManager`, `renderTarget`)
- `src/engine/export/**`
- `src/engine/color/**` (기존 LUT/색 수학, 변경 금지)
- `src/engine/image/**` (기존 디코더 어댑터; Q03 통합 시 Q01 리뷰)
- `src/types/**` (공통 타입 정규화)
- `src/stores/editorStore.ts`, `src/stores/recipeStore.ts`, `src/stores/uiStore.ts`
- `src/components/Viewport.tsx`, `src/components/ExportModal.tsx`
- `src/components/App*.tsx` 중 공통 셸
- `tests/engineContracts.test.ts`, `tests/engineContractCorrective.test.ts`, `tests/recipeCompat.test.ts`, `tests/e2e/render-parity.spec.ts`, `tests/e2e/geometry-contract.spec.ts`
- `docs/phase1/**`, `docs/HARNESS_GUIDE.md`

### Q02 — Optical

- `src/engine/optical/**` (좌표계, 호모그래피/원근, 왜곡, 스큐, 초점/피사계, 마스크 합성)
- `src/components/optical/**` 또는 광학 전용 신규 컴포넌트
- 광학 전용 셰이더 청크는 파일을 소유하되, `FRAGMENT_FEATURE_CHUNKS` 등록은 Q01 리뷰
- `tests/optical-math.test.ts`, `tests/e2e/optical-*.spec.ts`
- PoC `poc/optical/**`는 통합 전 로컬 참고 자료이며 공개 문서/빌드에 포함하지 않는다.

Q02 규칙:
- 광학 좌표는 정규화 이미지 좌표와 짧은 변 단위를 사용하고 픽셀 좌표를 저장하지 않는다.
- 원본 버퍼를 수정하지 않고 보정 매핑만 반환한다.
- `MaskData`는 `src/engine/contracts/masks.ts` 계약으로 맞춘다. 별도 저장 스키마를 만들지 않는다.
- 광학 결과는 `OpticalTransform`(`homography`, `distortion`, `perspective`)으로 전달하고, `validateOpticalTransform`을 통과해야 한다. 특이 행렬·비볼록 quad는 렌더 전에 거부한다.
- `LocalAdjustmentState`가 소비할 마스크 그룹 좌표는 광학·기하 이후의 `corrected-nis`다.
- 기존 LUT·색 수학·날짜 합성 코드를 수정하지 않는다.

### Q03 — Imaging / Source

- `src/engine/imaging/**` (RAW/SDR/비디오 디코딩, EXIF 방향/날짜 추출, 작업 버퍼 생성)
- `src/workers/imaging/**`
- `public/raw/**` 등 디코더 WASM/에셋(라이선스·번들 크기 검증 동봉)
- 디코딩 관련 테스트와 fixture
- PoC `poc/q03-imaging/**`는 로컬 참고 자료이며 커밋하지 않는다.

Q03 규칙:
- 출력은 `DecodedSource` 계약을 만족해야 한다(`linear-srgb`, `rgba16f|rgba32f`, 원본 크기 일치).
- `validateImageBuffer`를 통과해야 한다: data 타입/길이, `memoryBytes`, `sourceId`, 비유한 픽셀 검사. GPU 버퍼는 `resourceOwner`/`disposable` 필수.
- 디코딩 단계에서 크롭·색 보정·날짜 합성을 하지 않는다.
- 외부 디코더 도입 시 라이선스, 번들 크기, 브라우저 호환성, 스레드/WASM 요구사항을 문서화한다.
- 원본 파일을 업로드하거나 수정하지 않는다.

### Q04 — Application

- `src/engine/application/**` (분석, 추천, 선택/복사-붙여넣기, 배치 큐/내보내기, 메타데이터)
- `src/stores/workspaceStore.ts` 및 workspace 관련 신규 스토어/컴포넌트
- 배치/메타데이터/워크스페이스 테스트
- PoC `src/poc/q04/**`는 로컬 참고 자료이며 통합 시 `src/engine/application/**`로 옮긴다.

Q04 규칙:
- `EditState`는 `src/engine/contracts/editState.ts`를 사용하고 자체 편집 상태 타입을 만들지 않는다.
- 배치 Export는 `prepareExportImage`와 `RenderSettings`를 그대로 사용하며 별도 렌더 경로를 만들지 않는다.
- 동시 실행 수는 기기 프로파일 기반으로 제한하고, GPU/디코딩 리소스를 명시적으로 해제한다.
- 배치 작업은 `ResourceBroker.request()`로 예산을 예약하고 `grant.release()`를 모든 종료 경로에서 호출한다.
- `decideResourceAllocation`의 `full/proxy/tile`과 거부 사유를 UI 안내에 사용한다. 타일/축소를 임의로 우회하지 않는다.
- 메타데이터는 로컬에서만 읽고 서버로 전송하지 않는다.

## 3. 공통 파일 (Q01 리뷰 필수)

다음 파일은 모든 작업 주문이 필요할 수 있으나 충돌 위험이 크므로 Q01 승인 후 수정한다.

- `src/engine/pipeline/renderSettings.ts`
- `src/engine/pipeline/recipeFeatures.ts`
- `src/engine/pipeline/shaderChunks.ts`
- `src/engine/renderer/webglRenderer.ts`
- `src/engine/renderer/shaderManager.ts`
- `src/engine/renderer/renderTarget.ts`
- `src/engine/color/**`
- `src/types/**`
- `src/stores/editorStore.ts`, `src/stores/recipeStore.ts`
- `src/components/Viewport.tsx`, `src/components/ExportModal.tsx`
- `src/films/**`, `src/presets/**`, `public/luts/**`
- `package.json`, `package-lock.json`, `vite.config.ts`, `playwright.config.ts`
- `.github/workflows/**`
- `docs/HARNESS_GUIDE.md`, `docs/phase1/**`

공통 파일 변경 요청 시 다음을 포함한다: 목적, 필요한 최소 diff, 계약 영향, 실행한 검사, 되돌릴 방법.

## 4. 통합 순서

1. Q01 CP1.1 계약 — registry 동적 활성화, 기하 매핑, 광학/로컬/예산/버전 계약.
2. Q03 source — `DecodedSource`를 실제로 생성하고 이미지 무결성 테스트 통과.
3. Q02 optical — `OpticalTransform` 등록, 마스크·로컬 좌표 계약 정렬.
4. Q01 geometry — 기하 렌더/UI 구현, Recipe v8 스키마 상향.
5. Core 기능 확장 — histogram/clipping/WB eyedropper, 상세 샤프니스 연동.
6. Q04 application — 분석/배치(공유 Broker)/메타데이터/워크스페이스.
7. QA 승인 후 Integration → beta/main 순서로 병합·배포.

각 단계는 이전 단계의 계약 테스트와 패리티 게이트를 깨뜨리지 않아야 한다.

## 5. 테스트 소유권

- Q01: `tests/engineContracts.test.ts`, `tests/engineContractCorrective.test.ts`, `tests/recipeCompat.test.ts`, `tests/e2e/render-parity.spec.ts`, `tests/e2e/geometry-contract.spec.ts`, 공통 회귀.
- Q02: 광학 수학·GPU PoC·광학 E2E.
- Q03: 디코딩 단위/브라우저 테스트, RAW fixture.
- Q04: 분석·배치·메타데이터·워크스페이스 테스트.
- 다른 작업 주문의 테스트를 삭제하거나 단정(locator/기대값)을 약화해 실패를 숨기지 않는다. 실패 시 재현 입력과 trace를 `.private/`에 보존하고 원인을 수정한다.

## 6. 금지 사항

- main/beta 직접 수정·병합, 승인 없는 운영 배포.
- 공통 파일 무단 변경, 다른 모듈의 내부 함수 직접 호출.
- 미구현 기능의 Mock UI·가짜 데이터·숨은 활성 플래그.
- 원본 업로드·서버 처리·분석 전송·AI 추론 추가.
- LUT/필름 프로파일/색 수학 변경(승인 없는 한).
- 기존 테스트 삭제·단정 완화·기준 이미지 무단 교체.
- `.private/` 자료를 Git·공개 문서·`public/`·빌드 산출물에 복제.

## 7. 완료 보고 형식

담당 엔지니어 / 작업 브랜치 / 기준 Commit SHA / 완료 Commit SHA / 구현 범위 / 변경 파일 / 테스트 결과 / 성능·메모리 측정 / 미해결 결함 / 원격 Push 확인 / 다음 Checkpoint.

실행하지 않은 검사를 통과로 표시하지 않는다. 원격 Push와 배포·공개 URL 확인은 각각 별개로 보고한다.
