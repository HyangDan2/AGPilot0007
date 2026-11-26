# Q03 외부 라이브러리 라이선스 검토

상태: 2026-11-27 · 확인 범위: PoC `poc/q03-imaging/package.json`의 직접 의존성과 실제 번들 산출물. 법률 자문이 아니며, 제품 도입 전 고지·소스 제공 의무를 법무/오너가 최종 확인해야 한다.

## 1. 요약

| 패키지 | 버전 | 선언 라이선스 | 용도 | 제품 번들 권장 |
|---|---|---|---|---|
| flashraw | 0.5.0 | **MIT OR Apache-2.0** | RAW 디코드 엔진 | ✅ 사용 가능. MIT/Apache 고지 포함 |
| mediabunny | 1.66.4 | **MPL-2.0** | WebCodecs 디먹스/먹스/인코드 래퍼 | ✅ 사용 가능. MPL 고지 + 수정 파일 소스 공개 의무 준수 |
| libraw-wasm | 1.6.0 | npm 메타데이터 **ISC** (래퍼) | 참고 디코드 비교 | ⛔ **번들 제외 권장** — 아래 §3 |
| playwright-core | 1.57.0 | Apache-2.0 | 측정 드라이버(개발 전용) | 배포 대상 아님 |
| vite | 6.2.0 | MIT | 빌드 도구 | 배포 대상 아님 |

검증 근거:
- `node_modules/flashraw/LICENSE-MIT`, `LICENSE-APACHE` 존재. `package.json` license `MIT OR Apache-2.0`.
- `node_modules/mediabunny/LICENSE` = MPL-2.0 전문. `package.json` license `MPL-2.0`. 런타임 의존성 0.
- `node_modules/libraw-wasm/package.json` license `ISC`. 패키지에 라이선스 파일이 없고 README에도 원본 라이선스 표기가 없다. README는 "same robust codebase behind LibRaw"라고 명시.

## 2. FlashRaw (MIT OR Apache-2.0)

- MIT 또는 Apache-2.0 중 선택 적용 가능. 정적 번들에 저작권·라이선스 고지를 포함하면 된다.
- WASM 바이너리도 같은 라이선스로 배포된다고 패키지에 고지되어 있다(패키지 내 라이선스 파일 기준).
- 번들 형태: `flashraw_simd.wasm` 등 6개 변형이 동적 import로 포함된다. 고지 문구는 앱의 `THIRD_PARTY_NOTICES`에 추가해야 한다(CP1에서는 앱 수정 없음).
- 확인 한도: 이 PoC는 npm 배포물의 선언만 확인했다. 저장소의 LICENSE 파일과 대조하는 최종 확인은 제품 도입 시 수행한다.

## 3. LibRaw-Wasm (래퍼 ISC + 내부 LibRaw LGPL-2.1/CDDL-1.0) — 제품 번들 제외 권장

- libraw-wasm은 LibRaw를 Emscripten으로 WASM에 **정적 링크**한 패키지다. npm에는 래퍼의 `ISC`만 표기되어 있으나, 내부 LibRaw 자체는 LGPL-2.1 또는 CDDL-1.0(이중)이다.
- LGPL 준수는 사용자가 라이브러리를 교체/재링크할 수 있는 형태를 요구한다. 정적 링크된 WASM을 단일 파일로 배포할 경우 고지·소스 제공·재링크 가능성에 대한 별도 검토가 필요하다.
- 이번 PoC에서 LibRaw은 **참고 출력 생성에만** 사용했고, 제품 코드/문서 산출물에 LibRaw 결과물을 내장하지 않는다. `results/raw/images/*_libraw.jpg`는 PoC 증거로 저장된 참고 이미지다.
- 권장: 제품 번들에서 libraw-wasm을 제거하고, 필요 시 FlashRaw 단일 엔진으로 통일한다. 참고 디코드가 계속 필요하면 개발 전용(배포 제외)으로 분리한다.

## 4. mediabunny (MPL-2.0)

- MPL-2.0은 파일 단위 약한 카피레프트다. 라이브러리 파일을 수정하지 않고 그대로 번들·배포하면, MPL 고지와 해당 파일의 소스 위치 안내로 의무를 충족할 수 있다.
- 이번 PoC는 mediabunny를 수정하지 않았다. 번들 시 `mediabunny` 라이선스 고지를 포함해야 한다.
- mediabunny는 내부적으로 브라우저 WebCodecs만 사용하며, 별도 코덱 바이너리를 포함하지 않는다(패키지 의존성 0).

## 5. 도구/샘플 (배포 대상 아님)

| 항목 | 라이선스/출처 | 사용 |
|---|---|---|
| ffmpeg 7.1.1 | LGPL/GPL 빌드(Homebrew) | 로컬 합성 fixture 생성만. 산출물에 포함하지 않음 |
| raw.pixls.us 샘플 | 공개 RAW 샘플 데이터베이스 | 로컬 측정 입력. `testdata/`는 Git 제외, 저장소에 원본 미포함 |
| Playwright Chromium | Apache-2.0 등 | 로컬 측정 브라우저. 배포물 아님 |

## 6. CP1.1 고지 파일 (IMG-11)

- PoC용 고지 문서 `poc/q03-imaging/THIRD_PARTY_NOTICES.md`를 작성했다. FlashRaw(MIT/Apache, WASM 6종), Mediabunny(MPL-2.0, 미수정 번들 시 소스 위치 안내), LibRaw-Wasm 제품 번들 제외(LGPL-2.1/CDDL), raw.pixls.us 샘플(CC0, 저장소 재배포 안 함), ffmpeg/Playwright(도구 전용)를 명시했다. 제품 편입 시 앱의 기존 `THIRD_PARTY_NOTICES.md`(빌드에서 `.txt`로 포함)에 병합한다.

## 7. 제품 도입 시 체크리스트

- [ ] `THIRD_PARTY_NOTICES`에 flashraw(MIT/Apache), mediabunny(MPL-2.0) 고지 추가(PoC 초안: `poc/q03-imaging/THIRD_PARTY_NOTICES.md`)
- [ ] libraw-wasm 제거(권장) 또는 LGPL 준수 방식 법무 검토
- [ ] 사용하지 않는 flashraw WASM 변형(jxl/gpu/threads) 번들 제외 검토 (배포 크기 27.8MB → 대폭 감소)
- [ ] 고지 파일을 정적 배포물과 PWA 캐시에 포함
- [ ] 라이선스 원문을 npm 패키지가 아닌 업스트림 저장소와 대조
