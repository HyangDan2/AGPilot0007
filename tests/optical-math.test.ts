import { describe, it, expect } from 'vitest';
import {
  applyMat3,
  invertMat3,
  multiplyMat3,
  perspectiveCorrectionQuad,
  perspectiveCorrectionHomography,
  rotationHomography,
  solveHomography,
  unitSquareToQuad,
  type Mat3,
  type Vec2,
} from '../poc/optical/math/homography';
import {
  centeredToUv,
  correctedToSource,
  sourceToCorrected,
  uvToCentered,
  uvToShortSide,
  type OpticalGeometry,
} from '../poc/optical/math/coordinates';
import {
  distortNormalized,
  undistortNormalized,
} from '../poc/optical/math/distortion';
import { estimateSkewAngle } from '../poc/optical/math/skew';
import {
  composeMaskStack,
  evaluateMask,
  smoothstep,
  type LinearMask,
  type RadialMask,
  type BrushMask,
  type LuminanceMask,
  type ColorMask,
} from '../poc/optical/math/masks';
import {
  apertureTapWeights,
  blurRgbaReference,
  circleOfConfusion,
} from '../poc/optical/math/focus';

const rotatedGrid = (width: number, height: number, angleDeg: number): Float32Array => {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const period = 24;
  const cx = width / 2;
  const cy = height / 2;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xr = c * (x - cx) + s * (y - cy);
      const yr = -s * (x - cx) + c * (y - cy);
      const lineX = Math.abs(((xr % period) + period) % period) < 2;
      const lineY = Math.abs(((yr % period) + period) % period) < 2;
      out[y * width + x] = lineX || lineY ? 1 : 0.15;
    }
  }
  return out;
};

describe('homography', () => {
  it('solves the identity for unit-square correspondences', () => {
    const corners: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const h = solveHomography(corners, corners);
    const p = applyMat3(h, { x: 0.37, y: 0.81 });
    expect(p.x).toBeCloseTo(0.37, 12);
    expect(p.y).toBeCloseTo(0.81, 12);
  });

  it('round-trips an arbitrary quad through its inverse', () => {
    const quad: Vec2[] = [
      { x: 0.05, y: 0.02 },
      { x: 0.94, y: 0.08 },
      { x: 0.98, y: 0.91 },
      { x: 0.02, y: 0.97 },
    ];
    const h = unitSquareToQuad(quad);
    const inverse = invertMat3(h);
    const samples: Vec2[] = [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.8 },
    ];
    for (const p of samples) {
      const back = applyMat3(inverse, applyMat3(h, p));
      expect(back.x).toBeCloseTo(p.x, 10);
      expect(back.y).toBeCloseTo(p.y, 10);
    }
    const composed: Mat3 = multiplyMat3(h, inverse);
    expect(composed[0]).toBeCloseTo(1, 10);
    expect(composed[4]).toBeCloseTo(1, 10);
    expect(Math.abs(composed[1]) + Math.abs(composed[3])).toBeLessThan(1e-10);
  });

  it('maps vertical keystone correction to a narrower source top', () => {
    const quad = perspectiveCorrectionQuad(1, 0, 0.1);
    expect(quad[0].x).toBeCloseTo(0.1, 12);
    expect(quad[1].x).toBeCloseTo(0.9, 12);
    expect(quad[3].x).toBeCloseTo(0, 12);
    const h = perspectiveCorrectionHomography(1, 0, 0.1);
    const topCentre = applyMat3(h, { x: 0.5, y: 0 });
    expect(topCentre.x).toBeCloseTo(0.5, 12);
    expect(topCentre.y).toBeCloseTo(0, 12);
  });

  it('rotates sampling coordinates about the frame centre', () => {
    const h = rotationHomography(Math.PI / 2);
    const p = applyMat3(h, { x: 1, y: 0.5 });
    expect(p.x).toBeCloseTo(0.5, 12);
    expect(p.y).toBeCloseTo(1, 12);
  });
});

describe('lens distortion', () => {
  const params = { k1: 0.22, k2: -0.035, p1: 0.008, p2: -0.006 };

  it('inverts the Brown-Conrady model within 1e-7', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 0.6, y: -0.4 },
      { x: 0.9, y: 0.9 },
      { x: -0.7, y: 0.2 },
    ];
    for (const p of points) {
      const distorted = distortNormalized(p, params);
      const back = undistortNormalized(distorted, params);
      expect(Math.hypot(back.x - p.x, back.y - p.y)).toBeLessThan(1e-7);
    }
  });

  it('keeps the optical centre fixed', () => {
    const p = distortNormalized({ x: 0, y: 0 }, params);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
  });

  it('handles tangential-only distortion', () => {
    const tangential = { k1: 0, p1: 0.02, p2: -0.015 };
    const source = { x: 0.4, y: 0.3 };
    const back = undistortNormalized(distortNormalized(source, tangential), tangential);
    expect(Math.hypot(back.x - source.x, back.y - source.y)).toBeLessThan(1e-8);
  });
});

describe('automatic skew estimation', () => {
  it('recovers a +3 degree grid rotation within 0.3 degrees', () => {
    const width = 256;
    const height = 256;
    const result = estimateSkewAngle(rotatedGrid(width, height, 3), width, height);
    expect(Math.abs(result.angleDeg - 3)).toBeLessThan(0.3);
    expect(result.confidence).toBeGreaterThan(0.1);
  });

  it('recovers a -2 degree rotation', () => {
    const width = 256;
    const height = 256;
    const result = estimateSkewAngle(rotatedGrid(width, height, -2), width, height);
    expect(Math.abs(result.angleDeg + 2)).toBeLessThan(0.3);
  });

  it('returns near zero for an axis-aligned grid', () => {
    const width = 256;
    const height = 256;
    const result = estimateSkewAngle(rotatedGrid(width, height, 0), width, height);
    expect(Math.abs(result.angleDeg)).toBeLessThan(0.3);
  });
});

describe('optical coordinate registration', () => {
  it('composes homography and distortion in both directions', () => {
    const geometry: OpticalGeometry = {
      homography: perspectiveCorrectionHomography(0.6, -0.3, 0.12),
      distortion: { k1: 0.18, k2: -0.02 },
    };
    const samples: Vec2[] = [
      { x: 0.2, y: 0.25 },
      { x: 0.5, y: 0.5 },
      { x: 0.78, y: 0.65 },
    ];
    for (const source of samples) {
      const corrected = sourceToCorrected(source, geometry);
      const back = correctedToSource(corrected, geometry);
      expect(Math.hypot(back.x - source.x, back.y - source.y)).toBeLessThan(1e-6);
    }
  });

  it('keeps a mask aligned to a source point after geometry correction', () => {
    const aspect = 3 / 2;
    const geometry: OpticalGeometry = {
      homography: perspectiveCorrectionHomography(0.8, 0.2, 0.1),
    };
    const sourcePoint: Vec2 = { x: 0.4, y: 0.3 };
    const correctedPoint = sourceToCorrected(sourcePoint, geometry);
    const mask: RadialMask = {
      id: 'align',
      kind: 'radial',
      enabled: true,
      center: correctedPoint,
      radiusX: 0.1,
      radiusY: 0.1,
      rotation: 0,
      feather: 0.2,
    };
    expect(evaluateMask(mask, correctedPoint, aspect)).toBeCloseTo(1, 12);
    expect(evaluateMask(mask, { x: correctedPoint.x + 0.4, y: correctedPoint.y }, aspect)).toBe(0);
    const back = correctedToSource(correctedPoint, geometry);
    expect(Math.hypot(back.x - sourcePoint.x, back.y - sourcePoint.y)).toBeLessThan(1e-9);
  });

  it('is resolution independent because NIS has no pixel units', () => {
    const uv: Vec2 = { x: 0.63, y: 0.27 };
    expect(centeredToUv(uvToCentered(uv)).x).toBeCloseTo(uv.x, 12);
    expect(centeredToUv(uvToCentered(uv)).y).toBeCloseTo(uv.y, 12);
    const a = uvToShortSide(uv, 2);
    const b = uvToShortSide(uv, 2);
    expect(a).toEqual(b);
  });
});

describe('masks and feathering', () => {
  const aspect = 4 / 3;

  it('smoothstep is clamped and monotonic', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const value = smoothstep(0, 1, i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('linear mask ramps across the segment and honours hard feather', () => {
    const mask: LinearMask = {
      id: 'lin',
      kind: 'linear',
      enabled: true,
      start: { x: 0.2, y: 0.5 },
      end: { x: 0.8, y: 0.5 },
      feather: 1,
    };
    const low = evaluateMask(mask, { x: 0.2, y: 0.5 }, aspect);
    const mid = evaluateMask(mask, { x: 0.5, y: 0.5 }, aspect);
    const high = evaluateMask(mask, { x: 0.8, y: 0.5 }, aspect);
    expect(low).toBeCloseTo(0, 6);
    expect(mid).toBeCloseTo(0.5, 6);
    expect(high).toBeCloseTo(1, 6);
    const hard: LinearMask = { ...mask, feather: 0 };
    expect(evaluateMask(hard, { x: 0.49, y: 0.5 }, aspect)).toBe(0);
    expect(evaluateMask(hard, { x: 0.51, y: 0.5 }, aspect)).toBe(1);
  });

  it('radial mask is one at the centre and zero outside with feathering', () => {
    const mask: RadialMask = {
      id: 'rad',
      kind: 'radial',
      enabled: true,
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      radiusY: 0.2,
      rotation: 0,
      feather: 0.5,
    };
    expect(evaluateMask(mask, { x: 0.5, y: 0.5 }, aspect)).toBe(1);
    const edge = evaluateMask(mask, { x: 0.5 + (0.2 * 0.9) / (4 / 3), y: 0.5 }, aspect);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(evaluateMask(mask, { x: 0.5 + 0.6, y: 0.5 }, aspect)).toBe(0);
  });

  it('brush mask follows stroke geometry and hardness', () => {
    const mask: BrushMask = {
      id: 'brush',
      kind: 'brush',
      enabled: true,
      strokes: [
        {
          points: [
            { x: 0.2, y: 0.5 },
            { x: 0.8, y: 0.5 },
          ],
          radius: 0.08,
          hardness: 1,
          flow: 1,
        },
      ],
    };
    expect(evaluateMask(mask, { x: 0.5, y: 0.5 }, aspect)).toBeCloseTo(1, 6);
    expect(evaluateMask(mask, { x: 0.5, y: 0.9 }, aspect)).toBe(0);
  });

  it('luminance and colour ranges select samples', () => {
    const luma: LuminanceMask = {
      id: 'lum',
      kind: 'luminance',
      enabled: true,
      lo: 0.2,
      hi: 0.6,
      feather: 0.05,
    };
    expect(evaluateMask(luma, { x: 0.5, y: 0.5 }, aspect, { r: 0.4, g: 0.4, b: 0.4 })).toBe(1);
    expect(evaluateMask(luma, { x: 0.5, y: 0.5 }, aspect, { r: 0.95, g: 0.95, b: 0.95 })).toBe(0);
    expect(evaluateMask(luma, { x: 0.5, y: 0.5 }, aspect, { r: 0.1, g: 0.1, b: 0.1 })).toBe(0);
    const belowEdge = evaluateMask(luma, { x: 0.5, y: 0.5 }, aspect, { r: 0.19, g: 0.19, b: 0.19 });
    expect(belowEdge).toBeGreaterThan(0.8);
    expect(belowEdge).toBeLessThan(1);
    const aboveEdge = evaluateMask(luma, { x: 0.5, y: 0.5 }, aspect, { r: 0.62, g: 0.62, b: 0.62 });
    expect(aboveEdge).toBeGreaterThan(0);
    expect(aboveEdge).toBeLessThan(0.8);
    const color: ColorMask = {
      id: 'color',
      kind: 'color',
      enabled: true,
      color: { r: 0.8, g: 0.2, b: 0.2 },
      hueRange: 12,
      satRange: 0.35,
      lumRange: 0.4,
      feather: 0.1,
    };
    expect(evaluateMask(color, { x: 0.5, y: 0.5 }, aspect, { r: 0.85, g: 0.25, b: 0.22 })).toBeGreaterThan(0.5);
    expect(evaluateMask(color, { x: 0.5, y: 0.5 }, aspect, { r: 0.2, g: 0.3, b: 0.8 })).toBe(0);
  });

  it('composes add, subtract and intersect stacks', () => {
    const a: RadialMask = {
      id: 'a',
      kind: 'radial',
      enabled: true,
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.25,
      radiusY: 0.25,
      rotation: 0,
      feather: 0.2,
    };
    const b: RadialMask = {
      ...a,
      id: 'b',
      blend: 'subtract',
    };
    const p = { x: 0.5, y: 0.5 };
    expect(composeMaskStack([a], p, aspect)).toBeCloseTo(1, 6);
    expect(composeMaskStack([a, b], p, aspect)).toBeCloseTo(0, 6);
    const intersect = composeMaskStack([a], p, aspect, { r: 1, g: 1, b: 1 }, 1);
    expect(intersect).toBeCloseTo(1, 6);
  });
});

describe('virtual defocus and bokeh PSF', () => {
  const aspect = 4 / 3;

  it('normalizes aperture taps to unit energy', () => {
    for (const aperture of [
      { blades: 6, rotation: 0.2, roundness: 0 },
      { blades: 5, rotation: 0, roundness: 0.4 },
      { blades: 8, rotation: 0.1, roundness: 1 },
    ]) {
      const taps = apertureTapWeights(aperture, 64);
      const sum = taps.reduce((s, t) => s + t.weight, 0);
      expect(sum).toBeCloseTo(1, 12);
      expect(taps.length).toBeGreaterThan(10);
    }
  });

  it('zero CoC is an exact bypass', () => {
    const width = 16;
    const height = 12;
    const src = new Float32Array(width * height * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = (i / 4) % 2 === 0 ? 0.25 : 0.75;
      src[i + 1] = 0.5;
      src[i + 2] = 0.1;
      src[i + 3] = 1;
    }
    const out = blurRgbaReference(
      src,
      width,
      height,
      { center: { x: 0.5, y: 0.5 }, focusRadius: 1, falloff: 0.1, maxCoc: 0.02 },
      { blades: 6, rotation: 0, roundness: 0.2 }
    );
    expect(out).toEqual(src);
  });

  it('preserves a flat field and total energy', () => {
    const width = 24;
    const height = 18;
    const src = new Float32Array(width * height * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 0.4;
      src[i + 1] = 0.45;
      src[i + 2] = 0.5;
      src[i + 3] = 1;
    }
    const focus = { center: { x: 0.05, y: 0.05 }, focusRadius: 0.02, falloff: 0.1, maxCoc: 0.06 };
    const out = blurRgbaReference(src, width, height, focus, { blades: 6, rotation: 0.3, roundness: 0.1 }, { taps: 32 });
    let energyIn = 0;
    let energyOut = 0;
    for (let i = 0; i < src.length; i += 4) {
      energyIn += src[i];
      energyOut += out[i];
      expect(out[i]).toBeCloseTo(0.4, 3);
    }
    expect(energyOut).toBeCloseTo(energyIn, 2);
  });

  it('shapes a point source into an aperture footprint', () => {
    const width = 31;
    const height = 31;
    const src = new Float32Array(width * height * 4);
    const centre = (15 * width + 15) * 4;
    src[centre] = 1;
    src[centre + 3] = 1;
    const focus = { center: { x: -10, y: -10 }, focusRadius: 0, falloff: 1, maxCoc: 0.25 };
    const out = blurRgbaReference(src, width, height, focus, { blades: 6, rotation: 0, roundness: 0 }, { taps: 64 });
    let sum = 0;
    let farCorner = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        sum += out[(y * width + x) * 4];
        if (Math.abs(x - 15) === 8 && Math.abs(y - 15) === 8) {
          farCorner = Math.max(farCorner, out[(y * width + x) * 4]);
        }
      }
    }
    expect(sum).toBeGreaterThan(0.85);
    expect(sum).toBeLessThan(1.15);
    expect(farCorner).toBeLessThan(0.02);
  });

  it('circle of confusion grows monotonically away from the focus zone', () => {
    const focus = { center: { x: 0.5, y: 0.5 }, focusRadius: 0.05, falloff: 0.3, maxCoc: 0.08 };
    const near = circleOfConfusion({ x: 0.5, y: 0.5 }, focus, aspect);
    const mid = circleOfConfusion({ x: 0.5, y: 0.65 }, focus, aspect);
    const far = circleOfConfusion({ x: 0.9, y: 0.9 }, focus, aspect);
    expect(near).toBe(0);
    expect(mid).toBeGreaterThan(0);
    expect(far).toBeGreaterThanOrEqual(mid);
    expect(far).toBeLessThanOrEqual(0.08 + 1e-12);
  });
});

describe('CPU reference performance smoke', () => {
  it('logs timings for the PoC workload', () => {
    const quad: Vec2[] = [
      { x: 0.02, y: 0.01 },
      { x: 0.97, y: 0.03 },
      { x: 0.99, y: 0.96 },
      { x: 0.01, y: 0.99 },
    ];
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) unitSquareToQuad(quad);
    const homographyMs = performance.now() - t0;

    const mask: RadialMask = {
      id: 'perf',
      kind: 'radial',
      enabled: true,
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.3,
      radiusY: 0.2,
      rotation: 0.4,
      feather: 0.4,
    };
    const t1 = performance.now();
    let acc = 0;
    for (let i = 0; i < 200000; i++) {
      acc += evaluateMask(mask, { x: (i % 997) / 997, y: (i % 991) / 991 }, 3 / 2);
    }
    const maskMs = performance.now() - t1;

    const width = 128;
    const height = 96;
    const src = new Float32Array(width * height * 4).fill(0.5);
    const t2 = performance.now();
    blurRgbaReference(
      src,
      width,
      height,
      { center: { x: 0.5, y: 0.5 }, focusRadius: 0.1, falloff: 0.5, maxCoc: 0.05 },
      { blades: 6, rotation: 0, roundness: 0.2 },
      { taps: 64 }
    );
    const blurMs = performance.now() - t2;

    console.log(
      `[optical-cpu] homography_solve_x2000=${homographyMs.toFixed(1)}ms mask_eval_x200000=${maskMs.toFixed(1)}ms blur_128x96_64taps=${blurMs.toFixed(1)}ms checksum=${acc.toFixed(3)}`
    );
    expect(homographyMs).toBeGreaterThanOrEqual(0);
    expect(maskMs).toBeGreaterThanOrEqual(0);
    expect(blurMs).toBeGreaterThanOrEqual(0);
  });
});
