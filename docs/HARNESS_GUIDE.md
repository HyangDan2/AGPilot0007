# Film Studio 개발·검증 하네스

상태: 현재 저장소에서 확인한 작업 절차 · 2026-11-11

## 1. 범위와 제품 계약

이 가이드는 AGPilot0007 Film Studio의 소스, 검사, GitHub Pages 배포를 다룬다. 사용자 지시가 우선한다. 앱은 WebGL2로 사진을 브라우저 안에서 처리하며, 사진 원본을 서버로 보내지 않는다. 사용자 레시피는 브라우저의 IndexedDB에 저장한다. 새로운 네트워크 전송, 분석 수집, 서버 기능은 명시적 제품 요구가 있을 때 설계한다.

`src/`는 앱·색 처리 엔진·UI, `public/`은 공개 정적 자산과 LUT, `tools/`는 자산 생성 도구, `tests/`는 단위·브라우저 검사를 소유한다. `dist/`는 빌드 산출물이며 Git에서 제외한다. `research/`는 원본 연구 자료를 담는 로컬 폴더로 Git에서 제외한다.

## 2. 작업 순서

1. `README.md`, 이 문서, 변경 대상 파일과 관련 문서를 읽고 `git status --short`로 기존 변경을 확인한다.
2. 변경 목적, 영향받는 경로, 완료 조건을 정한다. 필요한 부분만 수정한다.
3. 관련 검사를 실행하고 결과를 확인한다. 화면·색·내보내기 변경은 실제 이미지를 눈으로 확인한다.
4. 명령·구조·동작·배포 방식이 달라졌다면 문서를 함께 갱신한다.
5. 수정 파일, 실행한 검사와 결과, 남은 미검증 항목, Git·배포 상태를 구분해 보고한다.

## 3. 현재 실행 가능한 명령

Node.js 22와 npm lockfile을 기준으로 `npm ci`를 사용한다. LUT 생성에는 Python과 `numpy`, `scipy`, `pillow`가 필요하며 CI는 Python 3.11을 사용한다.

| 명령 | 역할 |
| --- | --- |
| `npm run dev` | Vite 개발 서버 (기본 5173) |
| `npm test` | Vitest 단위 검사 |
| `npm run build` | TypeScript 검사와 Vite 정적 빌드 |
| `npm run test:e2e` | Playwright 브라우저 검사; 설정이 개발 서버를 시작함 |
| `npm run generate-luts` | Python 도구로 LUT 재생성; 생성 파일 차이를 검토해야 함 |
| `npm run preview` | 빌드 산출물 로컬 미리보기 |

현재 `verify`, `lint`, 별도 `typecheck` 명령은 없다. `npm run build`에 TypeScript 검사가 포함된다. Playwright 실행에는 해당 브라우저 바이너리가 설치되어 있어야 한다.

## 4. 변경별 검증

| 변경 | 최소 확인 |
| --- | --- |
| 색 과학·톤 커브·LUT·필름 프로필 | 관련 Vitest, `npm run build`, 대표 사진의 전후 색감·피부·하이라이트·암부 확인. LUT 생성 시 수치·파일 차이 검토 |
| 화면·반응형·제스처·탐색 | 관련 Playwright, 데스크톱과 모바일 화면을 직접 확인. 잘림·가로 넘침·초점·콘솔 오류 확인 |
| 이미지 디코딩·내보내기·공유 | 관련 단위·E2E 검사, 결과 파일의 크기·형식·화질 확인. 실제 iOS/Android 공유·사진 앱 저장은 실기기에서 따로 확인 |
| PWA·경로·배포 설정 | `npm run build`, `/AGPilot0007/` 경로에서 HTML·JS·CSS·LUT·썸네일·아이콘 요청 및 오프라인 재방문 확인 |
| 문서만 변경 | 링크·경로·명령과 현재 파일의 일치 여부 확인. 실행하지 않은 앱 검사는 기록하지 않음 |

WebGL 시각 품질은 테스트 통과만으로 판정하지 않는다. 브라우저 에뮬레이션은 실기기 사진 저장이나 GPU 동작을 증명하지 않는다. `docs/VALIDATION.md`의 과거 검사 수치는 해당 시점의 기록이며 현재 변경의 통과 증거로 재사용하지 않는다.

## 5. GitHub Pages와 공개 확인

`.github/workflows/deploy.yml`은 `main` push 또는 수동 실행에서 Python 의존성 설치 → LUT 생성 → `npm test` → `npm run build` → `dist/` 업로드 → GitHub Pages 배포를 수행한다. 현재 CI에는 Playwright E2E가 없다. `vite.config.ts`는 GitHub Actions에서 base를 `/AGPilot0007/`, 그 밖에서는 `./`로 설정한다.

로컬 빌드, CI 성공, Pages 게시, 공개 화면 정상 동작은 서로 다른 결과다. 게시 후에는 `https://hyangdan2.github.io/AGPilot0007/`에서 홈과 주요 자산, 사진 편집, 내보내기를 확인하고 실제 확인한 범위만 보고한다. PWA 서비스 워커의 이전 캐시가 새 빌드를 가릴 수 있으므로 업데이트·새로고침 동작을 살핀다.

## 6. 실패와 완료 기록

기밀 조사, 외부 원본과의 대응표, 평가 계획·리포트 및 증거는 Git 제외 폴더 `.private/`에서만 관리한다. `git add -f`로 포함하거나 공개 문서·정적 자산에 내용을 복제하지 않는다. 커밋 전 `git ls-files .private` 결과가 비어 있는지 확인한다. 이미 커밋된 자료는 ignore 추가만으로 이력에서 사라지지 않는다.

Vite 개발 서버도 `.private/` 파일 접근을 거부하고 해당 폴더와 `research/`의 변경 감시를 제외한다. 기밀 자료를 앱 코드에서 import하지 않는다.

오른쪽 숫자값 버튼의 클릭·탭은 해당 항목만 `ADJUSTMENT_DEFINITIONS`의 기본값으로 되돌린다. 슬라이더에는 더블클릭 초기화를 연결하지 않는다. 숫자 버튼은 기존 숫자 표시 크기를 유지하고 추가 높이·여백을 두지 않으며, 키보드로도 실행할 수 있다. 레시피 관리 창은 목록·알림에 의해 위치가 이동하지 않도록 높이와 알림 영역을 유지하고 목록 내부를 스크롤한다. 관련 회귀 검사는 `npx playwright test tests/e2e/adjustment-recipe.spec.ts`로 실행한다.

실패하면 재현 입력 사진, 브라우저·화면 크기, 명령, 오류, 관련 스크린샷이나 trace를 보존하고 원인을 수정한 뒤 해당 검사를 다시 실행한다. 검사를 약화하거나 기준 이미지를 무작정 교체해 실패를 숨기지 않는다.

완료 보고에는 변경 목적과 파일, 실제 실행한 명령과 결과, 수동으로 확인한 화면·이미지·기기, 커밋·push 여부, 게시 여부와 공개 URL 확인, 남은 문제를 적는다. 일시적인 실행 결과는 답변이나 작업 기록에 남기고, 장기적인 제품 제약과 절차 변경만 이 가이드에 반영한다.


## 2026-11-12 조정 시트와 마가린 컬렉션

- 모바일 조정 시트는 fixed 오버레이이며 열기·닫기로 사진 컨테이너 크기나 zoom/pan이 바뀌지 않아야 한다. 다른 버튼을 제외한 헤더 전체 클릭·탭·닫기·Escape·헤더 아래 방향 드래그, 가로 화면과 키보드 조작을 확인한다.
- FS-009 다음 MARGARINE을 처음 선택하면 마지막 독자 프리셋을 적용하고, 선택 상태에서 다시 누르면 검색·분류 가능한 모달을 연다. 공개 데이터는 `src/presets/margarine.ts`에서 관리한다.
- 기존 FilmId와 preset ID는 별개다. 레시피 스키마 1에 선택적 presetId/presetVersion을 보존하며, 기존 레시피도 가져올 수 있어야 한다. Undo/Redo는 보정값·기반 필름·프리셋을 함께 복원한다.
- 관련 검증: `npm test`, `npx playwright test tests/e2e/margarine.spec.ts tests/e2e/adjustment-recipe.spec.ts`, `npm run build`. 파이프라인·저장 변경은 기존 내보내기·탐색·렌더링 검사도 실행한다.
- 기밀 조사·원본 대응·색감 평가 리포트는 `.private/`에만 기록하며 공개 데이터/문서에 복제하지 않는다.

- 접힌 조정 메뉴에는 위쪽, 열린 패널에는 아래쪽 셰브론을 표시한다. 숫자 버튼은 hover·키보드 focus 툴팁과 패널 도움말로 단일 항목 초기화를 안내한다. 숫자 버튼 크기와 슬라이더 사이 간격은 유지한다. 모바일 도움말은 슬라이더 스크롤 영역 아래 패널 맨 하단에 표시한다.
- 단위 검사 수집에서도 `.private/`를 제외하여 로컬 배포 확인용 Playwright 파일이 Vitest에 섞이지 않게 한다.

## Beta 브랜치와 빌드

- `beta`는 실험 기능 작업 브랜치다. `npm run dev:beta`, `npm run build:beta`, `npm run preview:beta`는 `/AGPilot0007/beta/`를 사용한다. 베타 산출물은 Git 제외 `dist-beta/`에 저장한다. CI의 `GITHUB_REF_NAME=beta`도 베타 경로를 선택한다.
- 베타 PWA는 별도 이름·scope·start_url·캐시 ID를 사용한다. 운영 서비스 워커 설정에는 beta 경로의 navigation fallback 제외 규칙을 둔다. 운영에 해당 설정을 반영하기 전에는 기존 서비스 워커가 beta 탐색을 가로챌 수 있다.
- `.github/workflows/beta.yml`은 beta push 시 LUT 생성·단위 검사·베타 빌드·일반 artifact 업로드만 한다. Pages 배포 권한과 배포 단계는 없다. 기존 배포 워크플로는 main에서만 실행한다.
- 공개 beta 게시에는 운영 루트와 beta 하위 폴더를 함께 포함하는 Pages 산출물이 필요하다. beta만 단독으로 Pages 배포하지 않는다. main 병합·운영 배포는 최종 승인 후 진행한다. 빌드 경로 설정과 공개 URL 배포 완료를 구분해 보고한다.
- 같은 origin의 IndexedDB는 경로로 격리되지 않는다. beta 레시피는 별도 `hd2lab_film_studio_beta_recipes_v1` 키를 사용하여 운영 레시피와 분리한다.

## RETRO 90 / Date Imprint (beta)

- 기존 개별 Film 목록은 9종을 유지한다. MARGARINE 뒤 Filter Set 카드는 즉시 모달을 열고 `01 Old School Film` 선택 시 FS-010 RETRO 90의 전체 보정값과 기본 광학 효과를 적용한다. `src/films/retro90.ts`와 `public/luts/FS-010_RETRO90.cube`가 신규 프로필이다.
- `Camera Effects`는 데스크톱·모바일 조정 패널에서 펼친다. 날짜는 기본 OFF, 날짜 입력·Today·EXIF 선택 후 ON으로 켠다. EXIF는 파일의 DateTimeOriginal만 로컬 파싱하며 임의의 날짜로 대체하지 않는다. 기록된 달력 날짜를 보존한다. 사진 교체 시 EXIF 소스 날짜는 새 사진에 맞추고 날짜가 없으면 OFF로 전환한다.
- 필름 변경은 날짜를 유지하고 광학 효과를 0으로 되돌린다. 보정 Reset은 날짜를 유지한다. Camera Effects Reset은 날짜와 광학 효과를 초기화한다. Undo/Redo는 색·필름·날짜·광학 효과를 함께 복원하며, 새 사진은 현재 설정으로 이력을 새로 시작한다.
- 날짜는 자체 7세그먼트 Canvas 벡터를 작은 투명 텍스처로 생성해 공통 WebGL 렌더러에서 필름 처리 후 합성한다. 사진 좌표·짧은 변 비율로 크기·여백·발광을 계산하고 프리뷰/내보내기에 동일하게 적용한다. 원본 보기에는 숨기고 Split은 보정 영역에만 합성한다. 설정·출력 크기가 같으면 텍스처를 재사용한다.
- Glow/Halation/Softness는 0이면 우회한다. Standard는 주변 4샘플, High는 8샘플을 사용하며 추가 전체 해상도 버퍼/다중 패스를 할당하지 않는다. 고해상도 및 실기기 성능을 브라우저 에뮬레이션 수치로 보장하지 않는다.
- 신규 레시피 스키마는 2이며 camera 설정을 저장한다. 스키마 1을 읽을 때 날짜 OFF·추가 효과 0을 채운다. 미래 버전과 잘못된 활성 날짜는 가져오기 오류로 처리한다. 기존 마가린 메타데이터는 유지한다.
- FS-010만 생성: `npm run generate-luts -- --only FS-010`. 기존 LUT 변경은 승인 없이 허용하지 않으며 생성 전후 해시를 비교한다.
- 필수 검증: `npm test`, `npx playwright test`, `npm run build:beta`, 운영 base 빌드. 신규 `tests/e2e/retro90.spec.ts`는 로컬 EXIF fixture, 날짜 UI/레시피/실제 PNG 출력, JPEG/PNG 렌더 일치·원본/Split·Context Loss 복구를 확인한다. 색/성능 비교와 증거는 `.private/`에만 둔다.
