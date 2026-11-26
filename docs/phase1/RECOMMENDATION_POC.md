# Q04 CP1 — Analysis Engine & 통계 기반 필름 추천 PoC

작성: Q04 Application Engineer · 2026-11-27
브랜치: `feature/phase1-q04-application`
범위: WO-41 ~ WO-43 (EXIF 인덱싱·검색, 히스토그램·색 분포 분석, 통계 기반 필름 프리셋 추천)

## 1. 요구와 원칙 매핑

| 요구 | 구현 |
| --- | --- |
| EXIF 인덱싱 & 검색 | `src/poc/q04/metadata.ts` — exifr 로컬 파싱, 증분 인덱스, 텍스트/날짜/ISO/모델 필터, 정렬 |
| 히스토그램·색 분포 | `src/poc/q04/analysis.ts` — luma/RGB 64bin, hue 12bin, 클리핑·암부·명부·중성 비율, 색온도, colorfulness |
| 통계 기반 추천 | `src/poc/q04/recommend.ts` — 명시적 타깃 상수 + 가중 유사도 + 조건부 보너스, 점수 근거 노출 |
| AI 미사용 | 학습 모델·추론 API·외부 전송 없음. 모든 상수는 레지스트리 설명에서 수기 작성한 휴리스틱 |

## 2. 픽셀 분석 — `analysis.ts`

입력은 `PixelSample { data: Uint8ClampedArray(RGBA), width, height }`로, 기존 톤 커브 히스토그램과 동일한 “프리뷰 canvas 최대 192px 샘플링” 방식을 재사용할 수 있게 했다(`analyzeCanvas(canvas, 192)`).

- alpha < 8 인 픽셀은 제외. 빈 샘플도 safe(0 분모 방지).
- 밝기: luma = 0.2126R + 0.7152G + 0.0722B, 64bin 히스토그램, 평균/중앙값.
- 대비: luma 표준편차 (0~255).
- 암부/명부/클리핑: luma ≤ 16 / ≥ 239 / ≤ 4 / ≥ 251 비율.
- 채도: HSV S 평균. 중성 비율은 S < 0.08.
- 색온도 warmth = (meanR − meanB)/255 ∈ [−1, 1].
- colorfulness: Hasler–Süsstrunk 지표 / 255 (채널 분산 기반, 0~1 클램프).
- hue 12bin: 기준 채도 이상 픽셀만, 픽셀 수가 아니라 **색량(채도 크기) 가중**으로 집계 — 회색 배경이 지배하지 않게 한다. `dominantHue`는 bin 중심(15°, 45°, …).
- shadowPoint/highlightPoint: p05/p95 luma.

비용: 192×192(36,864 px) 1회 ≈ 1.7 ms/op(측정 표 참조).

## 3. 영상 특징 → 추천 입력

`featuresFromAnalysis`는 0~1로 정규화한 10개 특징을 만든다.

| 특징 | 정의 | 용도 |
| --- | --- | --- |
| brightness | meanLuminance/255 | 5개 핵심 특징 |
| contrast | std/255 | 5개 핵심 특징 |
| saturation | meanSaturation | 5개 핵심 특징 |
| warmth | (warmth+1)/2 | 5개 핵심 특징 |
| colorfulness | Hasler–Süsstrunk/255 | 5개 핵심 특징 |
| shadowShare / highlightShare / neutralShare | 비율 | 보너스 조건 |
| skinToneShare | hue red 1.0 + orange·magenta 0.5 | 인물 보너스 **프록시** |
| greenBlueShare | green+aqua+blue+purple 1.0, cyan 0.5 | 풍경 보너스 **프록시** |

`skinToneShare`는 얼굴 검출이 아니다. 따뜻한 중간톤 hue 분포의 양이며, UI/문서에서도 “피부톤 후보 영역”으로만 표기한다.

## 4. 추천 알고리즘 — `recommend.ts`

### 4.1 필름 타깃 레지스트리

`FILM_TARGETS`는 FS-001~FS-009의 설명/목표 톤에서 수기 작성한 상수다(예: FS-003 warmth 0.68, FS-009 saturation 0.08). **학습 데이터가 아니며**, 각 점수는 이 타깃과의 비교를 그대로 노출한다. `identity`는 추천에서 제외한다.

### 4.2 점수식

핵심 특징 5개에 대해:

```
similarity_k = clamp01(1 − |image_k − target_k| / tolerance_k)
baseScore    = Σ weight_k · similarity_k,  clamp01
score        = clamp01(baseScore + Σ bonus_j)
```

- weight: brightness 0.20, contrast 0.22, saturation 0.22, warmth 0.24, colorfulness 0.12 (합 1.0)
- tolerance: 0.35 / 0.35 / 0.35 / 0.30 / 0.35
- 보너스(합계 상한 0.15, 초과 시 비례 축소):
  - 인물(FS-004/007): skinToneShare ≥ 0.12 → min(0.08, ×0.3)
  - 풍경(FS-006/005): greenBlueShare ≥ 0.28 → min(0.06, ×0.12)
  - 모노크롬(FS-009): saturation ≤ 0.08 & colorfulness ≤ 0.12 → 0.05
  - 저조도(FS-001/008): shadowShare ≥ 0.5 → 0.04
  - 하이라이트(FS-005/004): highlightShare ≥ 0.25 → 0.03

정렬: score 내림차순, 동점이면 filmId 오름차순(결정적 — 같은 입력은 항상 같은 순위). `limit` 기본 3, `minScore` 필터 지원.

### 4.3 근거 노출

결과 `Recommendation`은 filmName, filmStyle, score/baseScore, 5개 `criteria`(imageValue/target/tolerance/weight/similarity/contribution), `bonuses`(키·값·한국어 사유), 한국어 `summary`를 포함한다. UI는 “왜 이 필름인지”를 숫자와 함께 표시할 수 있고, CP2에서 사용자 피드백 수집 시 비교 기준이 된다.

## 5. EXIF 인덱스 — `metadata.ts`

- 파싱: exifr `pick`으로 DateTimeOriginal, Make/Model, LensModel, ISO, FNumber, ExposureTime, FocalLength, Exif/ImageWidth/Height만 추출. **업로드 없음.**
- `MetadataIndex.index(entries, { signal, concurrency = 2, force, onProgress })`:
  - 이미 인덱스된 ID는 skip, `force`로 재인덱싱.
  - 실패 레코드 저장 후 `IndexReport { indexed, skipped, failed, total, aborted }` 반환. abort 시 진행 중 파싱만 중단하고 생성분은 유지.
- `searchMetadata(records, query)`:
  - text: 이름/경로/모델을 `Intl.Collator(undefined, { numeric, sensitivity: 'base' })` 부분일치 + WeakMap haystack 캐시.
  - dateFrom/dateTo(YYYY-MM-DD 문자열 비교 — 사전순=시간순), isoMin/isoMax, models[].
  - sort: name | date-asc | date-desc | iso-asc | iso-desc, limit.
- 실제 EXIF 검증: `public/samples/about_preview.jpg`의 DateTimeOriginal = `2016-03-08` 확인(`tests/q04Metadata.test.ts`).

## 6. 검증 결과

`tests/q04Analysis.test.ts` (PASS):

- 중성 회색: 대비 0, 중성 100%, hue 지배색 없음, neutralShare 1.
- 검정/흰색 반반: 클리핑 0.5, 암부/명부 0.5, 대비 > 240.
- 순수 적/청: warmth ±1, hue bin 0/8, dominantHue 15°/255°.
- 투명 픽셀 제외, 빈 샘플 안전.
- 추천 순위: 따뜻한 인물 통계 → FS-003 1위 + FS-004/007 보너스, 쿨/저채도 → FS-002, 비비드 녹청 → FS-006(+landscape), 저조도 → FS-008(+lowlight), 거의 무채색 → FS-009(+monochrome).
- 항상 5개 criteria와 유한 수치, identity 제외, 정렬 결정성.

`tests/q04Perf.test.ts` (PASS):

| 측정 | 반복 | ms/op |
| --- | --- | --- |
| analyzePixels 192×192 | 200 | 1.68 |
| recommendFilms 9개 프로파일 | 2,000 | 0.039 |
| EXIF 검색 1만 레코드(텍스트+ISO+정렬) | 500 | 3.17 |

측정 방식은 6라운드 최소값(병렬 실행 노이즈 제거). 임계값(analyze < 20ms, recommend < 5ms, search < 20ms/op)은 회귀 감지용이며 완화하지 않았다.

## 7. 한계와 오해 방지

- 타깃 상수는 디자이너/프로파일 설명 기반 휴리스틱이며 “정답” 학습이 아니다. 원본 스타일과 어긋날 수 있으므로 근거 숫자를 항상 노출한다.
- 픽셀 통계는 192px 축소 샘플 기준이다. 미세 디테일·노이즈·RAW 정보를 반영하지 않는다.
- skinTone/greenBlue는 검출기가 아닌 hue-share 프록시다. 인물/풍경을 단정하지 않는다.
- 추천은 필름만 대상으로 하며 MARGARINE/RETRO 90 등 프리셋·Filter Set은 CP2에서 레지스트리 확장 필요.
- 추천 선택은 자동 적용하지 않는다(사용자 확인 후 적용).

## 8. CP2 제안

1. **레지스트리 확장**: FS-010 이상/프리셋을 `FilmTarget` 레지스트리에 추가하고, 타깃 상수를 UI에서 읽기 전용으로 표시.
2. **가중치 보정 절차**: 대표 사진 세트에 대해 순위 결과를 기록하고, 프로파일 담당 리뷰로 weight/tolerance만 조정(원본 LUT 불변). 결과표는 `.private/`에 보관.
3. **사용자 피드백 루프**: 추천 수락/거절 횟수만 로컬 집계해 순위 힌트로 사용할지 검토(서버 전송 없음, 옵트인).
4. **EXIF 연동**: 촬영 ISO/조도 힌트를 `shadowShare` 보너스의 보조 조건으로 확장.
5. **대용량 폴더**: 인덱스 영속화(IndexedDB)와 incremental 재방문 갱신 — 현재 PoC는 세션 메모리 인덱스.
