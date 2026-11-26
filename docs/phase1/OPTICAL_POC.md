# Phase 1 Optical PoC — Q02 / CP1 · CP1.1

- 담당: Q02 Optical Engineer
- 작업 브랜치: `feature/phase1-q02-optical`
- 기준 Commit: `b850f82e0eb3fc33c76619f5dee9eec3e8a4890a` (`origin/main`)
- CP1 Commit: `0b5e6caa6aa19b34d778ed8f36886e8cb7434384`
- 상태: **CP1.1 교정 + SC-02 Q01 계약 정합 완료.** OPT-01~05 교정, OPT-06~07 기술 검증·본개발 설계,
  Q01 `OpticalTransform` 어댑터·예산 측정 완료. **`src/` 미변경**, Q01 Engine Contract 확정 후 본 구현 착수.
- 범위: WO-08~WO-21 (Geometry & Local Adjustment), WO-37~WO-40 (Optical Effects)

## 0. CP1.1 교정 요약 (검토 Commit `0b5e6ca`)

| 항목 | 결함 | 교정 | 검증 |
|------|------|------|------|
| OPT-01 | 희소 직선 영상에서 Sobel 임계값이 에지를 놓쳐 기울기 검출 실패 | 임계값을 `max(percentile, 0.1·maxMagnitude)`로 상향, 대비 기반 confidence | 희소 4° 선 복원 오차 < 0.6°, 저텍스처 노이즈 confidence < 0.1, 평면 0 |
| OPT-02 | GPU 브러시가 8선분으로 제한, 단일 포인트 미지원 | 브러시 선분을 512×32 RGBA32F 텍스처로 업로드, 마스크당 최대 1024선분, 1점 스트로크를 0길이 선분으로 처리 | 단일 포인트 + 121선분 CPU/GPU 차이 0/255, 후반 선분(≈92번) 단독 커버 확인 |
| OPT-03 | GPU 마스크/CoC가 UV를 그대로 사용해 비정사각에서 CPU와 불일치 | 기하·보케 셰이더에 `u_aspect` short-side 변환 추가 | 1:1/4:3/16:9/9:16 마스크·CoC CPU/GPU 차이 0/255 |
| OPT-04 | 발산/비가역 왜곡 계수를 조용히 뉴턴 반복 | 가역성 게이트(방사 단조성 + 접선 야코비안), 구간 이분 초기값, 잔차 검증, 실패 시 예외 | `k1=2,k2=−0.2` 수렴·잔차 < 1e-6, `k1=−0.5` GPU render 즉시 거부 |
| OPT-05 | Feather 0에서 `smoothstep(e,e,x)` 경계 동작 불명확, 0 나눗셈 위험 | `ss()`가 span<1e-6이면 step으로 처리, 모든 페더/반경 `max(…,1e-8)` 가드 | radial/linear/brush/luma/colour feather 0·최대 CPU/GPU 차이 0/255, NaN 없음 |
| OPT-06 | 보케 비용이 탭·해상도에 무제한 비례 | 탭 예산 정책 `suggestTaps`, 미리보기 half-resolution gather + upscale 패스 | 탭/해상도 비용 표, half-res 2.4~9.6× 절감, 합성 품질 평균/최대 차이 0 |
| OPT-07 | GPU가 단일 마스크만 지원 | 8슬롯 유니폼 배열(add/subtract/intersect, invert, opacity) + 브러시 범위 테이블 | 4-마스크 스택 CPU `composeMaskStack` 대비 차이 0/255 |


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
| 3 | 라인 검출 기반 자동 기울기 | `poc/optical/math/skew.ts` (Sobel+Hough) | +3°, −2°, 0° 복원 오차 < 0.3°; 희소/저텍스처 | 통과 |
| 4 | 방사/접선 렌즈 왜곡 | `poc/optical/math/distortion.ts` | 왕복 오차 < 1e-7, GPU 방향 일치, 가역성 게이트 | 통과 |
| 5 | Brush/Linear/Radial 마스크 | `poc/optical/math/masks.ts`, GPU `maskWeight` | 단위 + GPU 단일점/121선분 브러시 | 통과 |
| 6 | Luminance/Color range 마스크 | 동일 | 단위 + GPU (장면 4분면) | 통과 |
| 7 | 마스크 합성/페더링 | `composeMaskStack` (add/subtract/intersect) | 단위 + GPU 4-마스크 스택 (CP1.1) | 통과 |
| 8 | 수동 초점 영역 렌즈 블러 | `focus.ts`, GPU `BOKEH_SOURCE` | CoC 단조성, 평면/에너지 보존, half-res 품질 | 통과 |
| 9 | PSF/조리개 형태 보케 | `apertureTapWeights` + 64×1 RGBA32F PSF 텍스처 | 가중치 합 1, 육각 footprint, 탭 예산 정책 | 통과 |
| 10 | 기하 변환 후 마스크 좌표 정합 | `coordinates.ts`, GPU 패스 | 마커/마스크 정합, 512↔1024, 1:1~9:16 패리티 | 통과 |

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
- 마스크 스택은 add → `min(1, a+w)`, subtract → `max(0, a−w)`, intersect → `a·w`. invert/opacity는
  블렌드 전에 적용한다. GPU PoC 하네스는 **최대 8개**를 유니폼 배열(`kind/blend/invert/a/b/c/opacity`)로 처리한다.
  **8개는 하네스 상한이며 제품 한도가 아니다** — 정본은 Q01의 16이며, 16마스크 유니폼 예산은 12.2에서 측정했다.
- 브러시는 선분 테이블(512×32 RGBA32F, 선분당 2텍셀)로 업로드하며 **하네스 상한은 마스크당 1024선분**이다.
  한 점짜리 스트로크는 0길이 선분으로 변환하고, 구형 `points/radius/hardness/flow` 입력도 수용한다.
  여러 마스크가 있으면 (start,count) 범위를 `u_mask_c`로 전달한다. Q01 정본은 64스트로크×1024포인트이며,
  전량 수용 비용과 대안은 12.3에 정리했다.
- GPU 마스크/CoC 거리는 `u_aspect`로 short-side 변환해 CPU와 일치한다(CP1.1). 파이프라인은 NIS 좌표만
  사용하므로 해상도가 달라도 같은 좌표·같은 페더 결과가 나온다.
- 남은 프로덕션 요구: 마스크 수 상한(8)은 유니폼 기반 PoC의 한계다. 실제 제품에서 마스크 수가 이를 넘으면
  마스크 레이어를 텍스처/R8로 사전 래스터화하는 2단계 전략이 필요하다(9장 리스크).

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

- 계수는 centered space. 화면 밖에서도 다항식이 단조라고 가정하지 않는다.
- GPU 샘플링은 **정방향(corrected→source)** 만 필요하므로 뉴턴 반복이 없다.
- 역방향(source→corrected, UI 마커/마스크 재정합)은 2D 뉴턴법. 해석적 야코비안 사용, 최대 16회(테스트는 64회), 허용오차 1e-9.
- **가역성 게이트(OPT-04)**: `isDistortionInvertible`이 (a) 반경 `r ∈ [0, 1.5]`에서 방사 프로파일 미분
  `1 + 3k1r² + 5k2r⁴ + 7k3r⁶ > 1e-6`, (b) 접선 항이 있으면 `±1.2` 격자에서 야코비안 행렬식 `> 1e-6`을 확인한다.
  통과하지 못하면 `tryUndistortNormalized`는 `ok:false`를 반환하고 `undistortNormalized`/GPU `render()`는 예외를 던진다.
  조용한 발산 대신 명시적 거부다.
- 초기값은 `radialAt(r) = r(1+k1r²+k2r⁴+k3r⁶)`의 구간 이분해로 잡고, 뉴턴 종료 후 잔차를 다시 검증한다
  (`residual > max(1e-6, tol·10)`이면 실패). 특이 야코비안/비유한 스텝도 실패로 처리한다.
- 검증: 기존 계수(k1 0.22, k2 −0.035, p1 0.008, p2 −0.006) 통과, `k1=2,k2=−0.2` 잔차 < 1e-6,
  `k1=−0.5`(r≈1.41 접힘)·NaN 거부. 단위 왕복 오차 < 1e-7.
- 남은 한계: 게이트는 샘플 격자 검사이므로 격자 사이의 국소 접힘을 이론적으로 놓칠 수 있다. 계수 입력 UI는
  범위를 제한하고, 거부 시 원좌표 유지 + 경고를 표시해야 한다.

### 4.3 자동 기울기 (Sobel + Hough)

1. Rec.709 luma → 3×3 Sobel. 최대 그래디언트를 함께 추적한다.
2. 상위 `edgePercentile=0.9` 임계값을 **`max(percentile, 0.1·maxMagnitude)`**로 상향한다(OPT-01).
   희소 직선 영상은 대부분의 픽셀이 0이라 백분위만으로는 에지를 놓치고, 저대비 텍스처는 그래디언트 게이트로 걸러진다.
   최대 그래디언트가 1e-3 미만이면 즉시 0/confidence 0을 반환한다.
3. 선 법선 각도 0~180°를 0.25° 간격 Hough, 가중치 `min(4, mag/threshold)`, rho 1px 빈, 에지 픽셀 최대 12,000개.
4. 최대 피크를 포물선 보간으로 세분화 → 가장 가까운 0°/90° 축과의 차이를 반환.
5. `confidence = clamp(peak / min(width,height) · min(1, maxMagnitude/0.5), 0, 1)` — 대비 항을 추가해
   저텍스처 노이즈가 높은 confidence를 얻지 못하게 한다.

검증: 256² 합성 그리드에서 +3°, −2°, 0° 모두 오차 < 0.3°. CP1.1에서 4° 희소 직선(주기 40px) 복원 오차 < 0.6°,
저텍스처 노이즈(진폭 0.004) confidence < 0.1, 평면 confidence 0을 확인했다. 자동 적용 임계(예: 0.1)는 UI 정책이다. AI 검출 아님.

### 4.4 마스크

- Radial: `w = 1 − smoothstep(1−f, 1, |R(−θ)(p−c)/r|)`
- Linear: 투영 `t`에 대해 `smoothstep(0.5−f/2, 0.5+f/2, t)`
- Brush: 폴리라인 최단거리 `d`, `w = (1 − smoothstep(r(1−h), r, d)) · flow`, 스트로크/선분 합성은 `a + w − a·w`.
  단일 포인트는 거리 기반 점 마스크로 처리하고, 선분 수 상한은 GPU 1024/마스크다.
- Luminance: `l`이 `[lo,hi]` 밖이면 경계에서 0으로 페더, 안이면 1
- Color: HSL의 hue/sat/lum 밴드를 곱. 무채색 대상/샘플은 hue를 무시.
- Feather는 `[0,1]`로 클램프. 컴포지션은 3.3의 add/subtract/intersect.
- **경계 가드(OPT-05)**: 페더 폭이 0인 `smoothstep(e,e,x)`는 CPU(`edge1<=edge0`)와 GLSL `ss()` 모두
  step 함수로 정의한다(span < 1e-6). 반경/페더는 `max(…,1e-6)`(GLSL 1e-8)로 나눗셈을 보호한다.
  feather 0·1, brush hardness 1, luma/colour feather 0에서 CPU/GPU 차이 0/255, NaN 없음.

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
- **탭 예산 정책(OPT-06)**: `suggestTaps(maxCocShortSide, shortSidePx, quality)`가 CoC 픽셀 반경으로 등급을 정한다.
  CoC < 0.75px → 0탭(정확한 항등), < 6px → 12/24, < 20px → 20/40, 그 외 → 32/64 (preview/export).
  미리보기는 half-resolution gather(`bokehScale: 2`) 후 bilinear upscale을 허용하지만, 기하·마스크·CoC 좌표는
  export와 동일한 NIS를 쓰므로 위치 정합은 유지된다. 탭 수는 출력 해상도가 아니라 화면상 CoC 크기로 결정한다.
- 한계: 이 모델은 수동 초점 영역 기반 **가상** 효과다. 장면 깊이맵이 없으므로 실제 초점면/피사계 심도를
  재현한다고 표기해서는 안 된다. 조리개 형태는 아티스트 파라미터이지 특정 렌즈 계측값이 아니다.

## 5. GPU PoC 구조

`poc/optical/gpu/optical-poc.html` + `optical-poc.ts`. 캔버스는 `size`(short side 16~2048)와 `aspect`(0.2~5)로
결정되며 장변은 2048로 제한한다.

| 패스 | 대상 | 내용 |
|------|------|------|
| 1 | Scene FBO (RGBA8) | 절차적 그리드/컬러/점광원 기준 장면. 크기·장면 키로 캐시 |
| 2 | Graded FBO (RGBA8) | corrected→source 호모그래피+왜곡 sampling, 8-마스크 스택, 로컬 노출, 마스크 뷰 |
| 3 | Blur FBO (선택) / 기본 FB | 가상 CoC + PSF gather (view=composite), half-res(scale 2) 시 별도 FBO |
| 4 | 기본 FB (선택) | half-res blur bilinear upscale |

- 검증 API: `window.__opticalPoc.render(patch)`, `readPixel(u,v)`, `sumRegion(...)`, `info()`.
- 브러시 선분 테이블은 512×32 RGBA32F, PSF는 64×1 RGBA32F. 업로드는 입력 JSON 키로 캐시한다.
- 각 패스 종료 시 1×1 `readPixels` + `gl.finish()`로 동기화. `gl.finish()`만으로는 ANGLE 명령 스트림이
  플러시되지 않아 0.1ms대의 허수 측정이 나왔다(CP1 기록).
- `readPixel`은 y-down NIS 기준, 리드백에서 y를 뒤집는다.
- PoC는 최대 8마스크·최대 1024선분/마스크·8bit 중간 버퍼라는 **하네스 한계**를 가진다. 프로덕션 구조 제안이 아니며,
  제품 지원 범위를 이 수치로 주장하지 않는다(정본·예산은 12장).

## 6. 검증 테스트 및 기준 이미지

- 단위: `tests/optical-math.test.ts` — 35 tests. 호모그래피/역행렬, 왜곡 왕복·가역성 게이트, 기울기 복원
  (희소 직선/저텍스처/평면), 좌표 정합, 마스크/페더 0·최대/단일점·121선분/컴포지션, PSF 정규화/항등/에너지/
  점광원 footprint/CoC 단조, 탭 예산, CPU 성능 스모크.
  `tests/optical-contract.test.ts` — 9 tests. Q01 `OpticalTransform` 어댑터(version/perspective/특이 행렬/
  범위/왕복/방향) 검증.
- GPU: `tests/e2e/optical-poc.spec.ts` — chromium 7 tests (CP1). `tests/e2e/optical-cp11.spec.ts` — chromium 8 tests:
  aspect 마스크·CoC 패리티, 단일점/121선분 브러시, 페더 극값, 극단/비가역 왜곡, 미리보기↔Export 마스크 패리티,
  4-마스크 스택, 탭/해상도 비용, half-res 보케 비용·품질.
  `tests/e2e/optical-contract-budget.spec.ts` — chromium 2 tests: 16마스크 유니폼 probe 링크/GL 한도 측정,
  PoC 상한 브러시 비용 측정.
  비-chromium 프로젝트는 `beforeEach`에서 skip(데스크톱 Chromium 기준 검증).
- **CP1.1 필수 검증 결과** (2026-11-27, ANGLE SwiftShader):

| 검증 | 방법 | 결과 |
|------|------|------|
| aspect 1:1, 4:3, 16:9, 9:16 | radial 마스크 15점 + CoC 15점 CPU/GPU 비교 | 마스크 최대 차이 **0/255**, CoC ≤ 3/255 |
| 단일 포인트 브러시 | 점 중심/외곽 CPU/GPU | 차이 **0/255** |
| 100+ 선분 브러시 | 121선분, 후반 선분(≈92번) 커버 확인 | 후반 커버 > 150/255, CPU/GPU 차이 **0/255** |
| Feather 0 / 최대 | radial·linear·brush·luma·colour | 차이 **0/255**, NaN 없음 |
| 극단 왜곡 계수 | `k1=2,k2=−0.2` 마커 위치, `k1=−0.5` 거부 | 마커 정합, 비가역 render 예외 |
| 저텍스처/희소 직선 | 희소 4° 선, 노이즈 진폭 0.004, 평면 | 오차 < 0.6°, confidence < 0.1 / 0 |
| 미리보기/Export 마스크 좌표 | radial+브러시, 160↔320, 9점 | 최대 **2/255** |
| CPU/GPU 기준 픽셀 | 마스크 뷰 픽셀 vs `composeMaskStack` | 스택 4마스크 차이 **0/255** |
| half-res 보케 품질 | 256² 합성 16점 full vs half | 평균/최대 차이 **0/255** |
| Q01 어댑터 | version/perspective/특이 행렬/왕복 | 9 tests 통과 |
| 16마스크 유니폼 | probe 셰이더 링크, 유니폼 100 vec4 상한 | 링크 성공, 한도 4096 대비 여유 (12.2) |

- 기존 CP1 테스트 7종은 그대로 통과(삭제·단정 완화 없음). 전체 단위 스위트 17 files / 123 tests 통과.
- CP1에서 테스트로 발견한 결함(모두 수정):
  1. GPU FBO 상하 반전 → 마스크/장면 불일치 (3.2 규약으로 수정)
  2. Luminance 마스크 하한 램프 반전 (`bandWeight`) → CPU·셰이더 동시 수정, 하한/상한 페더 단위 테스트 추가
  3. 보케 에너지 테스트가 서로 다른 영역 크기를 비교(테스트 버그) → 동일 영역으로 수정
- CP1.1에서 테스트로 발견한 결함: GPU 컬러 마스크가 hue 대신 `hueRange`를 비교 → 유니폼 인덱스 수정.
  마스크 스택 CPU 기준 계산이 장면 색을 넘기지 않아 CPU 0/GPU 244로 불일치 → 테스트가 장면 색을 전달하도록 수정
  (제품 코드 결함 아님).

## 7. 성능 및 메모리 (측정값)

측정 환경: macOS arm64, Node 24, Playwright Chromium + **ANGLE SwiftShader(소프트웨어 래스터라이저)**.
GPU 수치는 하드웨어 GPU 성능이 아니며, 실제 기기 재측정이 필요하다.

CPU (vitest 스모크, 1회):

| 작업 | 측정 |
|------|------|
| 호모그래피 해 2,000회 | 27.8ms (약 13.9µs/회) |
| 마스크 평가 200,000회 | 41.9ms (약 0.21µs/회) |
| 128×96 RGBA, 64탭 gather | 13.1ms |

GPU (CP1.1, 3프레임 평균, 동기화 포함, 32탭 blur):

| 크기 | geometry | bokeh | total |
|------|----------|-------|-------|
| 512² | 10.7ms | 31.2ms | 42.0ms |
| 1024² | 21.3ms | 117.3ms | 138.7ms |

탭 수별 bokeh(3프레임 평균):

| 크기 | 16탭 | 32탭 | 64탭 |
|------|------|------|------|
| 512² | 19.1ms | 35.5ms | 70.7ms |
| 1024² | 73.8ms | 117.3~261.6ms | 335.6ms |

half-resolution gather(512², 32탭): scale 1 = 28.9~35.1ms, scale 2 = 7.2~8.7ms (**2.4~9.6× 절감**,
다른 실행에서 161.0 → 16.8ms). 256² 합성 16점 품질 차이는 평균/최대 0/255였다(저주파 장면 기준).

- 실행 간 변동이 크다(같은 1024²·32탭이 117~262ms). 소프트웨어 래스터라이저 특성이며, 비용의 상대 순서
  (탭↑, 해상도↑, half-res↓)만 신뢰한다.
- bokeh 패스가 지배적이며 탭 수·픽셀 수에 비례한다. scene 패스는 캐시되어 0ms로 집계된다.
- 메모리(정사각 size s, half-res 미사용): Scene + Graded + 캔버스 = `3·s²·4B`, PSF 1KB, 브러시 테이블 256KB.
  512²≈3.1MB, 1024²≈12.6MB, 2048²≈50.3MB. half-res 사용 시 Blur FBO `s²/4·4B` 추가.
  4096² export는 약 201MB로 모바일 예산 초과 위험.

## 8. Q01 Engine Contract 요구사항 (공통 파일 수정 필요분, 구현은 Q01 소관)

현재 엔진은 단일 `grade()` + 샤프닝 1패스 구조라 아래가 필요하다. 본 브랜치에서는 `src/`를 수정하지 않았다.

1. **패스 그래프**: ping-pong FBO로 최소 3패스(장면/기하·마스크/광학) 지원, 중간 텍스처 노출.
2. **RenderOptions 확장**: geometry(H, distortion), masks[], localAdjustments, focus/aperture/taps/bokehScale.
   미리보기/Export가 동일 유니폼을 쓰고 해상도만 달라야 한다. 마스크 스택(최대 8)·브러시 선분 테이블 PoC로 검증됨.
3. **방향 규약**: 3.2의 y-flip 규약을 엔진 샘플링 API에 문서화하고 일관 적용.
4. **aspect 유니폼**: 비정사각 short-side 변환을 마스크/CoC/브러시에 적용(PoC에서 1:1~9:16 검증). 엔진 API로 승격 필요.
5. **포맷/클램프**: 로컬 노출 밴딩 방지를 위해 RGBA16F(가능 시) 또는 감마 보정 정책 결정. 현재 PoC는 8bit 클램프.
6. **리소스 수명**: size 변경/Export마다 FBO·텍스처 명시 해제(`destroy()` 경로), 미리보기 캐시 재사용.
7. **Export 정합**: 동일 패스·동일 taps로 원본 해상도 실행, 최대 텍스처 크기 초과 시 타일링 정책 필요.
8. **Registry**: geometry/mask/effect 타입을 Registry에 등록, 기능별 하드코딩 금지.
9. **Recipe 연동**: 마스크/기하/초점 파라미터를 Recipe v1~v7과 분리된 신규 섹션으로 저장, 하위 호환 유지.
10. **UI 좌표 API**: `sourceToCorrected`/`correctedToSource`를 엔진에서 제공해 마스크 오버레이 정합.

## 9. 리스크와 한계

| 리스크 | 영향 | 대응 |
|--------|------|------|
| GPU 성능(특히 bokeh gather) | 모바일 프레임 저하 | `suggestTaps` 예산 + 미리보기 half-res(실측 2.4~9.6× 절감), Export는 full-res·높은 탭 |
| half-res 미리보기 품질 | 고주파 에지/텍스트에서 미세 블리드 | 저주파 장면에서 차이 0 확인, 하드웨어에서 고주파 기준 재검증 후 preview에만 제한 적용 |
| 8bit 중간 버퍼 밴딩 | 로컬 노출/광학 보정 계단 | RGBA16F 지원 여부 확인, 클램프 범위 결정 |
| FBO 방향 규약 불일치 | 마스크/UI 어긋남 | 규약 문서화 + 마커 정합 테스트 상시화 |
| 자동 기울기 오검출 | 잘못된 자동 보정 | confidence 임계·사용자 확인 UI, 자동 적용 금지 |
| 왜곡 역변환 발산 | UI 마커 위치 오류 | 가역성 게이트 + 실패 시 원좌표 유지·경고, 계수 입력 범위 제한 |
| 4096+ Export 메모리 | OOM/컨텍스트 손실 | 타일링 또는 사전 다운스케일 정책 |
| 마스크 수/브러시 선분 상한 | 복잡한 로컬 조정 저장 불가 | PoC 상한 8마스크·1024선분/마스크. 초과 시 마스크 레이어 텍스처 사전 래스터화 또는 선분 단순화 정책 |
| SwiftShader 타이밍 | 성능 판단 왜곡 | 실제 GPU/모바일에서 재측정 |

## 10. 실제 렌즈 특성 vs 가상 효과, AI 미사용

- **기하/왜곡 보정**: Brown–Conrady 계수는 실제 렌즈 모델 형식이지만, 입력 계수는 사용자가 제공/조정하는
  값이다. PoC에는 렌즈 프로파일 자동 추정이 없다.
- **가상 심도/보케**: 초점 영역과 조리개 형태로 만드는 아티스트 도구다. 실제 초점 거리·조리개 값·장면 깊이를
  사용하지 않으며, "실제 렌즈 심도"로 표기하지 않는다.
- AI 깊이 추정/AI 마스킹/생성형 AI는 코드와 문서 어디에도 포함하지 않았다.

## 11. 다음 단계

1. Q01 Engine Contract 리뷰: 8장 요구사항 중 공통 렌더 패스/유니폼/방향 규약 확정.
2. 계약 확정 후 본 구현(별도 Checkpoint): 마스크 스택·브러시 테이블 승격, aspect 정합, `suggestTaps`/half-res
   미리보기 정책, RGBA16F 정책, Export 타일링.
3. 실제 하드웨어(iOS Safari/Android Chrome/데스크톱 GPU)에서 탭/해상도별 성능과 half-res 고주파 품질 재측정.
4. 자동 기울기/4점 입력 UI와 Recipe 저장 스키마는 Q01·Q03과 인터페이스 합의 후 착수.

## 12. SC-02 Q01 계약 정합 및 한도 예산

### 12.1 `OpticalTransform` 어댑터

Q01 계약(`src/engine/contracts/optical.ts`, branch `feature/phase1-pro-engine`)은 수정하지 않고,
Q02 쪽 어댑터 `poc/optical/math/optical-transform.ts`에서 차이를 흡수한다.

| 차이 | Q01 계약 | Q02 PoC | 어댑터 처리 |
|------|----------|---------|-------------|
| 버전 | `version: 1` 필수 | 버전 필드 없음 | `toOpticalTransform`이 `version: 1` 부여 |
| 원근 quad | 선택 `perspective` (TL,TR,BR,BL) | `OpticalGeometry`에 없음 | 인자 또는 `geometry.perspective`로 전달, 있으면 보존 |
| 왜곡 계수 | k1≤1.5, k2/k3≤1, p1/p2≤0.5 | 동일 형식(k3 포함) | 경계 위반 시 변환 단계에서 거부 |
| 행렬 | 비유한/특이 행렬 거부 (det ≤ 1e-8) | `invertMat3`가 예외 | `assertOpticalTransform`이 선제 거부 |
| 방향 | corrected NIS → source NIS | 동일 | 변환 없이 그대로 매핑 |

- API: `toOpticalTransform(geometry, perspective?)`, `fromOpticalTransform(transform)`.
  `fromOpticalTransform`은 검증 후 Q02 `OpticalGeometry`(+`perspective`)로 깊은 복사해 반환한다.
- 검증 테스트 `tests/optical-contract.test.ts`: version 포함, perspective 포함/복사, 특이·비유한 행렬 거부,
  계수 범위·비볼록 quad 거부, version 2 거부, 왕복 보존, Q01 quad 공식 일치, corrected→source 방향·역변환 고정.
- 주의: Q01 검증은 계수 **범위**만 보므로 `k1=−0.5`처럼 Q01을 통과하지만 Q02 렌더 가역성 게이트(4.2)에서
  거부되는 조합이 있다. 어댑터는 통과시키고 렌더 시 명시적으로 실패한다. Q01 검증에 가역성 조건을 넣을지는
  Q01 소관이며, 본 브랜치에서 Q01 src를 수정하지 않았다.

### 12.2 GLSL uniform 예산 (16마스크)

측정: `tests/e2e/optical-contract-budget.spec.ts` — 데스크톱 Chromium + ANGLE SwiftShader, probe 셰이더 링크.

| 항목 | 측정/계산 | 결과 |
|------|-----------|------|
| `MAX_FRAGMENT_UNIFORM_VECTORS` | 4096 | 16마스크 보수적 요구 100 vec4 대비 충분 |
| 16마스크 유니폼 | int×3×16 + vec4×2×16 + vec2×16 + float×16 | 활성 배열 `size=16`, `u_mask_a[15]` 등 위치 유효 |
| probe 링크 | 16마스크 배열 + 기존 기하 유니폼 | `linked=true` |
| `MAX_TEXTURE_SIZE` / 이미지 유닛 | 8192 / 32 | 세그먼트 텍스처·PSF·장면 동시 바인딩 여유 |

uniform은 16마스크까지 수용 가능하다. 병목은 마스크 수가 아니라 브러시 선분 수다.

### 12.3 브러시 선분/텍스처 예산과 대안

Q01 정본 상한(16마스크 × 64스트로크 × 1024포인트)을 전량 수용할 때:

| 항목 | 계산 | 결과 |
|------|------|------|
| 최악 선분 수 | 16 × 64 × 1023 | 1,047,552 segments |
| 세그먼트 테이블 바이트 | ×32B (선분당 2×RGBA32F) | 33,554,432B (33.5MB) |
| 필요 텍스처 | 4096×512 RGBA32F (용량 1,048,576 segments) | 크기상 수용, 모바일 메모리 부담 큼 |
| 현재 하네스 테이블 | 512×32 (8,192 segments) | 262,144B |
| 측정 비용 | 128², 4마스크×1024선분 = 473.6ms | segment-pixel 백만당 7.06ms |
| 최악 외삽 | 16×65,472선분 × 512² | 약 1.94×10⁶ms(≈32분) — 단일 패스 불가 |

측정값은 소프트웨어 래스터라이저 기준이며 절대치가 아니라 규모 판단용이다. 단일 패스 선분 루프로는
정본 상한을 수용할 수 없으므로 다음 대안이 필요하다(정본 한도는 Q01이 결정).

1. **브러시 마스크 사전 래스터화**: 스트로크 SDF를 R8(또는 half-res) 마스크 텍스처에 스탬프.
   비용은 화면 픽셀×선분이 아니라 스탬프 면적에 비례. 예: 16×512² R8 = 4MB, 16×1024² R8 = 16MB.
2. **스트로크별 바운딩 박스/scissor**: 화면 전체 루프를 스트로크 영향 영역으로 축소.
3. **타일 비닝/compute 스탬프**: 타일별 선분 리스트로 반복 횟수를 줄이는 구조.
4. **통합 전 가드**: 정본 한도 확정 전까지 Q02 하네스의 1024선분/마스크 초과 입력은 거부하거나
   사전 래스터화 경로로 우회한다. 8마스크·1024선분은 **PoC 하네스 상한**이며 제품 지원 한도가 아니다.

### 12.4 샘플링 규약과 Q01 geometryMappings 경계

- 좌표는 **NIS, 원점 좌상단, y-down**. 광학 호모그래피는 **corrected NIS → source NIS**이며,
  `sourceToCorrected`가 그 역방향이다(어댑터 테스트로 방향·왕복 < 1e-9 고정).
- FBO 텍스처는 하단이 texel 0이므로 샘플링 시 `texture(tex, vec2(u, 1−v))`, `readPixels` 리드백에서 y를 뒤집는다(3.2).
- 마스크·CoC·브러시 거리는 `aspect` short-side 단위로 계산한다. Preview/Export는 같은 NIS·같은 유니폼을 쓰고
  해상도만 바꾼다.
- 테스트 고정: 미리보기 160↔Export 320 마스크 좌표 최대 2/255(CP1.1), 512↔1024 합성 최대 1/255(CP1),
  1:1~9:16 마스크/CoC CPU↔GPU 차이 0/255.
- Q01 `geometryMappings`는 flip→rotate→straighten→crop 순서로 **geometry NIS**를 만들고, Q02는 그 출력 NIS를
  광학 샘플링 입력으로 소비한다(픽셀 버퍼 비변경). Q02 브랜치에는 Q01 `src`가 없어 cross-branch 직접 import
  테스트는 실행할 수 없다 → **UNVERIFIED**, 통합 시 `geometry-contract.spec.ts`와 함께 확인해야 한다.
- 지원 주장 범위: 이 PoC가 실제로 검증한 것은 8마스크·1024선분/마스크·8bit 중간 버퍼까지다. 16/64/1024와
  RGBA16F, 모바일 실기기는 본 구현/통합 단계에서 별도 검증 대상이다.
