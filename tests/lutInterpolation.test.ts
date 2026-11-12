import { describe, it, expect } from 'vitest';
import { sampleLut3DTrilinear } from '../src/engine/color/lutInterpolation';
import { ParsedLut3D } from '../src/engine/color/lutLoader';

describe('3D LUT Trilinear Interpolation', () => {
  // Construct an exact 33x33x33 identity LUT
  const size = 33;
  const total = size * size * size;
  const floatData = new Float32Array(total * 3);
  const rgbaData = new Uint8Array(total * 4);

  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const fr = r / (size - 1);
        const fg = g / (size - 1);
        const fb = b / (size - 1);

        floatData[idx * 3] = fr;
        floatData[idx * 3 + 1] = fg;
        floatData[idx * 3 + 2] = fb;

        rgbaData[idx * 4] = Math.round(fr * 255);
        rgbaData[idx * 4 + 1] = Math.round(fg * 255);
        rgbaData[idx * 4 + 2] = Math.round(fb * 255);
        rgbaData[idx * 4 + 3] = 255;
        idx++;
      }
    }
  }

  const identityLut: ParsedLut3D = {
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    floatData,
    rgbaData,
  };

  it('preserves exact corner colors on identity LUT', () => {
    expect(sampleLut3DTrilinear(identityLut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(sampleLut3DTrilinear(identityLut, 1, 0, 0)).toEqual([1, 0, 0]);
    expect(sampleLut3DTrilinear(identityLut, 0, 1, 0)).toEqual([0, 1, 0]);
    expect(sampleLut3DTrilinear(identityLut, 0, 0, 1)).toEqual([0, 0, 1]);
    expect(sampleLut3DTrilinear(identityLut, 1, 1, 1)).toEqual([1, 1, 1]);
  });

  it('interpolates intermediate fractional values with high accuracy (< 1e-4)', () => {
    const testPoints = [
      [0.25, 0.5, 0.75],
      [0.123, 0.456, 0.789],
      [0.333, 0.666, 0.999],
      [0.5, 0.5, 0.5],
    ];

    for (const [r, g, b] of testPoints) {
      const sampled = sampleLut3DTrilinear(identityLut, r, g, b);
      expect(Math.abs(sampled[0] - r)).toBeLessThan(1e-4);
      expect(Math.abs(sampled[1] - g)).toBeLessThan(1e-4);
      expect(Math.abs(sampled[2] - b)).toBeLessThan(1e-4);
    }
  });

  it('clamps out-of-bounds negative and > 1 inputs safely', () => {
    const below = sampleLut3DTrilinear(identityLut, -0.5, -0.2, 0.5);
    expect(below[0]).toBe(0.0);
    expect(below[1]).toBe(0.0);
    expect(below[2]).toBeCloseTo(0.5, 4);

    const above = sampleLut3DTrilinear(identityLut, 1.5, 0.5, 1.2);
    expect(above[0]).toBe(1.0);
    expect(above[1]).toBeCloseTo(0.5, 4);
    expect(above[2]).toBe(1.0);
  });
});
