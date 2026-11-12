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
- `.github/workflows/beta.yml`은 beta push 시 LUT 생성·단위 검사·베타 빌드 후 마지막 성공 main 배포 산출물과 합쳐 Pages에 게시한다. 운영 소스 브랜치를 병합하지 않는다. `tools/deployment/fetch-production.mjs`는 main 배포 artifact 또는 같은 main SHA의 90일 보관 snapshot만 사용하며 없으면 배포를 중단한다.
- `tools/deployment/assemble-pages.mjs`는 운영 루트와 beta 하위 폴더를 `.pages-site/`에 합친다. 운영 파일은 sw.js를 제외하고 바이트 일치를 검사한다. 운영 SW에는 beta navigation fallback 제외와 기존 캐시 방문자를 beta로 재탐색하는 activate handler를 추가하고, beta 캐시까지 매칭하는 구형 Workbox 전역 캐시 정리는 우회한다. 운영 precache의 revision 정리는 유지된다. beta를 단독 배포하지 않는다. 두 워크플로는 pages concurrency로 직렬화한다. main용 워크플로도 최신 성공 beta artifact를 포함하도록 준비되어 있으며 main 반영은 사용자 승인 후 수행한다.
- 같은 origin의 IndexedDB는 경로로 격리되지 않는다. beta 레시피는 별도 `hd2lab_film_studio_beta_recipes_v1` 키를 사용하여 운영 레시피와 분리한다.

## RETRO 90 / Date Imprint (beta)

- 기존 개별 Film 목록은 9종을 유지한다. MARGARINE 뒤 Filter Set 카드는 즉시 모달을 열고 `01 Old School Film` 선택 시 FS-010 RETRO 90의 전체 보정값과 기본 광학 효과를 적용한다. `src/films/retro90.ts`와 `public/luts/FS-010_RETRO90.cube`가 신규 프로필이다.
- 카메라 버튼은 공용으로 배치한다. 모든 필터에서 날짜 인화와 Filter Set 스타일 선택을 제공한다. `FilmProfile.cameraEffects`는 추가 광학 효과의 지원 범위를 선언하며 현재 RETRO 90만 Glow/Halation/Softness를 지원한다. 날짜는 기본 OFF, 날짜 입력·Today·EXIF 선택 후 ON으로 켠다. EXIF는 파일의 DateTimeOriginal만 로컬 파싱하며 임의의 날짜로 대체하지 않는다. 기록된 달력 날짜를 보존한다. 사진 교체 시 EXIF 소스 날짜는 새 사진에 맞추고 날짜가 없으면 OFF로 전환한다.
- 필름 변경은 날짜·광학 효과 설정값을 보존한다. 날짜는 모든 필터에 적용하며 광학 효과는 지원 필터에서만 적용한다. 필터 전환·Undo/Redo·레시피 적용 시 전용 설정창을 닫고, RETRO 90으로 돌아오면 보존한 설정을 사용한다. 보정 Reset은 날짜를 유지한다. Camera Effects Reset은 날짜와 광학 효과를 초기화한다. Undo/Redo는 색·필름·날짜·광학 효과를 함께 복원하며, 새 사진은 현재 설정으로 이력을 새로 시작한다.
- 날짜는 자체 7세그먼트 Canvas 벡터를 작은 투명 텍스처로 생성해 공통 WebGL 렌더러에서 필름 처리 후 합성한다. 사진 좌표·짧은 변 비율로 크기·여백·발광을 계산하고 프리뷰/내보내기에 동일하게 적용한다. 원본 보기에는 숨기고 Split은 보정 영역에만 합성한다. 설정·출력 크기가 같으면 텍스처를 재사용한다.
- Glow/Halation/Softness는 0이면 우회한다. Standard는 주변 4샘플, High는 8샘플을 사용하며 추가 전체 해상도 버퍼/다중 패스를 할당하지 않는다. 고해상도 및 실기기 성능을 브라우저 에뮬레이션 수치로 보장하지 않는다.
- 현재 레시피 스키마는 7이며 camera와 curves 설정을 저장한다. 스키마 1·2·3·4·5·6도 읽으며 누락된 camera는 날짜 OFF·추가 효과 0, curves는 대각선을 채운다. 미래 버전과 잘못된 활성 날짜는 가져오기 오류로 처리한다. 기존 마가린 메타데이터는 유지한다.
- FS-010만 생성: `npm run generate-luts -- --only FS-010`. 기존 LUT 변경은 승인 없이 허용하지 않으며 생성 전후 해시를 비교한다.
- 필수 검증: `npm test`, `npx playwright test`, `npm run build:beta`, 운영 base 빌드. 신규 `tests/e2e/retro90.spec.ts`는 로컬 EXIF fixture, 날짜 UI/레시피/실제 PNG 출력, JPEG/PNG 렌더 일치·원본/Split·Context Loss 복구를 확인한다. 색/성능 비교와 증거는 `.private/`에만 둔다.

- 공개 beta 배포는 승인된 동작이다. GitHub Pages 환경의 main/beta 브랜치 허용 정책을 유지하며, 운영 기능 변경의 main 병합 승인은 별개다. 게시 후 새 방문자와 기존 운영 SW 캐시 방문자, 두 경로의 사진 편집·내보내기·오프라인 동작을 각각 확인한다.

- main에는 통합 배포 워크플로가 병합되어 운영 배포 시 최신 성공 beta 산출물을 보존한다. beta 배포는 승인된 운영 snapshot과 최신 beta를 함께 게시한다.

- 카메라 효과 허용 조건은 `src/films/cameraEffects.ts`에서 공유한다. 미리보기와 내보내기 모두 실제 필터 ID를 공통 WebGL 렌더러에 전달한다. 렌더러/내보내기 API에서 필터 ID가 없으면 날짜·광학 효과를 모두 OFF로 취급한다. 알려진 필터에서는 날짜를 공통 지원하며 광학 효과는 프로필 지원 범위로 제한한다. 저장된 레시피의 camera 값이 활성화되어 있어도 이 제한을 우회하지 못한다.


## 사용자 톤 커브와 히스토그램 (beta)

- 조정 타이틀 옆 아이콘 순서는 Tone Curve → Camera Effects다. 모바일은 접힌 조정 바에서도 접근하며 커브를 열면 조정 시트를 내린다. 태블릿의 떠 있는 조정 패널도 커브를 열 때 닫아 그래프를 가리지 않는다.
- 커브 그래프는 사진 workspace 내부의 오버레이다. 열기/닫기로 사진 크기와 zoom/pan이 바뀌면 안 된다. 커브 그래프는 사진 workspace 중앙에 배경·블러 없이 투명하게 표시한다. W/R/G/B 도구줄은 데스크톱 필터 목록과 모바일 필터 캐러셀 위치에 absolute 오버레이로 표시한다. W는 전체 RGB이며 개별 채널과 독립적으로 저장된다.
- 점 추가·포인터 드래그·입출력 0~255·선택점 삭제·키보드 방향키(Shift 10단위)를 지원한다. 양 끝점도 x/y를 조절할 수 있으며 모든 점은 교차하지 않으며 채널당 최대 16점이다. Reset 아이콘은 선택 채널만, 전체 커브 초기화는 4채널을 초기화한다. Reset All도 커브를 초기화한다. 한 드래그는 Undo 한 단계다.
- 기본 대각선은 shader에서 우회해 기존 색 처리 결과를 보존한다. 기존 MIT 고지된 보간 함수를 사용해 1024×1 RGBA32F 텍스처(16KiB)를 생성하며 float 선형 필터 확장 없이 texelFetch 보간을 사용한다. 커브는 필름 LUT 혼합 후, Saturation/공간 효과/날짜 합성 전에 적용한다. Preview와 Export는 동일 curves 값을 전달한다.
- Whites/Blacks는 -100~100 기본 0이며 LUT 전 sRGB 끝부분에 부드러운 보정을 적용한다. Adobe 수치 대응이나 RAW 손실 정보 복원을 주장하지 않는다.
- 좌상단 W/R/G/B 히스토그램은 톤 커브가 활성화된 동안만 표시·샘플링한다. 현재 프리뷰 canvas를 최대 192×192로 샘플링해 64 bins로 집계한다. 최대 약 8Hz로 갱신하며 원본/Split 모드에서는 해당 프리뷰 분포다. UI와 히스토그램은 출력 사진에 포함하지 않는다.
- 신규 검사: `tests/userCurves.test.ts`, `tests/e2e/user-curves.spec.ts`. 기본값 출력, 채널 독립성, reset/undo, v1/v2 레시피 마이그레이션, PNG 일치/JPEG/원본/Split/Context Loss, 모바일 터치와 사진 지오메트리를 검증한다. 증거·평가 보고는 `.private/`에만 보관한다.
- `vite.config.ts`는 `THIRD_PARTY_NOTICES.md`를 배포 산출물 `THIRD_PARTY_NOTICES.txt`에 포함하며 PWA에도 캐시한다. 커브 수학과 자체 UI만 사용하며 Adobe 구현/프로필을 복제하지 않는다.

- Camera Effects 설정은 조정 슬라이더 패널 안에 렌더링하지 않는다. 사진 workspace 안의 별도 스크롤 오버레이로 표시하고 닫기·Escape를 지원한다. 모바일 조정 시트와 태블릿 조정 패널은 카메라 아이콘 실행 시에도 닫아 오버레이를 가리지 않는다. 톤 커브와 카메라 오버레이는 상호 배타적이며 어느 쪽도 사진 지오메트리를 변경하지 않는다.

- 톤 커브 끝점은 0~255 입력/출력을 드래그·숫자·키보드로 조절한다. 인접 점과 최소 1/1024 입력 간격을 유지한다. 끝점 바깥 구간은 해당 끝점 출력으로 고정하며 그래프/텍스처에 모두 표시한다. 입력 양 끝이 0/255이고 모든 점이 대각선 위인 경우만 중립 커브로 우회한다. 초기화는 [0,0]→[255,255]를 복원한다. 신규 레시피는 스키마 7로 저장하고 1~6도 읽는다.


## Color Lab (beta)

- 공용 아이콘 순서는 Color Lab → Tone Curve → Camera Effects다. 세 오버레이는 상호 배타적이며 활성화 시 모바일/태블릿 조정 패널을 닫는다. 색상 칩은 필터 영역 위, 설정은 사진 위 스크롤 패널로 표시한다. 사진 크기·zoom/pan은 유지한다.
- 기존 전체 채도는 Global Saturation으로 표시한다. 신규 믹서는8색(Red/Orange/Yellow/Green/Aqua/Blue/Purple/Magenta)의 H/S/L을 색상별·항목별·전체 보기에서 같은 데이터로 조절한다. 숫자 버튼은 해당 값 초기화, 정밀 입력은 접이식 숫자 필드다. 믹서 전체 초기화는 전체 채도를 바꾸지 않으며 Reset All은 믹서도 초기화한다.
- Color Focus는 사진의 믹서 적용 전 색을 최대8개 저장한다. H/S/L Shift, 각 성분 Range, 공통 Feather, 활성/삭제/초기화, Visualize Range를 지원한다. 회색·투명/사진 밖 영역은 선택하지 않고 안내한다. 같은 색은 사진 전체에서 바뀌며 공간 마스크 기능이 아니다.
- 처리 순서는 기존 기본보정/LUT/커브 → Spectrum/Color Focus → Global Saturation → 광학/질감 → 날짜다. 0값·비활성 믹서는 완전 우회한다. 색상 범위는 변환 전 기준색으로 고정하고 순환 Hue/부드러운 경계/저채도 보호를 사용한다. Luminance는 bounded HSL 밝기 이동이며 Adobe 수치와의 동일성을 주장하지 않는다.
- 스포이트·직접 조정 시작 때만 reference 렌더를 수행하여3×3 RGBA 픽셀을 읽고 즉시 일반 프레임을 복구한다. reference는 커브 후/믹서 전이며 전체 채도·광학/그레인·날짜·마스크·UI를 제외한다. canvas의 실제 화면 사각형을 사용해 zoom/pan 좌표를 역변환한다. 드래그 중 기준색/가중치는 고정하고 재샘플링하지 않는다.
- 직접 조정은 선택 H/S/L 축을 위로+ 아래로− 조절하며 이웃 색상에 가중 적용한다. 한 드래그는 Undo 한 단계다. 방향키/Shift 방향키도 지원한다. Escape는 도구 종료 후 패널 종료 순서이며 중간 종료도 현재 보정을 한 단계로 기록한다.
- Visualize Range와 선택 탭/색/도구는 UI 상태이며 레시피·내보내기에 포함하지 않는다. export는 colorMixer 데이터만 공통 렌더러에 전달한다. 스키마7에 Color Lab 값을 저장하며1~6의 누락값만 중립값으로 채우고 기존 믹서 설정은 보존한다. 샘플8개 상한·범위·유한수·고유 ID를 검사한다.
- 사진 제스처의 touch-action:none은 이미지/사진 배경/직접 조정 표면에만 둔다. 오버레이 패널 조상에는 두지 않아 모바일 세로 스크롤이 가능하도록 한다.
- 관련 검사: `npm test`, `npx playwright test tests/e2e/color-mixer.spec.ts`, 전체 E2E, beta/운영 base 빌드. CPU/GPU 색상 대응, 빨강 경계·중립값·범위 마스크, 확대 후 샘플링, 마스크 제외 PNG, JPEG/PNG·Original/Split·Context Loss, 레시피/Undo·반응형·성능을 확인한다. 기밀 평가·증거는 `.private/`에만 보관한다.

## Color Lab / RGB Base (beta)

- 화면 명칭은 Color Lab, 탭은 Spectrum / Color Focus / RGB Base다. 내부 colorMixer 키와 기존 ID는 유지한다.
- RGB Base는 colorMixer.rgbBase에 enabled, shadowsTint 및 RGB 각각 hue/saturation을 저장한다. 모든 조절값은 -100~100, 기본 0이다. Color Lab 전체 OFF는 세 기능을 모두 우회하며 RGB Base 전용 OFF/초기화는 Spectrum과 Color Focus를 유지한다. Reset entire Color Lab과 Reset All은 세 기능을 초기화한다.
- RGB Base는 노출·화이트밸런스 후, 기존 톤/LUT 처리 전에 선형 RGB 기본벡터 회전·채도 행렬을 적용한다. 중립 회색 응답과 휘도를 보존하며 음수 채널은 휘도를 중심으로 색역 압축한다. 암부 Tint는 선형 휘도 마스크로 초록↔마젠타를 조정하며 검정과 밝은 영역은 유지한다. 모든 값 0 또는 OFF면 shader 완전 우회다. 기존 LUT는 변경하지 않는다.
- RAW 카메라 프로필, Adobe 프로세스 버전 또는 Lightroom 수치 재현으로 표기하지 않는다. 프로세스 버전 선택기도 제공하지 않는다. 신규 레시피 스키마7은 RGB Base를 보존하며 구버전1~6의 누락값은 중립값으로 채운다.
- 공통 렌더러/내보내기, History, Reset, Color Focus의 reference sampling에 같은 RGB Base 설정을 사용한다. UI/샘플 마스크는 출력되지 않는다. 사진 크기·zoom/pan을 유지하는 기존 오버레이에 7개 슬라이더를 표시하고 숫자 클릭 단일값 초기화, 기본색별/전체 초기화를 제공한다.
- 검증: tests/rgbBase.test.ts와 tests/e2e/color-mixer.spec.ts에서 중립·비활성, RGB/암부/회색 극단값, CPU/GPU 대응, PNG/JPEG, Original/Split, Context Loss, 구레시피/저장/Undo·모바일 레이아웃을 확인한다. 실제 실행 결과·평가 이미지·성능 기록은 .private/에만 보관한다.

## PC Workspace와 상세 샤프니스 (beta)

- PC(1280px 이상) Open은 Photo / Workspace 모달을 연다. Photo는 한 장만 읽고 폴더 탐색을 연결하지 않는다. Workspace는 읽기 전용 showDirectoryPicker를 우선 사용하고 미지원 환경은 webkitdirectory 입력으로 대체한다. 현재 폴더 사진 형식은 JPEG/PNG/WebP이며 RAW 디코딩은 별도 미구현이다. 하위 폴더는 선택 옵션이며 기본 OFF다.
- 폴더는 이름순 메타데이터 목록으로 점진 탐색한다. 아래 Explorer는 가로 가상 스크롤로 화면 주변만 렌더링하고, 썸네일은 Worker 최대2개·192×128 이내·64개/8MiB LRU로 제한한다. 이전 폴더의 캐시/큐를 해제하고 선택 변경 시 기존 원본 디코딩을 취소한다. 파일/폴더는 업로드하거나 수정하지 않는다.
- 아래 Explorer는 헤더의 다른 버튼/정렬을 제외한 영역과 화살표로 접고 펼치며, 접으면 얇은 바만 남는다. 높이(120~300px)·스크롤·선택 상태를 보존하고 상단 편집 공간을 확장한다. 사진별 세션은 보정값·zoom/pan·Undo/Redo를 보존하되 최근50개 사진의 전체 이력만 유지하고 이전 사진은 최종 보정값을 유지한 단일 이력으로 압축한다. 이미지 버퍼를 세션에 보관하지 않는다.
- PC Film Profiles 위 Explorer는 현재 편집 결과를192×100 이내로 축소해 표시한다. 렌더 완료 이벤트로 최대 약3Hz 갱신하며 원본 해상도 readPixels를 추가하지 않는다. 제목/파일명/크기/폴더 순번을 표시한다.
- PC 톤 커브 WRGB/선택채널 초기화는 그래프 우상단으로 이동한다. 그래프는 투명하고 모든 설명/입출력/닫기/삭제/전체초기화 UI는 불투명한 배경을 사용한다. 태블릿·모바일 WRGB는 기존 필터 영역을 유지한다. Color Lab 팔레트는 모든 화면에서 패널 상단 탭 아래로 이동하고 제목·탭·팔레트는 스크롤 중 고정한다.
- 기존 Sharpness 자리는 접이식 Sharpening 그룹이다. Amount0~150(기본0), Radius0.5~3.0px(1.0), Detail0~100(25), Masking0~100(0). 숫자 클릭 해당값 초기화, 그룹/전체 Reset, 한 드래그 한 Undo를 지원한다. 원본 픽셀 기준 반경을 프리뷰/출력 크기에 환산한다.
- 새 선명도는 보정된 색의 휘도에서 두 크기의 주변 샘플로 계산하고 평탄 영역 마스크·halo 제한을 적용한다. 색/LUT/커브/Color Lab 후, 광학·그레인·날짜 전에 적용한다. 활성일 때만 중간 FBO 1개를 사용하며 float 렌더 지원 시 RGBA16F, 아니면 RGBA8이다. Amount0은 기존 단일 패스를 완전 우회한다. 드래그 중4방향·화면 크기 기준 긴 변384~768px 축소 프리뷰, 손을 떼면 기존 프리뷰 해상도·8방향으로 복원하며 export는 최종 품질이다.
- 마스크 보기와 100% 원본 픽셀 상세 창은 미리보기 전용이다. 모바일 조정 시트를 닫아도 마스크는 유지하며 사진 위 종료 버튼으로 끈다. 100% 창은 현재 화면 중심의 원본 영역을 최대384×260으로 잘라 표시하고, 닫으면 이전 zoom/pan을 복원한다. 상세 창에는 그레인·날짜를 넣지 않는다. 출력에는 마스크/상세 UI가 포함되지 않는다.
- 레시피 스키마7은 sharpening을 저장하고1~6을 읽는다. 이전 nonzero sharpness는 legacy 처리로 보존하며 새 조절값을 편집하면 advanced로 바꾼다. 기존 LUT를 변경하지 않는다. original 비교는 보정 baseline이 아닌 실제 입력 픽셀로 검증한다. RGBA16F 중간 버퍼 양자화로 활성 상태의 평탄 영역은 GPU별 최대1byte 차이를 허용하며 Amount0은 정확 일치해야 한다.
- 검증: tests/sharpening-workspace.test.ts, tests/workspaceSession.test.ts, tests/decoderAbort.test.ts, tests/e2e/workspace-detail.spec.ts 및 전체 회귀. 1만 항목 API 대체 테스트는 실제1만 원본 파일의 디코딩 성능 인증이 아니다. 실제 OS 폴더 권한창/실기기 모바일은 별도 수동 확인 범위다. Playwright trace/스크린샷 기본 출력은 .private/e2e-artifacts이며 기밀 평가 자료는 Git/빌드에 포함하지 않는다.

## 공용 Open / 사이드바 / 테마

- PC(1280px 이상)의 홈 Select Photo와 상단 Open은 uiStore의 동일한 Photo / Workspace 모달을 연다. 작은 화면은 기존 단일 사진 선택 동작을 유지한다. 사진/폴더 연결과 보정 상태는 editor/workspace store가 소유하며 uiStore는 화면 상태만 관리한다.
- PC 하단 Workspace Explorer에는 연결을 버리는 X를 두지 않는다. 접어도 폴더명·사진 수·복구 화살표가 남고 높이/스크롤/선택을 유지한다. Photo로 새 사진을 열거나 Workspace로 폴더를 교체하는 흐름은 유지한다.
- PC 좌우 사이드바는 독립적으로 접으며 얇은 복구 레일을 항상 남긴다. 패널 DOM을 유지해 스크롤·열린 그룹·선택·보정을 보존하고 홈 왕복에도 접힘 상태를 유지한다. 오른쪽 레일에서 Color Lab/Tone Curve/Camera Effects를 직접 열 수 있다. Open 모달의 backdrop은 사이드바 접기 버튼보다 위에 배치하여 배경 클릭을 차단한다. 작은 화면에서는 PC 접힘 상태와 무관하게 기존 태블릿/모바일 배치를 사용한다.
- Light/Dark 테마는 PC·태블릿 상단 Sun/Moon 버튼, 작은 화면 More 메뉴에서 전환한다. 기본은 Dark이며 hd2lab_film_studio_theme 키로 선택을 기억한다. 같은 origin의 운영/베타는 테마 선호를 공유하고 레시피 DB는 기존처럼 분리한다. 저장소 사용이 불가능하면 현재 세션에서 동작한다.
- UI 표면/글자/테두리는 CSS 변수로 테마를 바꾸며 사진·RGB 색상 칩·셰이더·LUT·출력에는 filter나 색상 변환을 적용하지 않는다. 히스토그램은 W/R/G/B 대비를 위해 중립 암부 배경을 유지한다. 초기 HTML과 앱 진입점에서 저장 테마를 적용해 재진입 시 깜박임을 줄인다. 테마는 레시피/Undo 이력에 포함하지 않는다.
- 관련 검사: tests/uiStore.test.ts, tests/e2e/theme-sidebars.spec.ts와 전체 회귀. PC 홈/편집 Open 일치, 레일 복구·스크롤 보존, 하단 X 부재·복구, 라이트 홈/조정/Color Lab/커브, 사진 픽셀 불변·재로드 테마 보존, 모바일 넘침을 확인한다. 베타·main 배포와 각 공개 URL 및 이전 캐시 업데이트를 별개로 확인한다. 이번 사용자 지시는 beta 검증 후 main 병합·운영 배포까지 승인한 범위다.
