import { describe, expect, it } from 'vitest';
import type { LocalAdjustmentState } from '../src/engine/contracts/localAdjustments';
import type { BrushMask, ColorMask, LinearMask, LuminanceMask, RadialMask } from '../src/engine/contracts/masks';
import {
  LOCAL_STAGE_FRAGMENT,
  composeMaskStack,
  localStageAdjustmentUniforms,
  localStageBlendCode,
  planLocalStage,
  rasterizeMask,
  type CorrectedPixels,
} from '../src/engine/local/maskRaster';

const base = {
  name: 'mask',
  enabled: true,
  blend: 'add' as const,
  opacity: 1,
  inverted: false,
};

const pointBrush = (id: string, x: number, y: number, extra: Partial<BrushMask> = {}): BrushMask => ({
  ...base,
  id,
  kind: 'brush',
  strokes: [{ points: [{ x, y }], radius: 0.1, hardness: 0.5, flow: 1 }],
  ...extra,
});

const linear = (extra: Partial<LinearMask> = {}): LinearMask => ({
  ...base,
  id: 'linear',
  kind: 'linear',
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
  feather: 0,
  ...extra,
});

const radial = (extra: Partial<RadialMask> = {}): RadialMask => ({
  ...base,
  id: 'radial',
  kind: 'radial',
  center: { x: 0.5, y: 0.5 },
  radiusX: 0.1,
  radiusY: 0.1,
  rotation: 0,
  feather: 0,
  ...extra,
});

const luminance = (extra: Partial<LuminanceMask> = {}): LuminanceMask => ({
  ...base,
  id: 'luma',
  kind: 'luminance',
  lo: 0.4,
  hi: 0.6,
  feather: 0,
  ...extra,
});

const color = (extra: Partial<ColorMask> = {}): ColorMask => ({
  ...base,
  id: 'color',
  kind: 'color',
  color: { r: 1, g: 0, b: 0 },
  hueRange: 10,
  satRange: 0.5,
  lumRange: 0.5,
  feather: 0,
  ...extra,
});

const sample = (coverage: Float32Array, width: number, height: number, nx: number, ny: number) => {
  const x = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
  return coverage[y * width + x];
};

const pixelsOf = (width: number, height: number, rgb: [number, number, number]): CorrectedPixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = rgb[0];
    data[index * 4 + 1] = rgb[1];
    data[index * 4 + 2] = rgb[2];
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
};

describe('mask rasterization', () => {
  it('paints a brush point with hardness falloff and flow scaling', () => {
    const coverage = rasterizeMask(pointBrush('b', 0.5, 0.5), 40, 40);
    expect(sample(coverage, 40, 40, 0.5, 0.5)).toBeCloseTo(1, 5);
    expect(sample(coverage, 40, 40, 0.54, 0.5)).toBeCloseTo(1, 5);
    expect(sample(coverage, 40, 40, 0.5 + 0.09, 0.5)).toBeGreaterThan(0);
    expect(sample(coverage, 40, 40, 0.5 + 0.09, 0.5)).toBeLessThan(1);
    expect(sample(coverage, 40, 40, 0.5 + 0.2, 0.5)).toBe(0);

    const half = rasterizeMask(
      pointBrush('b', 0.5, 0.5, { strokes: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.1, hardness: 0.5, flow: 0.5 }] }),
      40,
      40,
    );
    expect(sample(half, 40, 40, 0.5, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('treats zero flow as no paint and unions overlapping strokes', () => {
    const zero = rasterizeMask(
      pointBrush('b', 0.5, 0.5, {
        strokes: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.2, hardness: 1, flow: 0 }],
      }),
      60,
      60,
    );
    expect(sample(zero, 60, 60, 0.5, 0.5)).toBe(0);

    const overlap = rasterizeMask(
      pointBrush('b', 0.5, 0.5, {
        strokes: [
          { points: [{ x: 0.5, y: 0.5 }], radius: 0.2, hardness: 1, flow: 0.5 },
          { points: [{ x: 0.65, y: 0.5 }], radius: 0.2, hardness: 1, flow: 0.5 },
        ],
      }),
      60,
      60,
    );
    expect(sample(overlap, 60, 60, 0.5, 0.5)).toBeCloseTo(0.75, 5);
    expect(sample(overlap, 60, 60, 0.35, 0.5)).toBeCloseTo(0.5, 5);
    expect(sample(overlap, 60, 60, 0.8, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('widens transition bands as feather scales', () => {
    const narrow = rasterizeMask(linear({ feather: 0.25 }), 100, 20);
    const wide = rasterizeMask(linear({ feather: 0.6 }), 100, 20);
    const narrowValue = sample(narrow, 100, 20, 0.63, 0.5);
    const wideValue = sample(wide, 100, 20, 0.63, 0.5);
    expect(narrowValue).toBeGreaterThan(0.9);
    expect(wideValue).toBeGreaterThan(0.5);
    expect(wideValue).toBeLessThan(narrowValue);

    const tight = rasterizeMask(radial({ radiusX: 0.4, radiusY: 0.4, feather: 0.5 }), 100, 100);
    const soft = rasterizeMask(radial({ radiusX: 0.4, radiusY: 0.4, feather: 1 }), 100, 100);
    const tightValue = sample(tight, 100, 100, 0.8, 0.5);
    const softValue = sample(soft, 100, 100, 0.8, 0.5);
    expect(tightValue).toBeGreaterThan(softValue);
    expect(softValue).toBeGreaterThan(0);
  });

  it('keeps brush coverage resolution independent', () => {    const mask = pointBrush('b', 0.4, 0.6, {
      strokes: [{ points: [{ x: 0.4, y: 0.6 }], radius: 0.15, hardness: 0.3, flow: 0.8 }],
    });
    const small = rasterizeMask(mask, 50, 50);
    const large = rasterizeMask(mask, 100, 100);
    for (const [nx, ny] of [[0.4, 0.6], [0.5, 0.6], [0.55, 0.66], [0.2, 0.2]] as const) {
      const smallValue = sample(small, 50, 50, nx, ny);
      const largeValue = sample(large, 100, 100, nx, ny);
      expect(Math.abs(largeValue - smallValue)).toBeLessThan(0.08);
    }
  });

  it('rasterizes linear gradients with feather', () => {
    const hard = rasterizeMask(linear(), 40, 20);
    expect(sample(hard, 40, 20, 0.25, 0.5)).toBe(0);
    expect(sample(hard, 40, 20, 0.75, 0.5)).toBe(1);

    const feathered = rasterizeMask(linear({ feather: 0.5 }), 40, 20);
    expect(sample(feathered, 40, 20, 0.5, 0.5)).toBeCloseTo(0.5, 1);
    expect(sample(feathered, 40, 20, 0.05, 0.5)).toBe(0);
    expect(sample(feathered, 40, 20, 0.95, 0.5)).toBe(1);
  });

  it('rasterizes radial ellipses with feather', () => {
    const hard = rasterizeMask(radial(), 40, 40);
    expect(sample(hard, 40, 40, 0.5, 0.5)).toBe(1);
    expect(sample(hard, 40, 40, 0.5 + 0.15, 0.5)).toBe(0);

    const ellipse = rasterizeMask(radial({ radiusX: 0.2, radiusY: 0.05 }), 40, 40);
    expect(sample(ellipse, 40, 40, 0.5 + 0.15, 0.5)).toBe(1);
    expect(sample(ellipse, 40, 40, 0.5, 0.5 + 0.15)).toBe(0);

    const soft = rasterizeMask(radial({ feather: 1 }), 40, 40);
    expect(sample(soft, 40, 40, 0.5 + 0.05, 0.5)).toBeGreaterThan(0);
    expect(sample(soft, 40, 40, 0.5 + 0.05, 0.5)).toBeLessThan(1);
  });

  it('inverts coverage after rasterization', () => {
    const coerced = rasterizeMask(pointBrush('b', 0.5, 0.5, { inverted: true }), 40, 40);
    expect(sample(coerced, 40, 40, 0.5, 0.5)).toBe(0);
    expect(sample(coerced, 40, 40, 0.05, 0.05)).toBe(1);
  });

  it('rasterizes luminance and color masks from corrected pixels', () => {
    const mid = pixelsOf(8, 8, [128, 128, 128]);
    expect(sample(rasterizeMask(luminance(), 8, 8, mid), 8, 8, 0.5, 0.5)).toBe(1);
    const dark = pixelsOf(8, 8, [10, 10, 10]);
    expect(sample(rasterizeMask(luminance(), 8, 8, dark), 8, 8, 0.5, 0.5)).toBe(0);

    const red = pixelsOf(8, 8, [255, 0, 0]);
    expect(sample(rasterizeMask(color(), 8, 8, red), 8, 8, 0.5, 0.5)).toBe(1);
    const blue = pixelsOf(8, 8, [0, 0, 255]);
    expect(sample(rasterizeMask(color(), 8, 8, blue), 8, 8, 0.5, 0.5)).toBe(0);

    expect(() => rasterizeMask(luminance(), 8, 8)).toThrow('Luminance masks require corrected pixels');
    expect(() => rasterizeMask(color(), 8, 8)).toThrow('Color masks require corrected pixels');
  });
});

describe('mask stack composition', () => {
  const left = pointBrush('left', 0.25, 0.5);
  const right = pointBrush('right', 0.75, 0.5);

  it('unions add masks and skips disabled masks', () => {
    const coverage = composeMaskStack([left, right], 40, 20);
    expect(sample(coverage, 40, 20, 0.25, 0.5)).toBeCloseTo(1, 5);
    expect(sample(coverage, 40, 20, 0.75, 0.5)).toBeCloseTo(1, 5);
    expect(sample(coverage, 40, 20, 0.5, 0.5)).toBe(0);
  });

  it('subtracts overlapping coverage', () => {
    const subtract = pointBrush('cut', 0.25, 0.5, { blend: 'subtract' });
    const coverage = composeMaskStack([left, subtract], 40, 20);
    expect(sample(coverage, 40, 20, 0.25, 0.5)).toBe(0);
  });

  it('intersects coverage with later masks', () => {
    const narrow = pointBrush('narrow', 0.35, 0.5);
    const keep = pointBrush('keep', 0.25, 0.5, { blend: 'intersect' });
    const coverage = composeMaskStack([narrow, keep], 40, 20);
    expect(sample(coverage, 40, 20, 0.25, 0.5)).toBe(0);
    expect(sample(coverage, 40, 20, 0.35, 0.5)).toBe(0);
    const self = composeMaskStack([left, pointBrush('self', 0.25, 0.5, { blend: 'intersect' })], 40, 20);
    expect(sample(self, 40, 20, 0.25, 0.5)).toBeCloseTo(1, 5);
  });

  it('scales each mask by its opacity', () => {
    const coverage = composeMaskStack([pointBrush('half', 0.5, 0.5, { opacity: 0.5 })], 40, 40);
    expect(sample(coverage, 40, 40, 0.5, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('local stage plan seam', () => {
  const mask = linear();

  it('returns null when the stage is inactive', () => {
    const inactive: LocalAdjustmentState = { enabled: false, groups: [] };
    const source = {} as CanvasImageSource;
    expect(planLocalStage({ state: inactive, width: 8, height: 8, corrected: source })).toBeNull();
    const empty: LocalAdjustmentState = { enabled: true, groups: [] };
    expect(planLocalStage({ state: empty, width: 8, height: 8, corrected: source })).toBeNull();
    const disabledMask: LocalAdjustmentState = {
      enabled: true,
      groups: [
        {
          id: 'g',
          name: 'Group',
          enabled: true,
          masks: [{ ...mask, enabled: false }],
          adjustment: {},
          opacity: 1,
          blend: 'add',
        },
      ],
    };
    expect(planLocalStage({ state: disabledMask, width: 8, height: 8, corrected: source })).toBeNull();
  });

  it('rejects invalid dimensions before touching canvases', () => {
    const state: LocalAdjustmentState = {
      enabled: true,
      groups: [
        { id: 'g', name: 'Group', enabled: true, masks: [mask], adjustment: {}, opacity: 1, blend: 'add' },
      ],
    };
    const source = {} as CanvasImageSource;
    expect(() => planLocalStage({ state, width: 0, height: 8, corrected: source })).toThrow(
      'Invalid local stage dimensions',
    );
    expect(() => planLocalStage({ state, width: 8, height: 8.5, corrected: source })).toThrow(
      'Invalid local stage dimensions',
    );
  });

  it('maps adjustments and blend modes to the shader uniforms', () => {
    expect(
      localStageAdjustmentUniforms({ exposure: 0.5, shadows: -10, temperature: 300, vignette: -20 }),
    ).toEqual({
      a: [0.5, 0, 0, -10],
      b: [0, 0, 300, 0],
      c: [0, 0, 0, -20],
    });
    expect(localStageBlendCode('add')).toBe(0);
    expect(localStageBlendCode('subtract')).toBe(1);
    expect(localStageBlendCode('intersect')).toBe(2);
  });

  it('publishes a GLSL ES 3.00 fragment with unrolled group sampling', () => {
    expect(LOCAL_STAGE_FRAGMENT).toContain('uniform sampler2D u_q02_local_masks[8]');
    expect(LOCAL_STAGE_FRAGMENT).toContain('uniform int u_q02_local_group_count');
    expect(LOCAL_STAGE_FRAGMENT).toContain('vec3 q02_local_stage(vec3 color, vec2 uv)');
    expect(LOCAL_STAGE_FRAGMENT.match(/texture\(u_q02_local_masks\[\d\]/g)).toHaveLength(8);
    expect(LOCAL_STAGE_FRAGMENT).not.toContain('clamp(1.0, 0.0, 1.0)');
    expect(LOCAL_STAGE_FRAGMENT).not.toMatch(/\bfor\s*\(/);
  });
});
