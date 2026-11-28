import { describe, expect, it } from 'vitest';
import { normalizeLensBlur, type LensBlurState } from '../src/engine/contracts/lensBlur';
import type { LinearMask, RadialMask } from '../src/engine/contracts/masks';
import {
  MAX_TAPS,
  planLensBlur,
  proceduralDepth,
  rasterizeDepthMask,
} from '../src/engine/optical/lensBlur';
import {
  createLensTileTemplate,
  planLensTileStage,
  planLensTiles,
  shouldTileLensExport,
  MIN_LENS_TILE_EDGE,
} from '../src/engine/optical/lensTiled';
import {
  composeMaskStack,
  composeMaskStackRegion,
  rasterizeMask,
} from '../src/engine/local/maskRaster';

const CAPABILITY = { maxTextureSize: 8192, maxTaps: MAX_TAPS };

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

const base = {
  id: 'm1',
  name: 'mask',
  enabled: true,
  blend: 'add' as const,
  opacity: 1,
  inverted: false,
};

const radial = (centerX: number, centerY: number): RadialMask => ({
  ...base,
  kind: 'radial',
  center: { x: centerX, y: centerY },
  radiusX: 0.22,
  radiusY: 0.16,
  rotation: 0,
  feather: 0.05,
});

const linear = (): LinearMask => ({
  ...base,
  kind: 'linear',
  start: { x: 0.1, y: 0.2 },
  end: { x: 0.9, y: 0.8 },
  feather: 0.08,
});

const regionSlice = (full: Float32Array, frameWidth: number, tile: { x: number; y: number; width: number; height: number }): Float32Array => {
  const out = new Float32Array(tile.width * tile.height);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      out[y * tile.width + x] = full[(tile.y + y) * frameWidth + tile.x + x];
    }
  }
  return out;
};

const maxAbsDiff = (a: Float32Array, b: Float32Array): number => {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
};

describe('planLensTiles', () => {
  it('covers the frame with non-overlapping cores', () => {
    const grid = planLensTiles(10_000, 7_000, 4096, 300);
    expect(grid.columns).toBe(3);
    expect(grid.rows).toBe(2);
    let covered = 0;
    for (const tile of grid.tiles) {
      expect(tile.core.x).toBeGreaterThanOrEqual(0);
      expect(tile.core.x + tile.core.width).toBeLessThanOrEqual(10_000);
      expect(tile.core.y + tile.core.height).toBeLessThanOrEqual(7_000);
      covered += tile.core.width * tile.core.height;
    }
    expect(covered).toBe(10_000 * 7_000);
    expect(grid.tiles[grid.tiles.length - 1].core).toEqual({ x: 8192, y: 4096, width: 1808, height: 2904 });
  });

  it('grows crops by the halo and clamps them to the frame', () => {
    const grid = planLensTiles(9_000, 5_000, 4096, 400);
    const corner = grid.tiles[0];
    expect(corner.crop).toEqual({ x: 0, y: 0, width: 4496, height: 4496 });
    const right = grid.tiles[2];
    expect(right.crop.x + right.crop.width).toBe(9_000);
    const interior = planLensTiles(20_000, 20_000, 4096, 400).tiles[1 + planLensTiles(20_000, 20_000, 4096, 400).columns];
    expect(interior.crop.width).toBe(4096 + 800);
    expect(interior.crop.height).toBe(4096 + 800);
  });

  it('never plans an edge below the minimum tile edge', () => {
    const grid = planLensTiles(2_000, 2_000, 10, 0);
    expect(grid.coreEdge).toBe(MIN_LENS_TILE_EDGE);
    expect(grid.columns).toBe(Math.ceil(2_000 / MIN_LENS_TILE_EDGE));
  });

  it('rejects invalid frame dimensions', () => {
    expect(() => planLensTiles(0, 100, 512, 8)).toThrow();
    expect(() => planLensTiles(100, 100.5, 512, 8)).toThrow();
  });
});

describe('createLensTileTemplate', () => {
  it('returns null for a neutral state', () => {
    expect(createLensTileTemplate(state({ enabled: false }), { width: 4_000, height: 3_000 }, CAPABILITY)).toBeNull();
    expect(createLensTileTemplate(state({ focusRange: 1 }), { width: 4_000, height: 3_000 }, CAPABILITY)).toBeNull();
  });

  it('matches the single-pass export plan for taps and CoC radius', () => {
    const frame = { width: 4_000, height: 3_000 };
    const plan = planLensBlur(state(), frame, CAPABILITY);
    const template = createLensTileTemplate(state(), frame, CAPABILITY);
    expect(plan).not.toBeNull();
    expect(template).not.toBeNull();
    if (!plan || !template) return;
    expect(template.taps.length).toBe(plan.tapCount);
    expect(template.maxCocPx).toBeCloseTo(plan.maxCocPx, 9);
    expect(template.maxCocShortSide).toBeCloseTo(plan.maxCocShortSide, 12);
    expect(template.psf).toEqual(plan.psf);
    expect(template.state.quality).toBe('export');
    let maxTapRadius = 0;
    for (const tap of template.taps) maxTapRadius = Math.max(maxTapRadius, Math.hypot(tap.offset.x, tap.offset.y));
    expect(template.halo).toBe(Math.ceil(template.maxCocPx * maxTapRadius) + 2);
    expect(template.halo).toBeGreaterThanOrEqual(Math.ceil(template.maxCocPx * maxTapRadius));
  });

  it('halo covers the PSF support of every tap', () => {
    const template = createLensTileTemplate(state({ aperture: 1.4 }), { width: 6_000, height: 4_000 }, CAPABILITY);
    expect(template).not.toBeNull();
    if (!template) return;
    for (const tap of template.taps) {
      const support = Math.hypot(tap.offset.x, tap.offset.y) * template.maxCocPx;
      expect(template.halo).toBeGreaterThanOrEqual(Math.ceil(support));
    }
  });

  it('honours the capability tap budget', () => {
    const template = createLensTileTemplate(state(), { width: 6_000, height: 4_000 }, { maxTextureSize: 8192, maxTaps: 7 });
    expect(template).not.toBeNull();
    expect(template?.taps.length).toBeGreaterThan(1);
    expect(template?.taps.length).toBeLessThanOrEqual(7);
    expect(createLensTileTemplate(state(), { width: 6_000, height: 4_000 }, { maxTextureSize: 8192, maxTaps: 1 })).toBeNull();
  });

  it('rejects an invalid capability', () => {
    expect(() => createLensTileTemplate(state(), { width: 100, height: 100 }, { maxTextureSize: 0 })).toThrow();
    expect(() => createLensTileTemplate(state(), { width: 0, height: 100 }, CAPABILITY)).toThrow();
  });
});

describe('planLensTileStage', () => {
  const frame = { width: 2_400, height: 1_800 };
  const template = createLensTileTemplate(state(), frame, CAPABILITY);

  it('keeps the full-frame CoC pixel radius in every crop', () => {
    if (!template) throw new Error('template missing');
    const grid = planLensTiles(frame.width, frame.height, 1_000, template.halo);
    for (const tile of grid.tiles) {
      const plan = planLensTileStage(template, frame, tile.crop);
      expect(plan.maxCocPx).toBe(template.maxCocPx);
      expect(plan.maxCocShortSide * Math.min(plan.width, plan.height)).toBeCloseTo(template.maxCocPx, 9);
      expect(plan.width).toBe(tile.crop.width);
      expect(plan.height).toBe(tile.crop.height);
      expect(plan.outputWidth).toBe(frame.width);
      expect(plan.outputHeight).toBe(frame.height);
      expect(plan.quality).toBe('export');
      expect(plan.tapCount).toBe(template.taps.length);
      expect(plan.psf).toBe(template.psf);
    }
  });

  it('disables the depth tap guard for the unguarded procedural field', () => {
    if (!template) throw new Error('template missing');
    expect(template.paintedDepth).toBe(false);
    const procedural = planLensTileStage(template, frame, { x: 0, y: 0, width: 300, height: 200 });
    expect(procedural.guardStrength).toBe(0);
    const masks = [radial(0.5, 0.5)];
    const painted = { ...template, paintedDepth: true, state: { ...template.state, depthMask: masks } };
    expect(planLensTileStage(painted, frame, { x: 0, y: 0, width: 300, height: 200 }).guardStrength).toBe(1);
  });

  it('slices the painted depth stack in global coordinates across a seam', () => {
    if (!template) throw new Error('template missing');
    const masks = [radial(0.5, 0.5), linear()];
    const painted = { ...template, state: { ...template.state, depthMask: masks } };
    const full = rasterizeDepthMask(masks, frame.width, frame.height);
    expect(full).not.toBeNull();
    if (!full) return;
    const grid = planLensTiles(frame.width, frame.height, 2_000, 64);
    for (const tile of grid.tiles) {
      const plan = planLensTileStage(painted, frame, tile.crop);
      expect(plan.depth).not.toBeNull();
      if (!plan.depth) continue;
      expect(maxAbsDiff(plan.depth, regionSlice(full, frame.width, tile.crop))).toBe(0);
    }
  });

  it('reuses the pooled depth buffer across crops', () => {
    if (!template) throw new Error('template missing');
    const masks = [radial(0.5, 0.5)];
    const painted = { ...template, state: { ...template.state, depthMask: masks } };
    const crop = { x: 700, y: 500, width: 600, height: 450 };
    const pool = new Float32Array(600 * 450);
    const plan = planLensTileStage(painted, frame, crop, pool);
    expect(plan.depth?.buffer).toBe(pool.buffer);
    expect(plan.depth?.length).toBe(pool.length);
    const again = planLensTileStage(painted, frame, crop, pool);
    expect(again.depth?.buffer).toBe(pool.buffer);
    expect(again.depth).toEqual(plan.depth);
  });

  it('falls back to procedural depth in global coordinates', () => {
    if (!template) throw new Error('template missing');
    const crop = { x: 1_500, y: 1_000, width: 900, height: 700 };
    const plan = planLensTileStage(template, frame, crop);
    expect(plan.depth).not.toBeNull();
    if (!plan.depth) return;
    for (let y = 0; y < crop.height; y += 97) {
      for (let x = 0; x < crop.width; x += 89) {
        const expected = proceduralDepth(
          (crop.x + x + 0.5) / frame.width,
          (crop.y + y + 0.5) / frame.height,
          frame.width,
          frame.height,
        );
        expect(plan.depth[y * crop.width + x]).toBeCloseTo(expected, 6);
      }
    }
  });

  it('rejects non-geometric depth masks', () => {
    if (!template) throw new Error('template missing');
    const luminance = { ...base, kind: 'luminance' as const, lo: 0.2, hi: 0.8, feather: 0.1 };
    expect(() =>
      planLensTileStage({ ...template, state: { ...template.state, depthMask: [luminance] } }, frame, {
        x: 0,
        y: 0,
        width: 256,
        height: 256,
      }),
    ).toThrow('brush, linear and radial');
  });
});

describe('composeMaskStackRegion', () => {
  it('matches the full-frame raster for geometric stacks', () => {
    const masks = [radial(0.5, 0.35), { ...linear(), blend: 'subtract' as const, opacity: 0.7 }];
    const width = 1_200;
    const height = 900;
    const full = composeMaskStack(masks, width, height);
    const region = { x: 311, y: 207, width: 377, height: 291 };
    const regional = composeMaskStackRegion(masks, width, height, region);
    expect(maxAbsDiff(regional, regionSlice(full, width, region))).toBe(0);
    const brush = [radial(0.7, 0.6)];
    const fullBrush = rasterizeMask(brush[0], width, height);
    expect(maxAbsDiff(composeMaskStackRegion(brush, width, height, region), regionSlice(fullBrush, width, region))).toBe(0);
  });

  it('reuses an output buffer of the exact size and re-fills larger ones', () => {
    const masks = [radial(0.5, 0.5)];
    const region = { x: 10, y: 20, width: 64, height: 48 };
    const out = new Float32Array(64 * 48);
    out.fill(5);
    const first = composeMaskStackRegion(masks, 400, 300, region, out);
    expect(first).toBe(out);
    expect(out[0]).not.toBe(5);
  });

  it('rejects non-geometric masks', () => {
    const color = {
      ...base,
      kind: 'color' as const,
      color: { r: 1, g: 0, b: 0 },
      hueRange: 0.1,
      satRange: 0.1,
      lumRange: 0.1,
      feather: 0.1,
    };
    expect(() => composeMaskStackRegion([color], 400, 300, { x: 0, y: 0, width: 8, height: 8 })).toThrow(
      'geometric masks only',
    );
  });
});

describe('shouldTileLensExport', () => {
  it('tiles only when an output dimension exceeds the texture limit', () => {
    expect(shouldTileLensExport({ width: 17_000, height: 1_200 }, 16_384)).toBe(true);
    expect(shouldTileLensExport({ width: 16_385, height: 1_200 }, 16_384)).toBe(true);
    expect(shouldTileLensExport({ width: 1_200, height: 17_000 }, 16_384)).toBe(true);
    expect(shouldTileLensExport({ width: 6_000, height: 4_000 }, 16_384)).toBe(false);
    expect(shouldTileLensExport({ width: 16_384, height: 16_384 }, 16_384)).toBe(false);
    expect(shouldTileLensExport({ width: 1_000, height: 1_000 }, 16_384)).toBe(false);
  });
});
