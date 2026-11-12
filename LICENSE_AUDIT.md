# LICENSE AUDIT — HD2Lab Film Studio (AGPilot0007)

Document Version: 1.0.0  
Audit Date: 2026-11-09  
Auditor: HD2Lab Quality & Legal Compliance  
Project: Film Studio (AGPilot0007)  
Target: Static Web Application (Commercial Permissive / GitHub Pages)

---

## 1. Executive Summary & Policy

Film Studio is an in-browser film color simulation and photo development application published under the **HD2Lab** brand.
The project policy strictly mandates:
1. Only permissively licensed open-source algorithms, specifications, and libraries (MIT, Apache-2.0, BSD-2/3-Clause, ISC) are permitted for bundling or direct distribution.
2. Viral copyleft licenses (GPL, AGPL, LGPL) are **strictly excluded** from runtime bundles. Specifically, LGPL/GPL HEIC decoders are excluded.
3. Proprietary closed-source camera simulation profiles (e.g. Adobe camera-matching RAF profiles, proprietary camera LUTs) are **strictly forbidden** from being bundled or presented as official camera assets.
4. All film profiles are original HD2Lab formulations (FS-001 through FS-009) technically grounded in published sensitometry, photographic color science, and open reference data.

---

## 2. Upstream Repositories Audited

| Repository | Remote URL | Commit / Tag | Declared License | Audit Outcome & Usage Gate |
|---|---|---|---|---|
| **Source A: Fuji-Recipe-Converter** | `https://github.com/sadziu/Fuji-Recipe-Converter` | `a6691ea0e880ddd5fd19d7ca2d48a502fb0e7e07` | MIT License | **APPROVED (Selective)**<br>• Permitted: Spline interpolation algorithm (Fritsch-Carlson), `.cube` format writer specification.<br>• **REJECTED / EXCLUDED**: `vendor/heic/` (LGPL-3.0 / GPL-3.0) and `vendor/tesseract/` (Apache-2.0 OCR) are completely omitted. |
| **Source B: EmulsionPresets** | `https://github.com/peva3/EmulsionPresets` | `0cdb71c60603867a046bc92c63617feec7894dd1` | MIT License | **APPROVED (Reference)**<br>• Permitted: Tonal curves, color grading hue/saturation data, grain characteristics, and sensitometric research notes.<br>• Restriction: No direct bundling of Adobe Camera Raw proprietary profile references. Only mathematical parameters and original LUT profiles derived from them are used. |
| **Source C: spectral_film_lut** | `https://github.com/JanLohse/spectral_film_lut` | `a15043f6fe2d365d0c359d22e0868076800916d9` | MIT License | **APPROVED (Methodology & Math)**<br>• Permitted: Color space transformation models (sRGB <-> Linear <-> XYZ), film D-log H characteristic curve modeling, 3D LUT generation formulas.<br>• Verification: All color math validated for standard sRGB working color space. |

---

## 3. Detailed Component Assessment

### 3.1 Fuji-Recipe-Converter
* **Author / Copyright**: Copyright (c) 2026 Sadziu and contributors
* **License**: MIT
* **Audit Details**:
  - Main codebase consists of vanilla JavaScript parsing and LUT calculation routines.
  - Subdirectory `vendor/heic/` contains `heic-to.js` licensed under LGPL-3.0 / GPL-3.0. In accordance with Section 3 and Section 9 of the Work Order, HEIC decoding is deferred and `vendor/heic/` is **100% excluded** from the Film Studio runtime.
  - Subdirectory `vendor/tesseract/` contains Tesseract.js (Apache-2.0) and binary trained models. These are unnecessary for photographic rendering and are **excluded**.
  - Reused algorithms: Monotone cubic spline (Fritsch-Carlson) implemented natively in clean TypeScript in `src/engine/color/toneCurve.ts`, and `.cube` format serialization in `src/engine/color/lutLoader.ts` and `tools/lut-generation/`.

### 3.2 EmulsionPresets
* **Author / Copyright**: Copyright (c) 2026 peva3
* **License**: MIT
* **Audit Details**:
  - Contains research dossiers (`research/*/characteristics.md`) and Adobe XMP presets analyzing physical film stocks.
  - XMP presets contain parametric tonal adjustments, split toning (ColorGrade highlight/shadow/midtone hue & saturation), channel mixer values, and grain specifications.
  - Integration: Extracted numerical parameters for tonal response, color grading, and selective saturation to parameterize the nine HD2Lab profiles. No proprietary Adobe profiles or camera manufacturer assets are included.

### 3.3 spectral_film_lut
* **Author / Copyright**: Copyright (c) 2026 Jan Lohse
* **License**: MIT
* **Audit Details**:
  - Python application implementing film sensitometry (characteristic curves, dye density, chemical development simulation) and `.cube` generation.
  - Mathematical models for toe/shoulder film response and trilinear interpolation verified and implemented in HD2Lab's Python LUT generation toolkit (`tools/lut-generation/generate_luts.py`) and WebGL2 GLSL shaders.
  - Dependencies used in dev-time tooling (NumPy, Scipy) are development-only and not bundled into the client web application.

---

## 4. Runtime Dependency Whitelist (Production App)

| Package | Version | License | Justification |
|---|---|---|---|
| `react` | `^19.0.0` | MIT | Core UI framework |
| `react-dom` | `^19.0.0` | MIT | DOM rendering |
| `zustand` | `^5.0.0` | MIT | Lightweight client-side reactive state management |
| `exifr` | `7.1.3` | MIT | Local DateTimeOriginal parsing; no external upload |
| `idb-keyval` | `^6.2.1` | Apache-2.0 | Minimalist IndexedDB key-value store for custom recipes |
| `lucide-react` | `^1.x` | ISC | Permissive icon library for camera & tool controls |
| `clsx` / `tailwind-merge` | `^2.x` | MIT | Utility class composition |

No non-permissive or viral licenses are present in `package.json`.

---

## 5. Distribution Approval

The technical architecture and color generation pipelines have been reviewed against commercial redistribution requirements. The 9 HD2Lab film profiles and the WebGL2 rendering engine are **APPROVED** for public release under permissive terms.
