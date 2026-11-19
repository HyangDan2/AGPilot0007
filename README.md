# Film Studio — HD2Lab

[![Build and Test](https://github.com/HyangDan2/AGPilot0007/actions/workflows/deploy.yml/badge.svg)](https://github.com/HyangDan2/AGPilot0007/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE_AUDIT.md)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-blue.svg)](https://hyangdan2.github.io/AGPilot0007/)

**Film Studio** is a browser-based photographic film colour simulation and development application published under the **HD2Lab** brand.

It provides nine original film profiles grounded in photographic sensitometry (Hurter–Driffield characteristic D-log H curves), spectral dye-coupling behaviour and editorial colour aesthetics. The core engine is WebGL2 and runs **100% locally in the browser with zero server uploads and no paid APIs**.

- **Production:** https://hyangdan2.github.io/AGPilot0007/
- **Beta channel:** https://hyangdan2.github.io/AGPilot0007/beta/

---

## The HD2Lab Film Collection

| Film ID | Display Name | Photographic Style | Technical Target |
|---|---|---|---|
| **FS-001** | **VÆRN** | Heritage Negative | Deep contrast, muted green shadows, distinctive red response |
| **FS-002** | **SKELD** | Editorial Chrome | Reduced saturation, restrained blue tones, documentary contrast |
| **FS-003** | **AURVEN** | Amber Memory | Warm highlights, preserved shadow depth, nostalgic colour |
| **FS-004** | **VESTRA** | True Print | Natural skin colour, balanced tonal response, realistic saturation |
| **FS-005** | **VEYRA** | Natural Balance | Neutral colour reproduction, smooth tonal transitions |
| **FS-006** | **SOLVIK** | Vivid Nature | Enhanced landscape colour, vivid greens and blues |
| **FS-007** | **LYSEN** | Soft Portrait | Gentle contrast, controlled skin colour, soft highlights |
| **FS-008** | **MYRVEL** | Cinema Dusk | Low saturation, cinematic shadows, smooth highlight rolloff |
| **FS-009** | **RIMVA** | Silver Monochrome | Panchromatic black-and-white, refined silver contrast and grain |

A neutral reference profile is offered for comparison, and the Filter Set adds **RETRO 90** (Night Amber) as a camera-inspired collection.

---

## Key features

- **Hardware-accelerated WebGL2 colour pipeline**: 3D volume LUT sampling (`TEXTURE_3D`), linear-space exposure and white balance, perceptual tone curves, and luminance-modulated silver-halide grain.
- **Pure static web architecture**: deployable to GitHub Pages, Cloudflare Pages or Netlify with no backend infrastructure.
- **Privacy by design**: photos are decoded and processed exclusively in device memory. No analytics, no tracking, no external network requests.
- **Real-time interactive viewport**: 60 fps slider adjustments with a split-screen before/after comparison and press-and-hold original preview.
- **Two-stage export and mobile share**: in-memory development followed by instant delivery through the Web Share API (save to iOS Photos or Android Google Photos), zero-re-render direct file download, and a full-resolution preview with long-press saving.
- **Offline PWA**: installable, with a service worker caching the application assets.
- **Local recipe library**: save, duplicate, rename, apply, export and import film looks in offline IndexedDB.

## Interface details

**Margarine Collection** — 58 original tonal looks across Light, Portrait, Nature, Cafe, Color and Vintage categories, available after FS-009. Select MARGARINE once to reapply the last look, then select it again to browse the collection. On mobile the adjustments open above the photo as a bottom sheet.

**Old School Film** — open FILTER SET to choose RETRO 90 / Night Amber. The shared camera button opens optional seven-segment dates, local EXIF date selection and a Film Set style choice. Glow, halation and softness remain exclusive to RETRO 90.

**Tone curves** — transparent centred W/R/G/B point curves over the photo, a channel and reset toolbar over the filter area, independent channel reset and reset all, numeric and keyboard editing, an RGB/luminance histogram visible while curves are active, and Whites/Blacks sliders. Camera settings open in a separate photo overlay. Version 7 recipes retain curves and camera settings while still reading older recipes.

**Colour Lab** — three tabs: **Spectrum** (eight-band Hue/Saturation/Luminance with colour, component and all views, targeted photo dragging), **Color Focus** (up to eight sampled colour ranges with adjustable range and feathering, preview-only range visualisation) and **RGB Base** (seven primary/shadows controls as an independent linear-RGB creative transform before tone and LUT processing — not a RAW camera profile or Adobe-compatible process engine; neutral values bypass it exactly). Global saturation stays separate. Version 7 recipes retain RGB Base and read versions 1–6. Desktop swatches sit inside the panel; mobile swatches sit above the curve.

**Sharpening** — Amount / Radius / Detail / Masking on desktop and mobile, with a preview-only edge mask and a true source-pixel detail crop. Version 7 recipes store the new settings while preserving older non-zero sharpening through a legacy path; the shared two-pass luminance engine runs only when sharpening is enabled.

**Workspace** — desktop Open offers Photo (one image) and Workspace (read-only folder browsing with an optional subfolder scan). A collapsible, resizable bottom explorer virtualises large photo lists and uses bounded worker thumbnails; the left Explorer shows the current edit. Workspace accepts JPEG, PNG and WebP, with RAW decoding planned separately. PC sidebars collapse independently into recoverable rails, and the folder explorer keeps a collapsed recovery bar rather than a destructive close button.

**Theme** — Light and Dark change UI surfaces only; photo pixels and exported colours never change. A single floating sun/moon button in the bottom-right corner switches theme (the header and menu toggles were removed so every HD2Lab surface uses one control). The choice is stored under the shared `hd2-theme` key and remembered locally across production and beta on the same origin.

---

## Technology stack

| Layer | Technology |
|---|---|
| **Frontend framework** | React 19 + TypeScript |
| **Bundler & build** | Vite 6 |
| **Styling** | Tailwind CSS v4 |
| **GPU image renderer** | WebGL2 / GLSL ES 3.00 |
| **Colour maths** | 33×33×33 3D LUT + linear matrix + monotone cubic spline |
| **State management** | Zustand 5 |
| **Local offline storage** | IndexedDB (`idb-keyval`) |
| **Unit testing** | Vitest 3 |
| **End-to-end testing** | Playwright |
| **CI / CD** | GitHub Actions + GitHub Pages |

---

## Getting started

### Prerequisites

- Node.js `v22+` and npm `v10+` (as used by CI)
- Python 3.11+ (only for regenerating the LUT profiles)

### Installation

```bash
git clone https://github.com/HyangDan2/AGPilot0007.git
cd AGPilot0007
npm install
```

### Development server

```bash
npm run dev          # http://localhost:5173
```

### Tests

```bash
npm test             # Vitest unit suite (tests/*.test.ts)
npm run test:e2e     # Playwright
```

### Static production build

```bash
npm run build
npm run preview
```

The output in `dist/` is completely static and ready for GitHub Pages.

### Regenerating the 3D LUT profiles

```bash
npm run generate-luts
```

---

## Beta channel

The `beta` branch stages new features independently of `main`. Use `npm run dev:beta`, `npm run build:beta` or `npm run preview:beta` for `/AGPilot0007/beta/`; beta output goes to `dist-beta/` while normal output stays in `dist/`. GitHub Actions on `beta` selects the beta target automatically.

The beta workflow publishes `https://hyangdan2.github.io/AGPilot0007/beta/` by combining the approved production artifact with the beta build. Production application files are unchanged; only its service worker receives a beta navigation exclusion, a migration handler and nested-scope cache protection. Approved production snapshots are retained for 90 days so beta deployment can continue after the short-lived Pages artifact expires, and main deployments keep the latest successful beta build. Main merges require user approval.

---

## Documentation

- [Development & verification harness](docs/HARNESS_GUIDE.md)
- [Colour engine technical architecture](docs/COLOR_ENGINE.md)
- [Film profiles & sensitometric dossier](docs/FILM_PROFILES.md)
- [Quality gate validation & device limits](docs/VALIDATION.md)
- [Open-source licence audit](LICENSE_AUDIT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Licence

Published by **HD2Lab**, released under the permissive **MIT License**. See [LICENSE_AUDIT.md](LICENSE_AUDIT.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full compliance details.
