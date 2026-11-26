# Phase 1 Optical PoC — Q02 / CP1

- 담당: Q02 Optical Engineer
- 작업 브랜치: `feature/phase1-q02-optical`
- 기준 Commit: `b850f82e0eb3fc33c76619f5dee9eec3e8a4890a` (`origin/main`)
- 상태: CP1 (기존 코드 분석 + 독립 PoC) 완료. **`src/` 미변경**, Q01 Engine Contract 확정 후 본 구현 착수.
- 범위: WO-08~WO-21 (Geometry & Local Adjustment), WO-37~WO-40 (Optical Effects)

## 1. 목적과 비목표

Phase 1의 기하 보정과 로컬 조정(마스크), 광학 효과가 기존 WebGL2 엔진 위에서 구현 가능한지
수식·좌표계·GPU 비용 관점에서 먼저 검증한다. 본 문서와 PoC 코드는 통합 브랜치에 병합되지 않으며,
Q01이 공통 렌더 패스를 확정하기 전까지 `src/`를 수정하지 않는다.

비목표(명시):

- AI 깊이 추정, AI 마스킹, 생성형 보정은 구현하지 않는다.
- 단순 Gaussian Blur를 심도(DoF) 시뮬레이션으로 표시하지 않는다. 본 PoC의 블러는 **가상 조리개 PSF**이며
  실제 렌즈 계측값이 아니다.
- 원본 이미지 비파괴: 모든 처리는 샘플링/표시 단계에서만 수행하고 원본 버퍼를 변형하지 않는다.
- 서버·네트워크·업로드 기능 없음. PoC는 로컬 정적 페이지에서만 동작한다.

## 2. 검증 대상 결과 (10항목)

| # | 항목 | 구현 위치 | 검증 | 결과 |
|---|------|-----------|------|------|
| 1 | 4점 호모그래피 원근 변환 | `poc/optical/math/homography.ts` | 단위 테스트 (항등/역변환/키스톤/회전) | 통과 |
| 2 | 수직/수평 원근 보정 | `perspectiveCorrectionQuad/Homography` | 단위 + GPU 마커 정합 | 통과 |
| 3 | 라인 검출 기반 자동 기울기 | `poc/optical/math/skew.ts` (Sobel+Hough) | +3°, −2°, 0° 복원 오차 < 0.3° | 통과 |
| 4 | 방사/접선 렌즈 왜곡 | `poc/optical/math/distortion.ts` | 왕복 오차 < 1e-7, GPU 방향 일치 | 통과 |
| 5 | Brush/Linear/Radial 마스크 | `poc/optical/math/masks.ts`, GPU `evaluateMask` | 단위 + GPU radial/선형/브러시 | 통과 |
| 6 | Luminance/Color range 마스크 | 동일 | 단위 + GPU (장면 4분면) | 통과 |
| 7 | 마스크 합성/페더링 | `composeMaskStack` (add/subtract/intersect) | 단위 | 통과 (GPU는 단일 마스크) |
| 8 | 수동 초점 영역 렌즈 블러 | `focus.ts`, GPU `BOKEH_SOURCE` | CoC 단조성, 평면/에너지 보존 | 통과 |
| 9 | PSF/조리개 형태 보케 | `apertureTapWeights` + 64×1 RGBA32F PSF 텍스처 | 가중치 합 1, 육각 footprint | 통과 |
| 10 | 기하 변환 후 마스크 좌표 정합 | `coordinates.ts`, GPU 패스 | 마커/마스크 정합, 512↔1024 패리티 | 통과 |

## 3. 좌표계 및 데이터 계약

### 3.1 좌표 공간

- **Pixel space**: 원점 좌상단, x 오른쪽, y 아래.
- **NIS (normalized image space)**: `u = x / width`, `v = y / height`, [0,1], **y-down**.
  미리보기(장변 ≤ 2048)와 Export(원본 해상도)가 같은 NIS를 공유하므로 연산 정합성이 유지된다.
- **Centered space**: `x = (u − 0.5)·2`, 코너 ±1, 코너 반경 √2. 렌즈 왜곡 계수는 이 공간 기준.
- **Short-side units**: x에 `aspect = width/height`(≥1이면 x만, <1이면 y만) 스케일.
  마스크 반경·페더 폭은 이 단위로 저장해 해상도/비율 독립적으로 만든다.
- **마스크는 보정 후(corrected) NIS에 저장**한다. 표시/내보내기는 `correctedToSource`로 원본을 샘플링하고,
  UI에서 원본 좌표(예: 자동 마스크 제안 없이 사용자가 찍은 점)를 다시 마스크로 옮길 때만
  `sourceToCorrected`를 사용한다. 이 규약이 미리보기/내보내기 패리티의 전제다.

### 3.2 GPU 패스 방향 규약 (CP1에서 발견한 함정)

WebGL FBO 텍스처는 texel 0행이 프레임버퍼 하단이다. 클립 y=+1(화면 상단)에서 `v_uv=0`을 쓰는
버텍스 규약과 결합하면 패스마다 y가 뒤집힌다. CP1 GPU PoC에서 **마스크만 상하 반전되어**
마커와 어긋나는 결함이 재현되었고, 다음 규약으로 통일해 수정했다.

- 모든 셰이더의 이미지 좌표는 NIS y-down.
- FBO 텍스처를 읽을 때는 항상 `texture(tex, vec2(uv.x, 1.0 − uv.y))`.
- `readPixels`는 하단 기준이므로 리드백에서 한 번 더 y를 뒤집는다.

Q01 렌더 패스도 이 규약을 명시해야 하며, CPU↔GPU 방향 불일치는 마스크 정합 테스트로 잡아야 한다.

### 3.3 마스크 데이터 요구사항

```ts
type MaskBase = {
  id: string; enabled: boolean; opacity?: number; invert?: boolean;
  blend?: 'add' | 'subtract' | 'intersect'; // 기본 add
};
type LocalMask =
  | MaskBase & { kind: 'radial'; center: Vec2; radiusX: number; radiusY: number; rotation: number; feather: number }
  | MaskBase & { kind: 'linear'; start: Vec2; end: Vec2; feather: number }
  | MaskBase & { kind: 'brush'; strokes: { points: Vec2[]; radius: number; hardness: number; flow: number }[] }
  | MaskBase & { kind: 'luminance'; lo: number; hi: number; feather: number }
  | MaskBase & { kind: 'color'; color: [number, number, number]; hueRange: number; satRange: number; lumRange: number; feather: number };
```

- 좌표는 corrected NIS, 반경/페더는 short-side 단위.
- 색/휘도 마스크는 기하 보정 후 색(로컬 노출 적용 전)을 샘플한다.
- 마스크 스택은 add → `min(1, a+w)`, subtract → `max(0, a−w)`, intersect → `a·w`.
- GPU PoC는 단일 마스크만 지원한다. 본 구현에서는 N개 마스크 스택을 셰이더 유니폼 배열/텍스처로
  확장해야 하며, 이는 Q01 요구사항에 포함했다.
- 알려진 PoC 한계: GPU 마스크/CoC 거리 계산은 정사각 캔버스라 UV 단위를 그대로 쓴다.
  비정사각 이미지에서 CPU와 같아지려면 short-side 변환(aspect 유니폼)이 필요하다. **본 구현 필수 항목.**

## 4. 수학 모델

### 4.1 호모그래피 (4점 DLT)

대응점 `(x,y) → (X,Y)` 4쌍에 대해 `h33 = 1`로 고정하고 8×8 선형계를 푼다(부분 피벗 가우스 소거).

```text
[x y 1 0 0 0 −xX −yX] h = X
[0 0 0 x y 1 −xY −yY] h = Y
```

PoC는 이 계수 순서를 단위 테스트로 고정했다(초기 부호 오류를 테스트로 발견·수정).

원근 보정은 "원본에서 잘라낼 사각형"을 unit square로 늘리는 **샘플링 행렬**로 구현한다.

```text
quad = [(v,0), (1−v,h), (1,1−h), (0,1)]
v = clamp(vertical, −1, 1) · strength
h = clamp(horizontal, −1, 1) · strength
H_sample = unitSquareToQuad(quad)          // corrected → source
H_inverse = invertMat3(H_sample)           // source → corrected (UI/마스크 재정합)
```

- `strength` 기본 0.15(=프레임의 15%). `vertical > 0`은 상단이 좁은 키스톤 보정.
- 회전은 y-down 기준 프레임 중앙 회전 `R(angle)`을 샘플링 행렬 앞에 곱한다.
- 적용 한계: 4점 입력이 퇴화(공선)하면 `invertMat3`가 예외. UI에서 코너 간 최소 면적 검증 필요.

### 4.2 렌즈 왜곡 (Brown–Conrady)

```text
r² = x² + y²
x_d = x(1 + k1 r² + k2 r⁴ + k3 r⁶) + 2 p1 x y + p2 (r² + 2x²)
y_d = y(1 + k1 r² + k2 r⁴ + k3 r⁶) + p1 (r² + 2y²) + 2 p2 x y
```

- 계수는 centered space, 화면 밖에서도 다항식이 단조라고 가정하지 않는다.
- GPU 샘플링은 **정방향(corrected→source)** 만 필요하므로 뉴턴 반복이 없다.
- 역방향(source→corrected, UI 마커/마스크 재정합)은 2D 뉴턴법. 해석적 야코비안 사용, 최대 16회, 허용오차 1e-9.
  단위 테스트 왕복 오차 < 1e-7.
- 적용 한계: |r|이 큰 영역에서 고차항이 접힐 수 있어 UI에서 계수 범위와 r 클램프 정책이 필요.

### 4.3 자동 기울기 (Sobel + Hough)

1. Rec.709 luma → 3×3 Sobel.
2. 상위 `edgePercentile=0.9` 임계값, 에지 픽셀 최대 12,000개로 서브샘플.
3. 선 법선 각도 0~180°를 0.25° 간격 Hough, 가중치 `min(4, mag/threshold)`, rho 1px 빈.
4. 최대 피크를 포물선 보간으로 세분화 → 가장 가까운 0°/90° 축과의 차이를 반환.
5. `confidence = clamp(peak / min(width,height), 0, 1)`.

검증: 256² 합성 그리드에서 +3°, −2°, 0° 모두 오차 < 0.3°. 콘텐츠에 직선 에지가 없으면 confidence가 낮아지며,
자동 적용 기준(예: 0.1 이상)은 UI 정책으로 결정해야 한다. AI 검출 아님.

### 4.4 마스크

- Radial: `w = 1 − smoothstep(1−f, 1, |R(−θ)(p−c)/r|)`
- Linear: 투영 `t`에 대해 `smoothstep(0.5−f/2, 0.5+f/2, t)`
- Brush: 폴리라인 최단거리 `d`, `w = (1 − smoothstep(r(1−h), r, d)) · flow`, 스트로크 합성은 `a + w − a·w`
- Luminance: `l`이 `[lo,hi]` 밖이면 경계에서 0으로 페더, 안이면 1
- Color: HSL의 hue/sat/lum 밴드를 곱. 무채색 대상/샘플은 hue를 무시.
- Feather는 `[0,1]`로 클램프. 컴포지션은 3.3의 add/subtract/intersect.

### 4.5 가상 심도와 조리개 PSF

```text
d = |shortSide(uv) − shortSide(center)|
t = clamp((d − focusRadius) / falloff, 0, 1)
coc = maxCoc · t²(3 − 2t)
```

- `maxCoc`는 short-side 단위. `coc < 1e-5`면 원본 픽셀을 그대로 복사(비활성 시 완전 항등).
- PSF 탭: 골든 앵글 나선 `r_i = √((i+0.5)/N)`, `θ_i = i·2.39996…`, 조리개 다각형
  (`blades`, `rotation`, `roundness`) 내부만 채택, 가중치 합 1로 정규화. 결정적이며 시드 없음.
- GPU는 64×1 RGBA32F 텍스처에 오프셋/가중치를 업로드하고, 프래그먼트마다 `taps`회 gather.
- 로컬 노출은 `color · 2^(ev·maskWeight)`.
- 한계: 이 모델은 수동 초점 영역 기반 **가상** 효과다. 장면 깊이맵이 없으므로 실제 초점면/피사계 심도를
  재현한다고 표기해서는 안 된다. 조리개 형태는 아티스트 파라미터이지 특정 렌즈 계측값이 아니다.

## 5. GPU PoC 구조

`poc/optical/gpu/optical-poc.html` + `optical-poc.ts`, 정사각 캔버스(64~2048).

| 패스 | 대상 | 내용 |
|------|------|------|
| 1 | Scene FBO (RGBA8) | 절차적 그리드/컬러/점광원 기준 장면. 크기·장면 키로 캐시 |
| 2 | Graded FBO (RGBA8) | corrected→source 호모그래피+왜곡 sampling, 마스크, 로컬 노출, 마스크 뷰 |
| 3 | 기본 프레임버퍼 | 가상 CoC + PSF gather (view=composite), 그 외는 passthrough |

- 검증 API: `window.__opticalPoc.render(patch)`, `readPixel(u,v)`, `sumRegion(...)`, `info()`.
- 각 패스 종료 시 1×1 `readPixels` + `gl.finish()`로 동기화. `gl.finish()`만으로는 ANGLE 명령 스트림이
  플러시되지 않아 0.1ms대의 허수 측정이 나왔다(CP1 기록).
- `readPixel`은 y-down NIS 기준, 리드백에서 y를 뒤집는다.
- PoC는 3패스·단일 마스크·정사각 캔버스라는 명시적 한계를 가진다. 프로덕션 구조 제안이 아니다.

## 6. 검증 테스트 및 기준 이미지

- 단위: `tests/optical-math.test.ts` — 25 tests. 호모그래피/역행렬, 왜곡 왕복, 기울기 복원, 좌표 정합,
  마스크/페더/컴포지션, PSF 정규화/항등/에너지/점광원 footprint/CoC 단조, CPU 성능 스모크.
- GPU: `tests/e2e/optical-poc.spec.ts` — chromium 7 tests. WebGL2 초기화, 원근 후 마커·마스크 정합,
  왜곡 방향 CPU 일치, 휘도/색 마스크, 육각 보케 에너지, 512↔1024 패리티, 패스 타이밍.
  비-chromium 프로젝트는 `beforeEach`에서 skip(데스크톱 Chromium 기준 검증).
- 기준 이미지: PoC 장면은 코드로 결정적으로 생성되며, 참조 렌더 4종(원근+방사 마스크, 왜곡, 육각 보케,
  휘도 마스크)을 `.private/optical-poc/`에 보관했다. `.private/`는 git 제외 대상이며 커밋하지 않는다.
- 실행 결과(2026-11-27):
  - `npx tsc --noEmit` 통과
  - `npx vitest run` → 17 files / 113 tests 통과 (기존 테스트 삭제·단정 완화 없음)
  - `npx playwright test tests/e2e/optical-poc.spec.ts --project=chromium` → 7/7 통과
  - 패리티: 512 vs 1024 샘플 9점 최대 채널 차이 **1/255**
- CP1에서 테스트로 발견한 결함(모두 수정):
  1. GPU FBO 상하 반전 → 마스크/장면 불일치 (3.2 규약으로 수정)
  2. Luminance 마스크 하한 램프 반전 (`bandWeight`) → CPU·셰이더 동시 수정, 하한/상한 페더 단위 테스트 추가
  3. 보케 에너지 테스트가 서로 다른 영역 크기를 비교(테스트 버그) → 동일 영역으로 수정

## 7. 성능 및 메모리 (측정값)

측정 환경: macOS arm64, Node 24, Playwright Chromium + **ANGLE SwiftShader(소프트웨어 래스터라이저)**.
GPU 수치는 하드웨어 GPU 성능이 아니며, 실제 기기 재측정이 필요하다.

CPU (vitest 스모크, 1회):

| 작업 | 측정 |
|------|------|
| 호모그래피 해 2,000회 | 27.8ms (약 13.9µs/회) |
| 마스크 평가 200,000회 | 41.9ms (약 0.21µs/회) |
| 128×96 RGBA, 64탭 gather | 13.1ms |

GPU (512²/1024², 32탭 blur, 3프레임 평균, 동기화 포함):

| 크기 | geometry | bokeh | total |
|------|----------|-------|-------|
| 512² | 8.4ms | 91.6ms | 약 100ms |
| 1024² | 31.7ms | 246.8ms | 약 279ms |

- 실행 간 변동이 크다(다른 실행에서 512² 총 52.8ms, 1024² 154.9ms). 소프트웨어 래스터라이저 특성.
- bokeh 패스가 지배적이며 탭 수에 비례한다. scene 패스는 캐시되어 0ms로 집계된다.
- 메모리(정사각 size s): Scene FBO + Graded FBO = `2·s²·4B`, 캔버스 `s²·4B`, PSF 64×16B≈1KB.
  512²≈3.1MB, 1024²≈12.6MB, 2048²≈50.3MB. 4096² export는 약 201MB로 모바일 예산 초과 위험.

## 8. Q01 Engine Contract 요구사항 (공통 파일 수정 필요분, 구현은 Q01 소관)

현재 엔진은 단일 `grade()` + 샤프닝 1패스 구조라 아래가 필요하다. 본 브랜치에서는 `src/`를 수정하지 않았다.

1. **패스 그래프**: ping-pong FBO로 최소 3패스(장면/기하·마스크/광학) 지원, 중간 텍스처 노출.
2. **RenderOptions 확장**: geometry(H, distortion), masks[], localAdjustments, focus/aperture/taps.
   미리보기/Export가 동일 유니폼을 쓰고 해상도만 달라야 한다.
3. **방향 규약**: 3.2의 y-flip 규약을 엔진 샘플링 API에 문서화하고 일관 적용.
4. **aspect 유니폼**: 비정사각에서 마스크/CoC short-side 변환 보장(현 PoC 한계 해소).
5. **포맷/클램프**: 로컬 노출 밴딩 방지를 위해 RGBA16F(가능 시) 또는 감마 보정 정책 결정. 현재 PoC는 8bit 클램프.
6. **리소스 수명**: size 변경/Export마다 FBO·텍스처 명시 해제(`destroy()` 경로), 미리보기 캐시 재사용.
7. **Export 정합**: 동일 패스·동일 taps로 원본 해상도 실행, 최대 텍스처 크기 초과 시 타일링 정책 필요.
8. **Registry**: geometry/mask/effect 타입을 Registry에 등록, 기능별 하드코딩 금지.
9. **Recipe 연동**: 마스크/기하/초점 파라미터를 Recipe v1~v7과 분리된 신규 섹션으로 저장, 하위 호환 유지.
10. **UI 좌표 API**: `sourceToCorrected`/`correctedToSource`를 엔진에서 제공해 마스크 오버레이 정합.

## 9. 리스크와 한계

| 리스크 | 영향 | 대응 |
|--------|------|------|
| GPU 성능(특히 bokeh gather) | 모바일 프레임 저하 | 하드웨어 실측 후 taps/해상도 예산 확정, 미리보기·Export 동일 탭 정책 유지 |
| 8bit 중간 버퍼 밴딩 | 로컬 노출/광학 보정 계단 | RGBA16F 지원 여부 확인, 클램프 범위 결정 |
| FBO 방향 규약 불일치 | 마스크/UI 어긋남 | 규약 문서화 + 마커 정합 테스트 상시화 |
| 자동 기울기 오검출 | 잘못된 자동 보정 | confidence 임계·사용자 확인 UI, 자동 적용 금지 |
| 왜곡 역변환 발산 | UI 마커 위치 오류 | 뉴턴 반복·수렴 실패 시 원좌표 유지 + 경고 |
| 4096+ Export 메모리 | OOM/컨텍스트 손실 | 타일링 또는 사전 다운스케일 정책 |
| 다중 마스크 GPU 비용 | 셰이더 복잡도 | 마스크 수 상한/텍스처화, 단일 패스 유지 여부 결정 |
| SwiftShader 타이밍 | 성능 판단 왜곡 | 실제 GPU/모바일에서 재측정 |

## 10. 실제 렌즈 특성 vs 가상 효과, AI 미사용

- **기하/왜곡 보정**: Brown–Conrady 계수는 실제 렌즈 모델 형식이지만, 입력 계수는 사용자가 제공/조정하는
  값이다. PoC에는 렌즈 프로파일 자동 추정이 없다.
- **가상 심도/보케**: 초점 영역과 조리개 형태로 만드는 아티스트 도구다. 실제 초점 거리·조리개 값·장면 깊이를
  사용하지 않으며, "실제 렌즈 심도"로 표기하지 않는다.
- AI 깊이 추정/AI 마스킹/생성형 AI는 코드와 문서 어디에도 포함하지 않았다.

## 11. 다음 단계

1. Q01 Engine Contract 리뷰: 8장 요구사항 중 공통 렌더 패스/유니폼/방향 규약 확정.
2. 계약 확정 후 본 구현(별도 Checkpoint): 마스크 스택 다중화, aspect 정합, RGBA16F 정책, Export 타일링.
3. 실제 하드웨어(iOS Safari/Android Chrome/데스크톱 GPU)에서 성능·메모리 재측정.
4. 자동 기울기/4점 입력 UI와 Recipe 저장 스키마는 Q01·Q03과 인터페이스 합의 후 착수.
