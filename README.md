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
