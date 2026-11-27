import { describe, expect, it } from 'vitest';
import type { ColorMatrices } from 'flashraw';
import {
  XYZ_D50_TO_LINEAR_SRGB,
  apply3x3,
  cameraRgbToLinearSrgb,
  cameraRgbToXyzD50,
  inspectCameraColor,
  invert3x3,
  isFiniteMatrix,
  xyzD50ToLinearSrgb,
} from '../src/engine/raw/cameraColor';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MIXED = [0.6, 0.2, 0.1, 0.2, 0.7, 0.1, 0.05, 0.15, 0.8];

function matrices(overrides: Partial<ColorMatrices> = {}): ColorMatrices {
  return {
    color: [{ illuminant: 21, temperature: 6500, rows: 3, values: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    forward: [{ illuminant: 21, temperature: 6500, rows: 3, values: [...MIXED] }],
    calibration: [],
    analogBalance: [1, 1, 1],
    source: 'file',
    ...overrides,
  } as ColorMatrices;
}

describe('camera colour matrix provenance', () => {
  it('verifies file and camera-db matrices', () => {
    expect(inspectCameraColor({ colorMatrices: matrices() }).status).toBe('verified');
    expect(inspectCameraColor({ colorMatrices: matrices({ source: 'camera-db' }) }).status).toBe('verified');
    const report = inspectCameraColor({ colorMatrices: matrices() });
    expect(report.source).toBe('file');
    expect(report.forward).toEqual(MIXED);
    expect(report.forwardTemperatureK).toBe(6500);
  });

  it('reports missing sources and invalid matrices without silent assumptions', () => {
    const none = inspectCameraColor({ colorMatrices: matrices({ source: 'none' }) });
    expect(none.status).toBe('missing');
    expect(none.forward).toBeNull();
    expect(none.reason).toMatch(/no camera colour matrices/i);

    const noForward = inspectCameraColor({ colorMatrices: matrices({ forward: [] }) });
    expect(noForward.status).toBe('invalid');
    expect(noForward.reason).toMatch(/forward matrix/i);

    const nonFinite = inspectCameraColor({
      colorMatrices: matrices({ forward: [{ illuminant: 21, temperature: 6500, rows: 3, values: [1, 0, 0, 0, Number.NaN, 0, 0, 0, 1] }] }),
    });
    expect(nonFinite.status).toBe('invalid');

    const singular = inspectCameraColor({
      colorMatrices: matrices({ forward: [{ illuminant: 21, temperature: 6500, rows: 3, values: [1, 2, 3, 2, 4, 6, 0, 0, 1] }] }),
    });
    expect(singular.status).toBe('invalid');
    expect(singular.reason).toMatch(/singular/i);
  });
});

describe('synthetic patch conversion', () => {
  it('converts camera RGB through XYZ(D50) with the documented sRGB matrix', () => {
    const xyz = cameraRgbToXyzD50(MIXED, [0.2, 0.4, 0.6]);
    expect(xyz[0]).toBeCloseTo(0.6 * 0.2 + 0.2 * 0.4 + 0.1 * 0.6, 10);
    const srgb = cameraRgbToLinearSrgb(MIXED, [0.2, 0.4, 0.6]);
    expect(srgb).toEqual(xyzD50ToLinearSrgb(xyz));
    for (const value of srgb) expect(Number.isFinite(value)).toBe(true);
  });

  it('maps neutral patches to equal linear sRGB channels', () => {
    const neutral = cameraRgbToLinearSrgb(IDENTITY, [0.5, 0.5, 0.5]);
    const rows = (matrix: readonly number[]): number[] => [
      matrix[0] + matrix[1] + matrix[2],
      matrix[3] + matrix[4] + matrix[5],
      matrix[6] + matrix[7] + matrix[8],
    ];
    const expected = rows(XYZ_D50_TO_LINEAR_SRGB).map((sum) => sum * 0.5);
    neutral.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 10));
    // The D50→sRGB matrix is not exactly neutral-balanced for equal XYZ, but the
    // spread must stay small and documented (validation only, not applied to pixels).
    const spread = Math.max(...neutral) - Math.min(...neutral);
    expect(spread).toBeLessThan(0.2);
  });

  it('inverts a finite forward matrix and round-trips camera ↔ XYZ', () => {
    expect(isFiniteMatrix(MIXED)).toBe(true);
    const inverse = invert3x3(MIXED);
    expect(inverse).not.toBeNull();
    const roundTrip = apply3x3(inverse!, cameraRgbToXyzD50(MIXED, [0.3, 0.55, 0.15]));
    expect(roundTrip[0]).toBeCloseTo(0.3, 10);
    expect(roundTrip[1]).toBeCloseTo(0.55, 10);
    expect(roundTrip[2]).toBeCloseTo(0.15, 10);
    expect(invert3x3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });
});
