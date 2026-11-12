# Film Studio — HD2Lab

[![Build and Test](https://github.com/HyangDan2/AGPilot0007/actions/workflows/deploy.yml/badge.svg)](https://github.com/HyangDan2/AGPilot0007/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE_AUDIT.md)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-blue.svg)](dist/manifest.webmanifest)

**Film Studio** is a browser-based photographic film color simulation and development application published under the **HD2Lab** brand. 

It provides nine original film profiles technically grounded in photographic sensitometry (Hurter-Driffield characteristic D-log H curves), spectral dye coupling behavior, and editorial color aesthetics. The core engine is built with hardware-accelerated **WebGL2** and operates **100% locally in the browser with zero server uploads or paid APIs**.

---

## The HD2Lab Film Collection

| Film ID | Display Name | Photographic Style | Technical Target |
|---|---|---|---|
| **FS-001** | **VÆRN** | Heritage Negative | Deep contrast, muted green shadows, distinctive red response |
| **FS-002** | **SKELD** | Editorial Chrome | Reduced saturation, restrained blue tones, documentary contrast |
| **FS-003** | **AURVEN** | Amber Memory | Warm highlights, preserved shadow depth, nostalgic color |
| **FS-004** | **VESTRA** | True Print | Natural skin color, balanced tonal response, realistic saturation |
| **FS-005** | **VEYRA** | Natural Balance | Neutral color reproduction, smooth tonal transitions |
| **FS-006** | **SOLVIK** | Vivid Nature | Enhanced landscape color, vivid greens and blues |
| **FS-007** | **LYSEN** | Soft Portrait | Gentle contrast, controlled skin color, soft highlights |
| **FS-008** | **MYRVEL** | Cinema Dusk | Low saturation, cinematic shadows, smooth highlight rolloff |
| **FS-009** | **RIMVA** | Silver Monochrome | Panchromatic black-and-white, refined silver contrast and grain |

---

## Key Features

- **Hardware-Accelerated WebGL2 Color Pipeline**: 3D volume LUT sampling (`TEXTURE_3D`), linear-space exposure & white balance, perceptual tone curves, and luminance-modulated silver halide grain.
- **Pure Static Web Architecture**: Fully functional static web app deployable to GitHub Pages, Cloudflare Pages, or Netlify with zero backend infrastructure.
- **Privacy & Security by Design**: Photos are decoded and processed exclusively in device memory. Zero analytics, zero tracking, zero external network requests.
- **Real-Time Interactive Viewport**: Buttery 60fps slider adjustments with split-screen before/after comparison and press-and-hold original preview.
- **Margarine Collection**: 58 original tonal looks, available after FS-009. Select MARGARINE once to apply the last look, then select it again to browse the collection. Mobile adjustments open above the photo as a bottom sheet.
- **Old School Film**: Open FILTER SET to choose RETRO 90 / Night Amber. The shared camera button opens optional seven-segment dates, local EXIF date selection and Film Set style selection. Glow, halation and softness remain exclusive to RETRO 90.
- **Tone Curves (beta)**: Transparent centered W/R/G/B point curves over the photo, a channel/reset toolbar over the filter area, independent channel reset and reset all, numeric/keyboard editing, RGB/luminance histogram visible while curves are active, and Whites/Blacks sliders. Camera settings open in a separate photo overlay. Version 6 recipes retain curves and camera settings while reading older recipes.
- **Color Lab (beta)**: Eight-color Hue/Saturation/Luminance controls with color/component/all views, targeted photo dragging, up to eight Color Focus selections with adjustable ranges and feathering, and preview-only range visualization. Global Saturation remains separate.
- **Custom Recipe Management**: Save, duplicate, rename, apply, and export/import custom film looks via offline **IndexedDB**.
- **Two-Stage Native Photo Export & Mobile Share**: Stage A in-memory development followed by Stage B instant delivery via **Web Share API** (save to iOS Apple Photos & Android Google Photos), zero-re-render direct file download, and full-resolution image preview with long-press saving.
- **Offline PWA Support**: Installable Progressive Web Application with service worker asset caching.

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | React 19 + TypeScript |
| **Bundler & Build** | Vite 6 |
| **Styling** | Tailwind CSS v4 |
| **GPU Image Renderer** | WebGL2 / GLSL ES 3.00 |
| **Color Math** | 33×33×33 3D LUT + Linear Matrix + Monotone Cubic Spline |
| **State Management** | Zustand 5 |
| **Local Offline Storage**| IndexedDB (`idb-keyval`) |
| **Unit Testing** | Vitest 3 |
| **End-to-End Testing** | Playwright |
| **CI / CD Deployment** | GitHub Actions + GitHub Pages |

---

## Getting Started

### Prerequisites

- Node.js `v20+` or `v22+`
- npm `v10+`
- Python 3.10+ (for optional LUT regeneration tooling)

### Installation

```bash
git clone https://github.com/HyangDan2/AGPilot0007.git
cd AGPilot0007
npm install
```

### Development Server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Automated Test Suite

```bash
# Run unit tests (Vitest)
npm test

# Run E2E tests (Playwright)
npm run test:e2e
```

### Static Production Build

```bash
npm run build
npm run preview
```

The output in `dist/` is completely static and ready for direct deployment to GitHub Pages.

### Regenerating 3D LUT Profiles

```bash
npm run generate-luts
```

---

## Documentation

- [Development & Verification Harness](docs/HARNESS_GUIDE.md)
- [Color Engine Technical Architecture](docs/COLOR_ENGINE.md)
- [Film Profiles & Sensitometric Dossier](docs/FILM_PROFILES.md)
- [Quality Gate Validation & Device Limits](docs/VALIDATION.md)
- [Open Source License Audit](LICENSE_AUDIT.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)

---

## License

Published by **HD2Lab**. Released under the permissive **MIT License**.  
See [LICENSE_AUDIT.md](LICENSE_AUDIT.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full compliance details.

## Beta development

The `beta` branch stages new features independently of `main`. Run `npm run dev:beta`, `npm run build:beta`, or `npm run preview:beta` for `/AGPilot0007/beta/`. Beta output is written to `dist-beta/`; normal output remains in `dist/`. GitHub Actions on `beta` also selects the beta target automatically.

The beta workflow publishes `https://hyangdan2.github.io/AGPilot0007/beta/` by combining the approved production deployment artifact with the beta build. Production application files remain unchanged; only its service worker receives a beta navigation exclusion, migration handler, and nested-scope cache protection. Approved production snapshots are retained for 90 days so beta deployment can continue after the short-lived Pages artifact expires. Main deployments also retain the latest successful beta build. Main merges require user approval.

Color Lab tabs are **Spectrum** (eight-band HSL), **Color Focus** (sampled color ranges), and **RGB Base** (seven primary/shadows controls). RGB Base is an independent linear-RGB creative transform before tone/LUT processing, not a RAW camera profile or Adobe-compatible process engine. Neutral values bypass it exactly. Version 6 recipes retain it and read versions 1–5.
