import { describe, expect, it } from 'vitest';
import {
  isNeutralLensBlur,
  normalizeLensBlur,
  type LensBlurPlan,
  type LensBlurState,
} from '../src/engine/contracts/lensBlur';
import type { LinearMask, LuminanceMask } from '../src/engine/contracts/masks';
import {
  LENS_BLUR_FRAGMENT,
  MAX_COC_AT_F1,
  MAX_TAPS,
  PSF_TEXTURE_WIDTH,
  apertureTapWeights,
  blurRgbaReference,
  circleOfConfusion,
  lensBlurMaxCoc,
  planLensBlur,
  proceduralDepth,
  psfTextureData,
  rasterizeDepthMask,
  suggestTaps,
  type ApertureShape,
} from '../src/engine/optical/lensBlur';

const CAPABILITY = { maxTextureSize: 4096 };

const state = (extra: Partial<LensBlurState> = {}): LensBlurState =>
  normalizeLensBlur({
    enabled: true,
    focusPlane: 0.5,
    focusRange: 0.1,
    aperture: 1,
    bladeCount: 6,
    rotationDeg: 0,
    quality: 'export',
    highlightBoost: 0,
    depthMask: null,
    ...extra,
  });

const aperture = (blades: number, rotation = 0): ApertureShape => ({ blades, rotation, roundness: 0 });

const polygonRadius = (theta: number, blades: number, rotation: number): number => {
  const sector = (2 * Math.PI) / blades;
  let local = (theta - rotation) % sector;
  if (local < 0) local += sector;
  return Math.cos(Math.PI / blades) / Math.cos(local - Math.PI / blades);
};

const image = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Float32Array => {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 1;
    }
  }
  return data;
};

const boxDownsample = (src: Float32Array, width: number, height: number): Float32Array => {
  const outWidth = Math.max(1, width >> 1);
  const outHeight = Math.max(1, height >> 1);
  const out = new Float32Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(width - 1, x * 2 + dx);
            const sy = Math.min(height - 1, y * 2 + dy);
            sum += src[(sy * width + sx) * 4 + c];
            count++;
          }
        }
        out[(y * outWidth + x) * 4 + c] = sum / count;
      }
    }
  }
  return out;
};

const bilinearUpsample = (
  src: Float32Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Float32Array => {
  const out = new Float32Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.min(height - 1, Math.max(0, ((y + 0.5) / outHeight) * height - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.min(width - 1, Math.max(0, ((x + 0.5) / outWidth) * width - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * width + x0) * 4 + c] * (1 - fx) + src[(y0 * width + x1) * 4 + c] * fx;
        const bottom = src[(y1 * width + x0) * 4 + c] * (1 - fx) + src[(y1 * width + x1) * 4 + c] * fx;
        out[(y * outWidth + x) * 4 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
};


const linearMask = (extra: Partial<LinearMask> = {}): LinearMask => ({
  id: 'depth-linear',
  name: 'Depth',
  enabled: true,
  blend: 'add',
  opacity: 1,
  inverted: false,
  kind: 'linear',
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
  feather: 0,
  ...extra,
});

describe('lens blur CoC model', () => {
  it('is zero inside the focus band and monotonic outside it', () => {
    const lens = state({ focusPlane: 0.4, focusRange: 0.2 });
    expect(circleOfConfusion(0.4, lens)).toBe(0);
    expect(circleOfConfusion(0.5, lens)).toBe(0);
    expect(circleOfConfusion(0.35, lens)).toBe(0);

    const slightlyOut = circleOfConfusion(0.6, lens);
    const farOut = circleOfConfusion(0.9, lens);
    expect(slightlyOut).toBeGreaterThan(0);
    expect(farOut).toBeGreaterThan(slightlyOut);
    expect(circleOfConfusion(0.2, lens)).toBeCloseTo(slightlyOut, 6);
  });

  it('widens the sharp band and shrinks CoC as the aperture stops down', () => {
    const narrow = state({ focusPlane: 0.4, focusRange: 0.1, aperture: 1 });
    const wide = state({ focusPlane: 0.4, focusRange: 0.5, aperture: 1 });
    expect(circleOfConfusion(0.8, wide)).toBeLessThan(circleOfConfusion(0.8, narrow));

    expect(lensBlurMaxCoc(1)).toBeCloseTo(MAX_COC_AT_F1, 8);
    expect(lensBlurMaxCoc(11)).toBeLessThan(lensBlurMaxCoc(2.8));
    const stopped = state({ focusPlane: 0.4, focusRange: 0.1, aperture: 11 });
    expect(circleOfConfusion(0.9, stopped)).toBeLessThan(circleOfConfusion(0.9, narrow));
  });

  it('normalizes depth from the image center to the farthest corner', () => {
    expect(proceduralDepth(0.5, 0.5, 40, 40)).toBeCloseTo(0, 6);
    expect(proceduralDepth(0, 0, 40, 40)).toBeCloseTo(1, 6);
    expect(proceduralDepth(0, 0, 40, 20)).toBeCloseTo(1, 6);
    const mid = proceduralDepth(0.5, 0.5, 40, 40);
    const half = proceduralDepth(0.5 + 0.5 / Math.SQRT2 / 2, 0.5, 40, 40);
    expect(half).toBeGreaterThan(mid);
  });
});

describe('aperture PSF', () => {
  it('keeps taps inside blade polygons and normalizes weights', () => {
    for (let blades = 5; blades <= 9; blades++) {
      const rotation = (blades * 7 * Math.PI) / 180;
      const shape = aperture(blades, rotation);
      const taps = apertureTapWeights(shape, MAX_TAPS);
      expect(taps.length).toBeGreaterThan(1);
      expect(taps.length).toBeLessThanOrEqual(MAX_TAPS);
      const total = taps.reduce((sum, tap) => sum + tap.weight, 0);
      expect(total).toBeCloseTo(1, 9);
      for (const tap of taps) {
        const theta = Math.atan2(tap.offset.y, tap.offset.x);
        const radius = Math.hypot(tap.offset.x, tap.offset.y);
        expect(radius).toBeLessThanOrEqual(polygonRadius(theta, blades, rotation) + 1e-9);
      }
      const cx = taps.reduce((sum, tap) => sum + tap.offset.x * tap.weight, 0);
      const cy = taps.reduce((sum, tap) => sum + tap.offset.y * tap.weight, 0);
      expect(Math.abs(cx)).toBeLessThan(0.05);
      expect(Math.abs(cy)).toBeLessThan(0.05);
    }
  });

  it('rotates the blade shape deterministically', () => {
    const upright = apertureTapWeights(aperture(6, 0), 32);
    const turned = apertureTapWeights(aperture(6, Math.PI / 6), 32);
    expect(turned).not.toEqual(upright);
    expect(apertureTapWeights(aperture(6, Math.PI / 6), 32)).toEqual(turned);
  });

  it('packs taps into the 64x1 RGBA32F texture with zero padding', () => {
    const taps = apertureTapWeights(aperture(6, 0), 40);
    const data = psfTextureData(taps);
    expect(data).toHaveLength(PSF_TEXTURE_WIDTH * 4);
    expect(data[0]).toBeCloseTo(taps[0].offset.x, 6);
    expect(data[1]).toBeCloseTo(taps[0].offset.y, 6);
    expect(data[2]).toBeCloseTo(taps[0].weight, 6);
    expect(data[3]).toBe(0);
    const last = (taps.length - 1) * 4;
    expect(data[last + 2]).toBeCloseTo(taps[taps.length - 1].weight, 6);
    expect(data[last + 4 + 2]).toBe(0);
    expect(() =>
      psfTextureData(Array.from({ length: PSF_TEXTURE_WIDTH + 1 }, () => ({ offset: { x: 0, y: 0 }, weight: 0 }))),
    ).toThrow(`Lens blur PSF supports at most ${PSF_TEXTURE_WIDTH} taps`);
  });
});

describe('lens blur plan', () => {
  it('returns null for neutral and identity configurations', () => {
    expect(isNeutralLensBlur(state({ enabled: false }))).toBe(true);
    expect(planLensBlur(state({ enabled: false }), { width: 64, height: 64 }, CAPABILITY)).toBeNull();

    // focusRange 1 keeps every depth inside the band.
    expect(planLensBlur(state({ focusRange: 1 }), { width: 256, height: 256 }, CAPABILITY)).toBeNull();
    // A tiny output has a sub-pixel CoC, which is also an exact identity.
    expect(planLensBlur(state(), { width: 8, height: 8 }, CAPABILITY)).toBeNull();
  });

  it('uses half resolution for preview and clamps to the texture limit', () => {
    const preview = planLensBlur(state({ quality: 'preview' }), { width: 200, height: 100 }, CAPABILITY);
    expect(preview).not.toBeNull();
    expect(preview!.width).toBe(100);
    expect(preview!.height).toBe(50);
    expect(preview!.halfRes).toBe(true);

    const exported = planLensBlur(state({ quality: 'export' }), { width: 200, height: 100 }, CAPABILITY);
    expect(exported!.width).toBe(200);
    expect(exported!.height).toBe(100);
    expect(exported!.halfRes).toBe(false);

    const clamped = planLensBlur(state(), { width: 200, height: 100 }, { maxTextureSize: 50 });
    expect(clamped!.width).toBe(50);
    expect(clamped!.height).toBe(25);
  });

  it('clamps the tap budget to the device limit and the CoC tier', () => {
    const plan = planLensBlur(state(), { width: 256, height: 256 }, { maxTextureSize: 4096, maxTaps: 5 });
    expect(plan).not.toBeNull();
    expect(plan!.tapCount).toBeLessThanOrEqual(5);
    expect(plan!.tapCount).toBeGreaterThan(1);
    expect(plan!.psf).toHaveLength(PSF_TEXTURE_WIDTH * 4);

    const full = planLensBlur(state(), { width: 256, height: 256 }, CAPABILITY)!;
    const sameSize = suggestTaps(full.maxCocShortSide, 256, 'export');
    expect(full.tapCount).toBeLessThanOrEqual(sameSize);
  });

  it('rejects invalid sizes and capabilities', () => {
    expect(() => planLensBlur(state(), { width: 0, height: 64 }, CAPABILITY)).toThrow('Invalid lens blur output size');
    expect(() => planLensBlur(state(), { width: 64, height: 8.5 }, CAPABILITY)).toThrow(
      'Invalid lens blur output size',
    );
    expect(() => planLensBlur(state(), { width: 64, height: 64 }, { maxTextureSize: 0 })).toThrow(
      'Invalid lens blur capability',
    );
  });
});

describe('lens blur reference gather', () => {
  it('conserves energy on a uniform image and keeps alpha', () => {
    const width = 64;
    const height = 64;
    const src = image(width, height, () => [0.5, 0.5, 0.5]);
    const plan = planLensBlur(state({ focusPlane: 0.5, focusRange: 0.05 }), { width, height }, CAPABILITY)!;
    const blurred = blurRgbaReference(src, width, height, plan);
    for (let y = 8; y < height - 8; y += 8) {
      for (let x = 8; x < width - 8; x += 8) {
        const index = (y * width + x) * 4;
        expect(blurred[index]).toBeCloseTo(0.5, 4);
        expect(blurred[index + 1]).toBeCloseTo(0.5, 4);
        expect(blurred[index + 2]).toBeCloseTo(0.5, 4);
        expect(blurred[index + 3]).toBe(1);
      }
    }
  });

  it('suppresses halos across a depth discontinuity', () => {
    const width = 64;
    const height = 64;
    const src = image(width, height, (x) => (x < width / 2 ? [0.05, 0.05, 0.05] : [0.95, 0.95, 0.95]));
    const plan: LensBlurPlan = planLensBlur(
      state({ focusPlane: 0.5, focusRange: 0.05, depthMask: [linearMask()] }),
      { width, height },
      CAPABILITY,
    )!;
    expect(plan.depth).not.toBeNull();
    expect(plan.depth![0]).toBe(0);
    expect(plan.depth![(height >> 1) * width + width - 1]).toBe(1);

    const unguarded = blurRgbaReference(src, width, height, plan, { guard: false });
    const guarded = blurRgbaReference(src, width, height, plan);
    const index = ((height >> 1) * width + (width / 2 - 3)) * 4;
    expect(guarded[index]).toBeLessThan(unguarded[index]);
    expect(guarded[index]).toBeLessThan(0.4);
  });

  it('rasterizes depth masks and rejects pixel-sampled masks', () => {
    const depth = rasterizeDepthMask([linearMask()], 32, 16)!;
    expect(depth[0]).toBe(0);
    expect(depth[31]).toBe(1);
    expect(rasterizeDepthMask(null, 32, 16)).toBeNull();
    expect(rasterizeDepthMask([{ ...linearMask(), enabled: false }], 32, 16)).toBeNull();

    const luminance: LuminanceMask = {
      id: 'luma',
      name: 'Luma',
      enabled: true,
      blend: 'add',
      opacity: 1,
      inverted: false,
      kind: 'luminance',
      lo: 0.2,
      hi: 0.8,
      feather: 0,
    };
    expect(() => rasterizeDepthMask([luminance], 32, 16)).toThrow(
      'Depth masks support brush, linear and radial masks only',
    );
  });

  it('matches preview output after upscale within tolerance', () => {
    const width = 96;
    const height = 64;
    const src = image(width, height, (x, y) => {
      const value = Math.min(1, Math.max(0, 0.15 + (0.7 * x) / (width - 1) + (0.1 * y) / (height - 1)));
      return [value, value, value];
    });
    const shared = { focusPlane: 0.5, focusRange: 0.15, aperture: 1 };
    const exported = planLensBlur(state({ ...shared, quality: 'export' }), { width, height }, CAPABILITY)!;
    const preview = planLensBlur(state({ ...shared, quality: 'preview' }), { width, height }, CAPABILITY)!;
    const exportBlur = blurRgbaReference(src, width, height, exported);
    const previewBlur = blurRgbaReference(boxDownsample(src, width, height), preview.width, preview.height, preview);
    const upscaled = bilinearUpsample(previewBlur, preview.width, preview.height, width, height);

    let sum = 0;
    let count = 0;
    let max = 0;
    for (let y = 8; y < height - 8; y++) {
      for (let x = 8; x < width - 8; x++) {
        const index = (y * width + x) * 4;
        const diff = Math.abs(exportBlur[index] - upscaled[index]);
        sum += diff;
        max = Math.max(max, diff);
        count++;
      }
    }
    expect(sum / count).toBeLessThan(0.02);
    expect(max).toBeLessThan(0.08);
  });
});

describe('lens blur shader chunk', () => {
  it('publishes the depth-aware gather contract', () => {
    expect(LENS_BLUR_FRAGMENT).toContain('uniform sampler2D u_q02_lens_scene');
    expect(LENS_BLUR_FRAGMENT).toContain('uniform sampler2D u_q02_lens_psf');
    expect(LENS_BLUR_FRAGMENT).toContain('uniform sampler2D u_q02_lens_depth');
    expect(LENS_BLUR_FRAGMENT).toContain('uniform int u_q02_lens_taps');
    expect(LENS_BLUR_FRAGMENT).toContain('texelFetch(u_q02_lens_psf, ivec2(i, 0), 0)');
    expect(LENS_BLUR_FRAGMENT).toContain('for (int i = 0; i < 64; i++)');
    expect(LENS_BLUR_FRAGMENT).toContain('float q02_lens_coc(float depth)');
    expect(LENS_BLUR_FRAGMENT).toContain('vec3 q02_lens_blur(vec3 color, vec2 uv)');
    expect(LENS_BLUR_FRAGMENT).not.toContain('#version');
  });
});
