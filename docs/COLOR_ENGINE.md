# HD2Lab Film Color Engine Architecture

Technical Architecture & Color Pipeline Specification  
Document Version: 1.0.0

---

## 1. Color Pipeline Architecture

The HD2Lab Film Color Engine operates locally in the user's web browser using hardware-accelerated **WebGL2** shaders. No remote API or cloud servers are involved.

```
+------------------------------------------------------------------------+
| 1. Image Decode & Normalization (sRGB IEC 61966-2-1 Contract)          |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 2. sRGB Gamma to Linear RGB Transfer Function                          |
|    C_lin = (C <= 0.04045) ? C / 12.92 : ((C + 0.055) / 1.055)^2.4     |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 3. Physical Linear Adjustments                                         |
|    - Exposure (C_lin * 2.0^EV)                                         |
|    - White Balance (Temperature / Tint chromatic adaptation)           |
|    - Shadow & Highlight recovery (luminance-masked linear scaling)     |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 4. Linear to sRGB Gamma Conversion                                     |
|    C_srgb = (C <= 0.0031308) ? C * 12.92 : 1.055 * C^(1/2.4) - 0.055   |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 5. Contrast Adjustment (perceptual middle-gray expansion)              |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 6. Hardware-Accelerated 3D Volume LUT Sampling (WebGL2 TEXTURE_3D)     |
|    Coord = (clamp(color, 0, 1) * (Size - 1.0) + 0.5) / Size            |
|    Trilinear interpolation across 33x33x33 lattice nodes               |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 7. Film Strength Blending                                              |
|    Final = mix(BeforeLut, AfterLut, FilmStrength)                      |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 8. Global Saturation (Rec.709 Luminance Preservation)                  |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 9. Spatial Effects                                                     |
|    - Unsharp mask (Laplacian kernel high-pass sharpness)               |
|    - Luminance-modulated silver halide film grain                      |
|    - Radial vignette falloff                                           |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 10. Display / Export Presentation (Canvas Blob / JPEG / PNG)           |
+------------------------------------------------------------------------+
```

---

## 2. 3D LUT Specifications

* **Grid Size**: $33 \times 33 \times 33$ nodes (35,937 color nodes).
* **Index Order**: Red fastest, Green second, Blue slowest (compatible with standard Adobe / DaVinci Resolve `.cube`).
* **Input / Output Domain**: `0.0 0.0 0.0` to `1.0 1.0 1.0` in display-referred standard sRGB.
* **Sampling Contract**: In GLSL, coordinates are computed with a **half-texel offset**:
  $$\text{coord} = \frac{\mathbf{C} \cdot (N - 1) + 0.5}{N}$$
  This prevents boundary clamp distortions and ensures exact alignment with node centers.

---

## 3. Spatial Effects Implementation

### Film Grain
Silver halide film grain is not uniform digital noise. Physical grain is chemically most visible in the midtone densities, tapering off in deep unexposed shadows and dense highlight burns.
The GLSL shader modulates high-frequency pseudo-random noise by a parabolic luminance mask:
$$\text{grainMask} = 4.0 \cdot Y \cdot (1.0 - Y)$$
where $Y$ is the perceptual luminance.

### Sharpness
Sharpness applies a 3×3 Laplacian high-pass convolution kernel:
$$\Delta = \frac{C_{\text{north}} + C_{\text{south}} + C_{\text{west}} + C_{\text{east}}}{4} - C_{\text{center}}$$
The high-frequency edge delta is scaled and added back to the base signal.

### Vignette
Optical lens falloff is computed using aspect-ratio corrected Euclidean distance from center, shaped with a smooth Hermite interpolation (`smoothstep`).

## Beta camera effects and date compositing

RETRO 90 adds an original 33-cube transform without changing the nine individual film profiles. Optional optical effects run after film color grading and before grain/vignette; four or eight neighboring samples are accumulated and graded as a bounded single-pass approximation. All optical intensities at zero preserve the existing shader path.

Date imprint geometry is authored in `src/engine/overlay/dateStamp.ts` without external fonts. An image-relative patch is uploaded only when date settings or output dimensions change and composited after film effects in the common WebGL renderer. Preview and export share this implementation. Original comparison bypasses the date; Split composites only on the developed side. A full-resolution export regenerates the patch at the requested dimensions, rather than upscaling a preview stamp.

Camera effects are profile capabilities declared on `FilmProfile.cameraEffects`. The shared `getEffectiveCamera` boundary permits date imprint for known profiles and masks optical effects absent from each profile capability list. Unspecified film IDs mask all camera effects. Viewport and exporter pass the active film ID into the common renderer. FS-010 alone enables glow/halation/softness; switching profiles retains settings while dates remain shared.


## User tone curves (beta)

The shared renderer accepts optional W/R/G/B `ToneCurves`. Each channel has 2–16 normalized control points with movable x/y endpoints and strictly increasing inputs. The MIT-noticed monotone cubic interpolation implementation generates a 1024×1 RGBA32F texture (W/R/G/B in RGBA); texelFetch with explicit interpolation avoids requiring float texture filtering extensions. White maps each RGB component first, followed by its individual color curve. Identity curves bypass sampling entirely. The texture is cached by points and recreated after context restoration.

Black/white endpoint adjustments precede the film LUT and are zero by default. User curves follow the LUT/film-strength mix, preceding saturation and spatial effects. Preview and export pass identical curves through the same shader; Original bypasses all edits and Split applies them only to the developed side. Date imprint remains the final image composite.

The histogram is a UI-only 64-bin luminance/R/G/B distribution sampled from the current preview at up to 192×192 and about 8 updates per second. It includes the currently displayed comparison mode and date imprint, excludes editor overlays, and uses a shared vertical scale with square-root display compression. It is neither a RAW histogram nor an export layer.

Recipe schema 4 supports movable endpoints, adds curves and retains older camera settings. Older recipes default to identity curves and zero endpoints. One pointer drag produces one undo entry, while channel/global resets remain independently undoable. THIRD_PARTY_NOTICES.txt is emitted from the canonical notices document in every build.


## Color Lab: Spectrum / Color Focus (beta)

Eight circular hue bands and up to eight Color Focus selections share a fixed pre-mixer reference in the existing single-pass renderer. Hue shifts use smooth neighboring weights, Color Focus masks combine circular hue distance with saturation/lightness distance and feathering, and overlapping point shifts are normalized. Low chroma attenuates changes. Bounded HSL lightness adjustment provides selective brightness without moving neutral pixels. This is an original algorithm, not an Adobe numeric match.

Spectrum/Color Focus follow curves and precede the existing Global Saturation stage. Neutral or disabled settings bypass the entire transform. Preview-only reference/range modes return before spatial effects/date compositing; exports never enable them. Reference sampling draws the pre-mixer frame, reads only a bounded3×3 region at inverse-transformed canvas coordinates, and restores the normal frame in finally. No image uploads, per-frame full-size readbacks, extra whole-image buffers or new LUT assets are added.

Recipe schema 6 retains colorMixer, including RGB Base; legacy 1–5 recipes retain their existing settings and default missing fields to neutral. Transient sampling/range UI is not serialized. Single-gesture history commits on release, cancel or exit. Uniform packets are reuploaded after context recovery through the shared render options.


### RGB Base (Color Lab)

Before tone/LUT processing, after linear exposure and white balance, RGB Base rotates the RGB basis vectors around the neutral axis (maximum ±30°) and scales their chroma (0.5–1.5). Row-sum and weighted column correction preserve neutral RGB and luminance. Negative-channel gamut excursions are compressed toward luminance; positive HDR values remain available to subsequent tone processing. Shadows Tint uses a smooth linear-luminance mask from 0 to 0.25 and a near-luminance-neutral green/magenta offset proportional to luminance. Black stays black. Neutral/disabled settings bypass all math exactly. The matrix is built once per render call and uploaded as a mat3; no extra pass or image buffer is allocated.

This is an independent creative transform of decoded RGB images, not a RAW calibration profile or a reproduction of Adobe processing. Recipe schema 6 stores settings under colorMixer.rgbBase; schemas 1–5 with absent settings migrate to neutral values. Spectrum/Color Focus processing order remains unchanged.
