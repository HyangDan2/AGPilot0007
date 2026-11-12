#!/usr/bin/env python3
"""
Generates standardized photographic thumbnail previews for all 9 HD2Lab film profiles.
Source: public/samples/film_test_portrait.jpg
Saves to public/thumbnails/FS-001.jpg ... FS-009.jpg
"""

import os
import numpy as np
from PIL import Image
import importlib.util

spec = importlib.util.spec_from_file_location('gen', 'tools/lut-generation/generate_luts.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

def main():
    samples_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'thumbnails')
    os.makedirs(out_dir, exist_ok=True)

    base_path = os.path.join(samples_dir, 'film_test_portrait.jpg')
    base_img = Image.open(base_path).convert('RGB')
    w, h = base_img.size

    # Crop composition capturing face, skin tones, green foliage, warm ochre clothing, and background
    # Centered around the subject
    crop_w, crop_h = 600, 428
    crop_x = int(w * 0.38 - crop_w * 0.4)
    crop_y = int(h * 0.48 - crop_h * 0.5)
    crop_area = (crop_x, crop_y, crop_x + crop_w, crop_y + crop_h)

    cropped = base_img.crop(crop_area)
    thumb_base = cropped.resize((160, 114), Image.Resampling.LANCZOS)
    arr = np.array(thumb_base).astype(np.float64) / 255.0
    h_t, w_t, _ = arr.shape
    flat = arr.reshape(-1, 3)

    for prof in gen.PROFILES:
        if prof['id'] == 'identity':
            continue
        print(f"Generating photographic thumbnail for {prof['id']} ({prof['name']})...")
        transformed = prof['transform'](flat)
        res = (np.clip(transformed, 0.0, 1.0) * 255.0).astype(np.uint8)
        thumb_img = Image.fromarray(res.reshape(h_t, w_t, 3))
        save_path = os.path.join(out_dir, f"{prof['id']}.jpg")
        thumb_img.save(save_path, quality=90, optimize=True)
        print(f"  -> Saved {save_path} ({os.path.getsize(save_path)} bytes)")

    print("All 9 standardized film thumbnails generated successfully!")

if __name__ == '__main__':
    main()
