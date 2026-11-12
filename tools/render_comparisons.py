#!/usr/bin/env python3
"""
Renders side-by-side film profile comparisons on calibration images.
Outputs:
  - docs/comparisons/color_chart_matrix.png
  - docs/comparisons/portrait_matrix.png
  - docs/comparisons/quality_gate_trio.png (VÆRN, SKELD, AURVEN comparison)
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import importlib.util

spec = importlib.util.spec_from_file_location('gen', 'tools/lut-generation/generate_luts.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

def apply_profile_to_image(img_pil, transform_func):
    arr = np.array(img_pil).astype(np.float64) / 255.0
    h, w, c = arr.shape
    flat = arr.reshape(-1, 3)
    transformed = transform_func(flat)
    res = (np.clip(transformed, 0.0, 1.0) * 255.0).astype(np.uint8)
    return Image.fromarray(res.reshape(h, w, 3))

def create_matrix(base_img_path, profiles, out_path, title):
    base_img = Image.open(base_img_path).convert('RGB')
    # Resize to modest thumbnail size for composite
    tw, th = 380, 240
    base_thumb = base_img.resize((tw, th), Image.Resampling.LANCZOS)

    cols = 3
    rows = (len(profiles) + cols - 1) // cols
    header_h = 50
    card_pad = 12
    card_w = tw + card_pad * 2
    card_h = th + 45 + card_pad * 2

    canvas_w = card_w * cols + card_pad
    canvas_h = card_h * rows + header_h + card_pad

    composite = Image.new('RGB', (canvas_w, canvas_h), (12, 15, 20))
    draw = ImageDraw.Draw(composite)

    draw.text((card_pad * 2, 16), title, fill=(245, 158, 11))

    for idx, prof in enumerate(profiles):
        c = idx % cols
        r = idx // cols
        x0 = card_pad + c * card_w
        y0 = header_h + r * card_h

        # Card background
        draw.rounded_rectangle([x0, y0, x0 + card_w - card_pad, y0 + card_h - card_pad], radius=8, fill=(20, 24, 32), outline=(35, 42, 55))

        # Rendered thumbnail
        rendered = apply_profile_to_image(base_thumb, prof['transform'])
        composite.paste(rendered, (x0 + card_pad, y0 + card_pad))

        # Label
        text_y = y0 + card_pad + th + 8
        draw.text((x0 + card_pad, text_y), f"{prof['id']} — {prof['name']}", fill=(240, 245, 255))
        draw.text((x0 + card_pad, text_y + 16), prof.get('style', 'Neutral Reference'), fill=(148, 163, 184))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    composite.save(out_path)
    print(f"Generated comparison composite: {out_path}")

def main():
    docs_comp = os.path.join(os.path.dirname(__file__), '..', 'docs', 'comparisons')
    samples_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')

    profiles = gen.PROFILES

    # 1. First Quality Gate Trio: VÆRN, SKELD, AURVEN
    trio_profiles = [p for p in profiles if p['id'] in ['identity', 'FS-001', 'FS-002', 'FS-003']]
    create_matrix(
        os.path.join(samples_dir, 'portrait_test.png'),
        trio_profiles,
        os.path.join(docs_comp, 'quality_gate_trio.png'),
        'HD2Lab First Quality Gate: Baseline Identity vs VÆRN vs SKELD vs AURVEN'
    )

    # 2. All 9 Film Profiles on Color Calibration Chart
    create_matrix(
        os.path.join(samples_dir, 'color_chart.png'),
        profiles,
        os.path.join(docs_comp, 'color_chart_matrix.png'),
        'HD2Lab Film Studio: 9 Profiles Color Rendition Chart Matrix'
    )

    # 3. All 9 Film Profiles on Landscape Scene
    create_matrix(
        os.path.join(samples_dir, 'landscape_test.png'),
        profiles,
        os.path.join(docs_comp, 'landscape_matrix.png'),
        'HD2Lab Film Studio: 9 Profiles Foliage & Sky Gamut Comparison'
    )

if __name__ == '__main__':
    main()
