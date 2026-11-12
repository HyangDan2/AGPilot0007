#!/usr/bin/env python3
"""
HD2Lab Film Color Engine — 3D LUT Generator
Generates technically grounded 33x33x33 .cube 3D LUT profiles for HD2Lab Film Studio.

Profiles generated:
  - identity.cube: Baseline verification identity LUT
  - FS-001 VÆRN (Heritage Negative)
  - FS-002 SKELD (Editorial Chrome)
  - FS-003 AURVEN (Amber Memory)
  - FS-004 VESTRA (True Print)
  - FS-005 VEYRA (Natural Balance)
  - FS-006 SOLVIK (Vivid Nature)
  - FS-007 LYSEN (Soft Portrait)
  - FS-008 MYRVEL (Cinema Dusk)
  - FS-009 RIMVA (Silver Monochrome)
  - FS-010 RETRO 90 (Night Amber; Filter Set collection)
"""

import os
import math
import numpy as np

# IEC 61966-2-1 standard sRGB transfer functions
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1.0 / 2.4)) - 0.055)

def rgb_to_hsl(rgb):
    """Vectorized RGB [0,1] to HSL [H 0..360, S 0..1, L 0..1]"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    l = (maxc + minc) / 2.0
    delta = maxc - minc

    s = np.zeros_like(l)
    mask = delta > 1e-6
    s[mask] = np.where(l[mask] <= 0.5, delta[mask] / (maxc[mask] + minc[mask] + 1e-7), delta[mask] / (2.0 - maxc[mask] - minc[mask] + 1e-7))

    h = np.zeros_like(l)
    mask_r = mask & (maxc == r)
    mask_g = mask & (maxc == g) & ~mask_r
    mask_b = mask & (maxc == b) & ~mask_r & ~mask_g

    h[mask_r] = ((g[mask_r] - b[mask_r]) / delta[mask_r]) % 6.0
    h[mask_g] = ((b[mask_g] - r[mask_g]) / delta[mask_g]) + 2.0
    h[mask_b] = ((r[mask_b] - g[mask_b]) / delta[mask_b]) + 4.0
    h = h * 60.0
    h[h < 0.0] += 360.0
    return np.stack([h, s, l], axis=-1)

def hsl_to_rgb(hsl):
    """Vectorized HSL to RGB [0,1]"""
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]
    c = (1.0 - np.abs(2.0 * l - 1.0)) * s
    hp = h / 60.0
    x = c * (1.0 - np.abs((hp % 2.0) - 1.0))
    m = l - c / 2.0

    z = np.zeros_like(h)
    rgb = np.zeros(h.shape + (3,), dtype=np.float64)

    conds = [
        (hp >= 0) & (hp < 1),
        (hp >= 1) & (hp < 2),
        (hp >= 2) & (hp < 3),
        (hp >= 3) & (hp < 4),
        (hp >= 4) & (hp < 5),
        (hp >= 5) & (hp < 6),
    ]
    choices = [
        np.stack([c, x, z], axis=-1),
        np.stack([x, c, z], axis=-1),
        np.stack([z, c, x], axis=-1),
        np.stack([z, x, c], axis=-1),
        np.stack([x, z, c], axis=-1),
        np.stack([c, z, x], axis=-1),
    ]
    for cond, choice in zip(conds, choices):
        rgb[cond] = choice[cond]

    rgb += m[..., np.newaxis]
    return np.clip(rgb, 0.0, 1.0)

def apply_tone_curve(x, shadow_lift=0.0, toe_slope=1.0, shoulder_slope=1.0, contrast=1.0):
    """
    Applies a parameterized film sensitometry S-curve.
    Based on Hurter-Driffield (D-log H) characteristic response:
    - Shadow toe
    - Linear midtone
    - Highlight shoulder rolloff
    """
    # Normalized sigmoid tone response centered at midtone (0.45 in gamma sRGB)
    centered = x - 0.45
    # S-curve power
    k = contrast * 2.2
    curved = 1.0 / (1.0 + np.exp(-k * centered * 3.5))
    # Normalize to [0, 1] range
    c0 = 1.0 / (1.0 + np.exp(-k * (-0.45) * 3.5))
    c1 = 1.0 / (1.0 + np.exp(-k * (0.55) * 3.5))
    norm_curved = (curved - c0) / (c1 - c0)
    
    # Blend with original for subtle tone preservation
    res = np.where(x < 0.45, 
                   x * toe_slope + (norm_curved - x) * (1.0 - x / 0.45),
                   x * shoulder_slope + (norm_curved - x) * ((x - 0.45) / 0.55))
    
    # Lift shadows / compress blacks
    res = shadow_lift + (1.0 - shadow_lift) * res
    return np.clip(res, 0.0, 1.0)

def generate_base_lattice(size=33):
    """Generates 3D grid in sRGB domain [0,1]^3, red fastest, then green, then blue."""
    vals = np.linspace(0.0, 1.0, size, dtype=np.float64)
    # B, G, R grid
    b, g, r = np.meshgrid(vals, vals, vals, indexing='ij')
    # Flatten with R fastest, G second, B slowest
    rgb = np.stack([r, g, b], axis=-1).reshape(-1, 3)
    return rgb, size

# --- Profile Transform Implementations ---

def transform_identity(rgb):
    return rgb.copy()

def transform_vaern(rgb):
    """FS-001 VÆRN — Heritage Negative: Deep contrast, muted green shadows, distinctive red response"""
    # 1. Tonal curve: deep contrast, lifted deep toe, smooth highlight rolloff
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Contrast S-curve in luminance
    l_curved = np.where(l < 0.5, 
                        0.5 * (2.0 * l) ** 1.35, 
                        1.0 - 0.5 * (2.0 * (1.0 - l)) ** 1.25)
    
    # Distinctive red response: warmer reds (0-30 deg and 330-360 deg) enhanced saturation and luminosity
    red_dist = np.minimum(h, 360.0 - h)
    red_weight = np.clip(1.0 - red_dist / 40.0, 0.0, 1.0) ** 1.5
    s_mod = s * (1.0 + 0.25 * red_weight)
    
    # Muted green shadows: shadows with green hue (70-160 deg) are desaturated and shifted toward olive/cyan
    green_dist = np.abs(h - 115.0)
    green_weight = np.clip(1.0 - green_dist / 45.0, 0.0, 1.0)
    shadow_weight = np.clip(1.0 - l / 0.4, 0.0, 1.0)
    s_mod = s_mod * (1.0 - 0.45 * green_weight * shadow_weight)
    
    hsl_out = np.stack([h, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)
    
    # Subtle warm highlight bias, cool shadow tone (characteristic of heritage negative base mask)
    rgb_out[..., 0] += 0.025 * (rgb_out[..., 0] ** 2.0)  # red in highlights
    rgb_out[..., 1] -= 0.015 * ((1.0 - rgb_out[..., 1]) ** 2.0) # green attenuation in shadows
    rgb_out[..., 2] += 0.010 * ((1.0 - rgb_out[..., 2]) ** 2.0) # subtle blue lift in shadows
    return np.clip(rgb_out, 0.0, 1.0)

def transform_skeld(rgb):
    """FS-002 SKELD — Editorial Chrome: Reduced saturation, restrained blue tones, documentary contrast"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Crisp documentary contrast with tight black clipping and crisp whites
    l_curved = np.where(l < 0.5, 
                        0.5 * (2.0 * l) ** 1.28, 
                        1.0 - 0.5 * (2.0 * (1.0 - l)) ** 1.28)

    # General saturation reduction for editorial neutrality (0.78)
    s_mod = s * 0.78

    # Restrained blue tones (sky/cyan/blue 180-260 deg): strongly restrained saturation and slate shift
    blue_dist = np.abs(h - 215.0)
    blue_weight = np.clip(1.0 - blue_dist / 50.0, 0.0, 1.0)
    s_mod = s_mod * (1.0 - 0.35 * blue_weight)

    # Shift sky hue slightly toward neutral slate (215 -> 205)
    h_mod = np.where(blue_weight > 0.0, h - 8.0 * blue_weight, h)
    h_mod = (h_mod + 360.0) % 360.0

    hsl_out = np.stack([h_mod, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)

    # Cool slate documentary bias in shadow/midtone
    rgb_out[..., 2] = np.clip(rgb_out[..., 2] * 1.02, 0.0, 1.0)
    rgb_out[..., 0] = np.clip(rgb_out[..., 0] * 0.985, 0.0, 1.0)
    return rgb_out

def transform_aurven(rgb):
    """FS-003 AURVEN — Amber Memory: Warm highlights, preserved shadow depth, nostalgic color"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Lifted shadows (+0.035 black lift), soft highlight rolloff
    l_curved = 0.035 + 0.965 * (np.where(l < 0.5, 0.5 * (2.0 * l) ** 1.15, 1.0 - 0.5 * (2.0 * (1.0 - l)) ** 1.15))

    # Amber/golden warm highlights: warm color cast that peaks in high-midtones and highlights
    warm_weight = np.clip((l - 0.3) / 0.7, 0.0, 1.0) ** 1.2
    
    # Rich warm nostalgic saturation in oranges/yellows (20-60 deg)
    amber_dist = np.abs(h - 38.0)
    amber_weight = np.clip(1.0 - amber_dist / 35.0, 0.0, 1.0)
    s_mod = s * (1.0 + 0.20 * amber_weight)

    hsl_out = np.stack([h, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)

    # Inject amber warmth into highlights (boost Red and Green, reduce Blue)
    rgb_out[..., 0] += 0.055 * warm_weight
    rgb_out[..., 1] += 0.032 * warm_weight
    rgb_out[..., 2] -= 0.040 * warm_weight
    return np.clip(rgb_out, 0.0, 1.0)

def transform_vestra(rgb):
    """FS-004 VESTRA — True Print: Natural skin color, balanced tonal response, realistic saturation"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Balanced photographic print S-curve
    l_curved = np.where(l < 0.5, 0.5 * (2.0 * l) ** 1.18, 1.0 - 0.5 * (2.0 * (1.0 - l)) ** 1.18)

    # Skin tone preservation and harmony (25 - 45 deg hue)
    skin_dist = np.abs(h - 32.0)
    skin_weight = np.clip(1.0 - skin_dist / 25.0, 0.0, 1.0)
    # Gentle skin radiance without oversaturation
    s_mod = np.where(skin_weight > 0.0, s * (1.0 + 0.08 * skin_weight), s * 0.96)

    hsl_out = np.stack([h, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)

    # Photographic paper print micro-contrast
    return np.clip(rgb_out, 0.0, 1.0)

def transform_veyra(rgb):
    """FS-005 VEYRA — Natural Balance: Neutral color reproduction, smooth tonal transitions"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Smooth linear midtone transition with highlight soft-clip (protecting dynamic range)
    # Highlight compression above 0.8
    l_curved = np.where(l < 0.75, l, 0.75 + 0.25 * (1.0 - np.exp(-(l - 0.75) * 5.0)))
    l_curved = l_curved / (0.75 + 0.25 * (1.0 - np.exp(-0.25 * 5.0)))

    hsl_out = np.stack([h, s, l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)
    return np.clip(rgb_out, 0.0, 1.0)

def transform_solvik(rgb):
    """FS-006 SOLVIK — Vivid Nature: Enhanced landscape color, vivid greens and blues"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Rich slide film contrast (punchy shadows and crisp highlights)
    l_curved = np.where(l < 0.5, 0.5 * (2.0 * l) ** 1.30, 1.0 - 0.5 * (2.0 * (1.0 - l)) ** 1.30)

    # Landscape green boost (80 - 150 deg)
    green_dist = np.abs(h - 115.0)
    green_weight = np.clip(1.0 - green_dist / 40.0, 0.0, 1.0)
    # Sky blue boost (190 - 240 deg)
    blue_dist = np.abs(h - 215.0)
    blue_weight = np.clip(1.0 - blue_dist / 35.0, 0.0, 1.0)

    s_mod = s * (1.0 + 0.35 * green_weight + 0.30 * blue_weight)

    # Shift landscape greens slightly toward rich emerald (115 -> 122)
    h_mod = np.where(green_weight > 0.0, h + 7.0 * green_weight, h)
    # Deepen sky blues slightly toward royal azure (215 -> 220)
    h_mod = np.where(blue_weight > 0.0, h_mod + 5.0 * blue_weight, h_mod)
    h_mod = (h_mod + 360.0) % 360.0

    hsl_out = np.stack([h_mod, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)
    return np.clip(rgb_out, 0.0, 1.0)

def transform_lysen(rgb):
    """FS-007 LYSEN — Soft Portrait: Gentle contrast, controlled skin color, soft highlights"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Low contrast portrait curve: gentle slope, lifted toe (+0.04), soft shoulder rolloff
    l_curved = 0.04 + 0.95 * (np.where(l < 0.5, 0.5 * (2.0 * l) ** 0.95, 1.0 - 0.5 * (2.0 * (1.0 - l)) ** 0.95))

    # Controlled skin color: desaturate harsh magenta/red blotches (340-20 deg), preserve natural peach
    red_dist = np.minimum(h, 360.0 - h)
    red_weight = np.clip(1.0 - red_dist / 30.0, 0.0, 1.0)
    s_mod = s * (1.0 - 0.15 * red_weight) * 0.92

    hsl_out = np.stack([h, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)

    # Soft luminous warmth in upper midtones
    soft_glow = np.clip((l - 0.4) / 0.5, 0.0, 1.0) ** 1.5
    rgb_out[..., 0] += 0.025 * soft_glow
    rgb_out[..., 1] += 0.015 * soft_glow
    return np.clip(rgb_out, 0.0, 1.0)

def transform_myrvel(rgb):
    """FS-008 MYRVEL — Cinema Dusk: Low saturation, cinematic shadows, smooth highlight rolloff"""
    hsl = rgb_to_hsl(rgb)
    h, s, l = hsl[..., 0], hsl[..., 1], hsl[..., 2]

    # Cinematic S-curve: deep cinematic toe, compressed highlight rolloff
    l_curved = np.where(l < 0.5, 0.5 * (2.0 * l) ** 1.25, 1.0 - 0.5 * (2.0 * (1.0 - l)) ** 1.20)

    # General cinematic muted saturation (0.84)
    s_mod = s * 0.84

    hsl_out = np.stack([h, np.clip(s_mod, 0.0, 1.0), l_curved], axis=-1)
    rgb_out = hsl_to_rgb(hsl_out)

    # Cinematic Teal/Orange split-toning:
    # Shadows (< 0.45) infused with cyan-teal (boost blue & green, reduce red)
    shadow_teal = np.clip((0.45 - l) / 0.45, 0.0, 1.0) ** 1.3
    rgb_out[..., 0] -= 0.035 * shadow_teal
    rgb_out[..., 1] += 0.015 * shadow_teal
    rgb_out[..., 2] += 0.045 * shadow_teal

    # Highlights (> 0.50) infused with cinematic warm dusk/amber
    hl_amber = np.clip((l - 0.50) / 0.50, 0.0, 1.0) ** 1.3
    rgb_out[..., 0] += 0.040 * hl_amber
    rgb_out[..., 1] += 0.018 * hl_amber
    rgb_out[..., 2] -= 0.030 * hl_amber

    return np.clip(rgb_out, 0.0, 1.0)

def transform_rimva(rgb):
    """FS-009 RIMVA — Silver Monochrome: Black-and-white transformation, refined contrast and grain"""
    # Panchromatic silver gelatin spectral weighting:
    # 0.28 R + 0.58 G + 0.14 B (close to Agfa APX / Kodak Tri-X response)
    y = 0.28 * rgb[..., 0] + 0.58 * rgb[..., 1] + 0.14 * rgb[..., 2]

    # Rich silver contrast curve: deep D-max blacks, crisp zone V-VIII micro-contrast
    y_curved = np.where(y < 0.5, 0.5 * (2.0 * y) ** 1.32, 1.0 - 0.5 * (2.0 * (1.0 - y)) ** 1.28)
    y_curved = np.clip(y_curved, 0.0, 1.0)

    # Pure silver monochrome (R = G = B)
    rgb_out = np.stack([y_curved, y_curved, y_curved], axis=-1)
    return rgb_out

def transform_retro90(rgb):
    """Original Night Amber transform. Spatial glow/grain stay in the renderer."""
    lum = np.dot(rgb, [0.2126, 0.7152, 0.0722])
    mid = (4.0 * lum * (1.0 - lum))[:, None]
    color = np.power(np.clip(rgb, 0, 1), 1.035)
    neutral = np.dot(color, [0.2126, 0.7152, 0.0722])[:, None]
    # Quiet shadow chroma with a black-preserving toe.
    shadow = np.clip((0.32 - lum) / 0.32, 0, 1)[:, None]
    color = color * (1.0 - 0.10 * shadow) + neutral * (0.10 * shadow)
    color[:, 0] += 0.025 * mid[:, 0] * (1.0 - color[:, 0])
    color[:, 1] += 0.010 * mid[:, 0] * (1.0 - color[:, 1])
    color[:, 2] *= 1.0 - 0.085 * mid[:, 0]
    # Small smooth shoulder rather than hard channel clipping.
    color = color - 0.025 * np.maximum(color - 0.65, 0) ** 2
    return np.clip(color, 0, 1)

PROFILES = [
    {
        "id": "identity",
        "name": "Identity Neutral",
        "filename": "identity.cube",
        "transform": transform_identity,
        "description": "Neutral identity transformation for color engine verification and zero-strength validation."
    },
    {
        "id": "FS-001",
        "code": "VAERN",
        "name": "VÆRN",
        "style": "Heritage Negative",
        "filename": "FS-001_VAERN.cube",
        "transform": transform_vaern,
        "description": "Deep contrast, muted green shadows, distinctive red response."
    },
    {
        "id": "FS-002",
        "code": "SKELD",
        "name": "SKELD",
        "style": "Editorial Chrome",
        "filename": "FS-002_SKELD.cube",
        "transform": transform_skeld,
        "description": "Reduced saturation, restrained blue tones, documentary contrast."
    },
    {
        "id": "FS-003",
        "code": "AURVEN",
        "name": "AURVEN",
        "style": "Amber Memory",
        "filename": "FS-003_AURVEN.cube",
        "transform": transform_aurven,
        "description": "Warm highlights, preserved shadow depth, nostalgic color."
    },
    {
        "id": "FS-004",
        "code": "VESTRA",
        "name": "VESTRA",
        "style": "True Print",
        "filename": "FS-004_VESTRA.cube",
        "transform": transform_vestra,
        "description": "Natural skin color, balanced tonal response, realistic saturation."
    },
    {
        "id": "FS-005",
        "code": "VEYRA",
        "name": "VEYRA",
        "style": "Natural Balance",
        "filename": "FS-005_VEYRA.cube",
        "transform": transform_veyra,
        "description": "Neutral color reproduction, smooth tonal transitions."
    },
    {
        "id": "FS-006",
        "code": "SOLVIK",
        "name": "SOLVIK",
        "style": "Vivid Nature",
        "filename": "FS-006_SOLVIK.cube",
        "transform": transform_solvik,
        "description": "Enhanced landscape color, vivid greens and blues."
    },
    {
        "id": "FS-007",
        "code": "LYSEN",
        "name": "LYSEN",
        "style": "Soft Portrait",
        "filename": "FS-007_LYSEN.cube",
        "transform": transform_lysen,
        "description": "Gentle contrast, controlled skin color, soft highlights."
    },
    {
        "id": "FS-008",
        "code": "MYRVEL",
        "name": "MYRVEL",
        "style": "Cinema Dusk",
        "filename": "FS-008_MYRVEL.cube",
        "transform": transform_myrvel,
        "description": "Low saturation, cinematic shadows, smooth highlight rolloff."
    },
    {
        "id": "FS-009",
        "code": "RIMVA",
        "name": "RIMVA",
        "style": "Silver Monochrome",
        "filename": "FS-009_RIMVA.cube",
        "transform": transform_rimva,
        "description": "Black-and-white transformation, refined contrast and grain."
    },
    {
        "id": "FS-010", "code": "RETRO90", "name": "RETRO 90",
        "style": "Night Amber", "filename": "FS-010_RETRO90.cube",
        "transform": transform_retro90,
        "description": "Original warm compact-camera night interpretation."
    }
]

def write_cube_file(filepath, profile, transformed_rgb, size=33):
    """Writes standard 3D .cube file with Red fastest, Green second, Blue slowest."""
    with open(filepath, 'w') as f:
        f.write("# HD2Lab Film Studio — 3D LUT\n")
        f.write(f"# Film ID: {profile['id']}\n")
        f.write(f"# Display Name: {profile['name']}\n")
        f.write(f"# Style: {profile.get('style', 'Utility')}\n")
        f.write(f"# Publisher: HD2Lab\n")
        f.write(f"# License: Permissive MIT / HD2Lab Original Formula\n")
        f.write("# Working Space: sRGB (IEC 61966-2-1)\n")
        f.write(f"LUT_3D_SIZE {size}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        f.write("DOMAIN_MAX 1.0 1.0 1.0\n\n")

        # transformed_rgb has shape (size*size*size, 3) where R is fastest, G middle, B slowest
        for val in transformed_rgb:
            f.write(f"{val[0]:.6f} {val[1]:.6f} {val[2]:.6f}\n")

def main():
    output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "public", "luts")
    os.makedirs(output_dir, exist_ok=True)
    print(f"Generating HD2Lab 3D LUTs (size 33x33x33) into {output_dir}...")

    base_rgb, size = generate_base_lattice(33)

    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='Generate only the given film ID')
    args = parser.parse_args()
    profiles = [p for p in PROFILES if not args.only or p['id'] == args.only]
    if not profiles:
        parser.error('Unknown film ID')
    for profile in profiles:
        print(f"  -> Generating {profile['id']}: {profile['name']} ({profile['filename']})...")
        transformed = profile["transform"](base_rgb)
        
        # Validation
        assert transformed.shape == base_rgb.shape, "Shape mismatch"
        assert np.all(transformed >= -1e-6) and np.all(transformed <= 1.0 + 1e-6), "Values out of bounds [0, 1]"
        
        if profile["id"] == "identity":
            max_err = np.max(np.abs(transformed - base_rgb))
            assert max_err < 1e-7, f"Identity LUT error too high: {max_err}"
            print(f"     Identity verification passed (max diff: {max_err:.2e})")

        out_path = os.path.join(output_dir, profile["filename"])
        write_cube_file(out_path, profile, transformed, size)
        size_kb = os.path.getsize(out_path) / 1024.0
        print(f"     Written: {out_path} ({size_kb:.1f} KB)")

    print(f"\nGenerated {len(profiles)} 3D LUT profile(s) successfully!")

if __name__ == "__main__":
    main()
