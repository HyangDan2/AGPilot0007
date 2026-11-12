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
