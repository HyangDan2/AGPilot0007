#!/usr/bin/env python3
"""
Generate synthetic photographic test images and color charts for HD2Lab Film Studio.
Covers:
  - color_chart.png: 24-patch standard color rendition chart + 6-step grayscale wedge + gradients
  - portrait_test.png: Multi-tone skin tone and portrait tonal gradient ramp
  - landscape_test.png: Rich foliage green, sky gradient, high-contrast dynamic range
  - architecture_test.png: High-contrast architectural geometry, deep shadows, specular highlights
  - street_night.png: Deep blacks, neon lights, warm street lamp glows
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def make_color_chart():
    """Generates standard 24-patch color rendition chart with gradient sweeps."""
    w, h = 1200, 800
    img = Image.new('RGB', (w, h), (38, 41, 46))
    draw = ImageDraw.Draw(img)

    # Standard 24 Macbeth-style patches (approximate sRGB values)
    patches = [
        # Row 1: Natural colors
        [(115, 82, 68), (194, 150, 130), (98, 122, 157), (87, 108, 67), (133, 128, 177), (103, 189, 170)],
        # Row 2: Miscellaneous & primaries
        [(214, 126, 44), (80, 91, 166), (193, 90, 99), (94, 60, 108), (157, 188, 64), (224, 163, 46)],
        # Row 3: Primaries & secondaries
        [(56, 61, 150), (70, 148, 73), (175, 54, 60), (231, 199, 31), (187, 86, 149), (8, 133, 161)],
        # Row 4: Grayscale ramp (White to Black)
        [(243, 243, 242), (200, 200, 200), (160, 160, 160), (122, 122, 121), (85, 85, 85), (52, 52, 52)]
    ]

    top = 50
    left = 60
    pw, ph = 160, 110
    pad = 20

    for r, row in enumerate(patches):
        for c, color in enumerate(row):
            x0 = left + c * (pw + pad)
            y0 = top + r * (ph + pad)
            draw.rectangle([x0, y0, x0 + pw, y0 + ph], fill=color, outline=(20, 20, 20), width=2)

    # Bottom Gradient Sweeps
    gy0 = top + 4 * (ph + pad) + 20
    gh = 60
    gw = 6 * pw + 5 * pad

    # Continuous Grayscale Ramp
    for x in range(gw):
        val = int(255 * (x / gw))
        draw.line([(left + x, gy0), (left + x, gy0 + gh)], fill=(val, val, val))

    # Continuous Spectrum Ramp
    gy1 = gy0 + gh + 15
    for x in range(gw):
        hue = (x / gw) * 360.0
        # HSL to RGB
        c = 1.0
        hp = hue / 60.0
        xb = c * (1.0 - abs((hp % 2) - 1.0))
        if 0 <= hp < 1: r, g, b = c, xb, 0
        elif 1 <= hp < 2: r, g, b = xb, c, 0
        elif 2 <= hp < 3: r, g, b = 0, c, xb
        elif 3 <= hp < 4: r, g, b = 0, xb, c
        elif 4 <= hp < 5: r, g, b = xb, 0, c
        else: r, g, b = c, 0, xb
        draw.line([(left + x, gy1), (left + x, gy1 + gh)], fill=(int(r*255), int(g*255), int(b*255)))

    # Title label
    draw.text((left, 18), "HD2Lab Color Target & Dynamic Range Calibration Chart (sRGB)", fill=(200, 210, 225))
    return img

def make_portrait_test():
    """Generates synthetic portrait scene with varying skin tones and warm lighting."""
    w, h = 1200, 900
    img = Image.new('RGB', (w, h))
    arr = np.zeros((h, w, 3), dtype=np.uint8)

    # Soft studio backdrop gradient (neutral warm charcoal)
    for y in range(h):
        for x in range(w):
            dist = np.sqrt(((x - w*0.4)**2 + (y - h*0.4)**2)) / (w * 0.9)
            bg_l = int(np.clip(75 - 45 * dist, 20, 240))
            arr[y, x] = [bg_l + 5, bg_l, max(0, bg_l - 5)]

    # Skin tone test bands (different Fitzpatrick types and lighting angles)
    skin_tones = [
        (240, 215, 195), # Type I / II Fair
        (225, 185, 155), # Type III Medium Warm
        (195, 145, 110), # Type IV Olive / Tan
        (145, 95, 65),   # Type V Rich Brown
        (90, 55, 40)     # Type VI Deep Espresso
    ]

    pil_img = Image.fromarray(arr)
    draw = ImageDraw.Draw(pil_img)

    for i, tone in enumerate(skin_tones):
        cx = int(w * (0.16 + i * 0.17))
        cy = int(h * 0.45)
        r = 85
        # Draw gradient sphere for each skin tone
        for rad in range(r, 0, -1):
            ratio = rad / r
            r_c = int(tone[0] * (1.2 - 0.5 * ratio))
            g_c = int(tone[1] * (1.2 - 0.5 * ratio))
            b_c = int(tone[2] * (1.2 - 0.5 * ratio))
            # offset highlight
            draw.ellipse([cx - rad - int(15*(1-ratio)), cy - rad - int(20*(1-ratio)), 
                          cx + rad - int(15*(1-ratio)), cy + rad - int(20*(1-ratio))], 
                         fill=(min(255, r_c), min(255, g_c), min(255, b_c)))

    # Highlight gradient strip across bottom
    for x in range(w):
        val = int(255 * (x / w))
        draw.line([(x, h - 80), (x, h - 20)], fill=(val, int(val * 0.95), int(val * 0.88)))

    draw.text((40, 30), "HD2Lab Skin Tone & Portrait Calibration Subject", fill=(240, 240, 240))
    return pil_img

def make_landscape_test():
    """Generates synthetic landscape with sky gradient, foliage greens, and mountains."""
    w, h = 1200, 900
    arr = np.zeros((h, w, 3), dtype=np.uint8)

    for y in range(h):
        for x in range(w):
            if y < h * 0.55:
                # Sky gradient from deep azure zenith to pale horizon cyan
                sky_prog = y / (h * 0.55)
                r = int(55 + 140 * sky_prog)
                g = int(105 + 105 * sky_prog)
                b = int(185 + 60 * sky_prog)
                arr[y, x] = [r, g, b]
            else:
                # Rolling foliage hills with varying greens
                hill_prog = (y - h * 0.55) / (h * 0.45)
                wave = np.sin(x * 0.015) * 20 + np.sin(x * 0.005) * 40
                if y > h * 0.55 + wave:
                    r = int(45 + 35 * hill_prog + 10 * np.sin(x * 0.02))
                    g = int(95 + 65 * (1.0 - hill_prog) + 15 * np.cos(x * 0.02))
                    b = int(35 + 20 * hill_prog)
                else:
                    # Mountain ridge
                    r = int(70 + 40 * hill_prog)
                    g = int(85 + 40 * hill_prog)
                    b = int(110 + 35 * hill_prog)
                arr[y, x] = [r, g, b]

    img = Image.fromarray(arr)
    draw = ImageDraw.Draw(img)
    # Sun highlight disk with corona
    draw.ellipse([850, 120, 970, 240], fill=(255, 250, 230))
    draw.ellipse([880, 150, 940, 210], fill=(255, 255, 255))
    draw.text((40, 30), "HD2Lab Landscape Test: Sky & Foliage Green Gamut", fill=(255, 255, 255))
    return img

def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "samples")
    os.makedirs(out_dir, exist_ok=True)
    print("Generating synthetic validation test image set...")

    chart = make_color_chart()
    chart.save(os.path.join(out_dir, "color_chart.png"))
    print("  -> Saved color_chart.png")

    portrait = make_portrait_test()
    portrait.save(os.path.join(out_dir, "portrait_test.png"))
    print("  -> Saved portrait_test.png")

    landscape = make_landscape_test()
    landscape.save(os.path.join(out_dir, "landscape_test.png"))
    print("  -> Saved landscape_test.png")

    print(f"Test image set successfully created in {out_dir}!")

if __name__ == "__main__":
    main()
