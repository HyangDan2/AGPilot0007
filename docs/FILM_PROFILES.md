# HD2Lab Film Profiles Specification & Research Dossier

Product: **Film Studio**  
Publisher: **HD2Lab**  
Version: **1.0.0**  
Color Pipeline Domain: **Standard sRGB (IEC 61966-2-1) / 33×33×33 3D LUT**

---

## 1. Overview & Research Methodology

The HD2Lab Film Color Engine implements nine original photographic film profiles. Each profile represents a distinct sensitometric character, grounded in published photographic sensitometry (Hurter-Driffield characteristic D-log H curves), spectral dye coupling behavior, and editorial color aesthetics.

None of the profiles are proprietary manufacturer assets or simple CSS filter overlays. Every look is defined as a calibrated 33×33×33 3D volume LUT with explicit half-texel offset sampling, tone curves, and spatial grain characteristics.

---

## 2. The Nine HD2Lab Film Profiles

### FS-001 — VÆRN (Heritage Negative)
* **Aesthetic**: Classic heritage color negative film with rich tonal depth.
* **Technical Target**: Deep contrast, muted green shadows, distinctive saturated red response.
* **Sensitometric Curve**: Steepened shadow toe (slope factor 1.35) with progressive highlight shoulder rolloff.
* **Color Transformation**:
  - Warm red gamut enhancement: Red wavelengths (0–30° and 330–360°) receive +25% saturation boost and subtle highlight lift.
  - Muted green shadows: Foliage greens (70–160°) in shadows (< 0.40 luminance) are attenuated by up to 45% and shifted toward olive/cyan, reflecting traditional orange-mask dye coupling.
  - Base tone: Subtle warm highlight bias (+2.5% red in specular tones), cyan-shadow counterbalance.
* **Default Grain**: 15% (medium-fine silver halide grain).

---

### FS-002 — SKELD (Editorial Chrome)
* **Aesthetic**: Modern Scandinavian photojournalism and editorial slide emulsion.
* **Technical Target**: Reduced saturation, restrained blue tones, documentary contrast.
* **Sensitometric Curve**: Crisp documentary gamma curve (slope factor 1.28) with sharp black retention and clean whites.
* **Color Transformation**:
  - Global chroma scaling: Restrained to 78% baseline for neutral, non-distracting documentary color.
  - Restrained atmospheric blues: Sky and cyan tones (180–260°) undergo 35% chroma suppression and a subtle slate hue rotation (-8° toward 205°).
  - Cool slate bias in low-midtones.
* **Default Grain**: 10% (fine grain chrome structure).

---

### FS-003 — AURVEN (Amber Memory)
* **Aesthetic**: Warm golden nostalgia with rich emotional resonance.
* **Technical Target**: Warm highlights, preserved shadow depth, nostalgic color.
* **Sensitometric Curve**: Lifted shadow toe (+0.035 black lift), preserving shadow detail with gentle rolloff.
* **Color Transformation**:
  - Amber highlight bias: Chromatic shift in luminance range > 0.30, injecting warm amber (+5.5% red, +3.2% green, -4.0% blue).
  - Nostalgic orange/yellow accentuation: Selective saturation boost (+20%) in 20–60° hue band.
* **Default Grain**: 18% (warm organic grain).

---

### FS-004 — VESTRA (True Print)
* **Aesthetic**: Balanced photographic C-print on archival photographic paper.
* **Technical Target**: Natural skin color, balanced tonal response, realistic saturation.
* **Sensitometric Curve**: Well-behaved optical print S-curve (slope factor 1.18).
* **Color Transformation**:
  - Skin tone preservation: Orange/peach tones (25–45°) are held in realistic chromatic balance (+8% micro-saturation, zero color shift).
  - Linear midtone fidelity: True-to-life greens and blues without artificial neon hyper-saturation.
* **Default Grain**: 12% (fine print grain).

---

### FS-005 — VEYRA (Natural Balance)
* **Aesthetic**: Neutral color fidelity with extended dynamic range rolloff.
* **Technical Target**: Neutral color reproduction, smooth tonal transitions.
* **Sensitometric Curve**: Linear response through shadow and midtone, transitioning to an asymptotic soft-knee shoulder in upper highlights (> 0.75) to prevent harsh digital clipping.
* **Color Transformation**:
  - Pure neutral chromatic axis: Zero color cast across the grayscale step wedge.
  - High-fidelity gamut mapping.
* **Default Grain**: 8% (subtle texture).

---

### FS-006 — SOLVIK (Vivid Nature)
* **Aesthetic**: Punchy landscape reversal (slide) film.
* **Technical Target**: Enhanced landscape color, vivid greens and blues.
* **Sensitometric Curve**: High dynamic contrast S-curve (slope factor 1.30) with rich D-max blacks.
* **Color Transformation**:
  - Landscape foliage enhancement: Greens (80–150°) boosted by +35% chroma and shifted +7° toward deep emerald.
  - Atmospheric sky enhancement: Blues (190–240°) boosted by +30% chroma and deepened +5° toward azure.
* **Default Grain**: 14% (slide film micro-structure).

---

### FS-007 — LYSEN (Soft Portrait)
* **Aesthetic**: Gentle studio portrait emulsion with flattering highlight roll-off.
* **Technical Target**: Gentle contrast, controlled skin color, soft highlights.
* **Sensitometric Curve**: Soft portrait curve (slope factor 0.95), lifted blacks (+0.04), and smooth highlight compression.
* **Color Transformation**:
  - Skin blemish attenuation: Harsh magenta/red blotches (340–20°) desaturated by 15% and softened into harmonious peach.
  - Luminous midtone warmth: Gentle golden glow in upper midtones.
* **Default Grain**: 10% (ultra-fine portrait grain).

---

### FS-008 — MYRVEL (Cinema Dusk)
* **Aesthetic**: Modern motion picture stock with twilight atmosphere.
* **Technical Target**: Low saturation, cinematic shadows, smooth highlight rolloff.
* **Sensitometric Curve**: Cinematic S-curve with deep toe and compressed highlight rolloff.
* **Color Transformation**:
  - Cinematic split-toning: Deep cyan-teal infused into shadows (< 0.45 luminance), rich dusk amber infused into highlights (> 0.50).
  - Restrained global saturation (84%).
* **Default Grain**: 16% (motion picture 35mm grain).

---

### FS-009 — RIMVA (Silver Monochrome)
* **Aesthetic**: Classic silver gelatin black-and-white print.
* **Technical Target**: Panchromatic spectral conversion, refined contrast and grain.
* **Sensitometric Curve**: Deep silver halide D-max black expansion with luminous midtones (slope factor 1.32).
* **Color Transformation**:
  - Panchromatic spectral weighting:
    $$\text{Luminance } Y = 0.28 R + 0.58 G + 0.14 B$$
  - Pure monochrome axis: $R = G = B = Y$ with zero chromatic aberration.
* **Default Grain**: 24% (crisp silver halide grain structure).

---

## 3. Comparison Matrix

Visual comparisons across calibration charts, skin tones, and landscape gamut can be reviewed in:
- `docs/comparisons/quality_gate_trio.png`
- `docs/comparisons/color_chart_matrix.png`
- `docs/comparisons/landscape_matrix.png`
