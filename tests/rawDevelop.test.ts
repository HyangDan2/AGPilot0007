// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RawMetadata } from 'flashraw';
import {
  defaultRawDevelopSettings,
  normalizeRawDevelop,
  rawDevelopIsIdentity,
  validateRawDevelop,
} from '../src/types/rawDevelop';
import {
  RAW_DEVELOP_SHADER_UNIFORMS,
  deriveForwardMatrixFromColorMatrices,
  rawDevelopDecodeOptions,
  rawWhiteBalanceMultipliers,
  readWhiteBalanceInfo,
} from '../src/engine/raw/rawDevelop';
import { apply3x3 } from '../src/engine/raw/cameraColor';

const IDENTITY_FORWARD = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function metadata(overrides: Partial<RawMetadata> = {}): RawMetadata {
  return {
    format: 'DNG',
    width: 100,
    height: 80,
    whiteBalance: [2, 1, 0.5, 1],
    whiteBalanceApplied: false,
    colorMatrices: {
      color: [{ illuminant: 21, temperature: 6500, rows: 3, values: IDENTITY_FORWARD }],
      forward: [{ illuminant: 21, temperature: 6500, rows: 3, values: IDENTITY_FORWARD }],
      calibration: [],
      analogBalance: [1, 1, 1],
      source: 'file',
    },
    dng: { baselineExposure: 0.5, asShotNeutral: [0.5, 1, 2], asShotWhiteXY: null },
    ...overrides,
  } as unknown as RawMetadata;
}

describe('raw develop settings', () => {
  it('normalises, validates and reports identity deterministically', () => {
    const base = defaultRawDevelopSettings(5200);
    expect(base).toEqual({ exposureEv: 0, temperatureK: 5200, tint: 0, highlightRecovery: 'off' });
    expect(rawDevelopIsIdentity(base, 5200)).toBe(true);
    expect(rawDevelopIsIdentity({ ...base, exposureEv: 0.5 }, 5200)).toBe(false);

    const normalized = normalizeRawDevelop(
      { exposureEv: 99, temperatureK: 10, tint: -500, highlightRecovery: 'bogus' as never },
      base,
    );
    expect(normalized).toEqual({ exposureEv: 5, temperatureK: 2000, tint: -100, highlightRecovery: 'off' });
    expect(validateRawDevelop({ exposureEv: Number.NaN })).toContain('exposureEv must be a finite number');
    expect(validateRawDevelop({ exposureEv: 9 })).toEqual(['exposureEv must be between -5 and 5']);
    expect(validateRawDevelop(base)).toEqual([]);
  });

  it('maps develop settings onto decoder options for preview and export', () => {
    const info = readWhiteBalanceInfo(metadata());
    const settings = defaultRawDevelopSettings(info.asShotTemperatureK);
    const wb = rawWhiteBalanceMultipliers(settings, info);
    const preview = rawDevelopDecodeOptions(settings, wb, 'preview');
    expect(preview).toMatchObject({ output: 'linear-rgb', sampleType: 'f16', tone: 'linear', demosaic: 'half-size', highlights: 'clip', exposure: 0 });
    expect(preview.whiteBalanceMultipliers).toEqual([2, 1, 0.5]);
    const exported = rawDevelopDecodeOptions({ ...settings, highlightRecovery: 'reconstruct', exposureEv: 1.25 }, wb, 'export');
    expect(exported).toMatchObject({ demosaic: 'auto', highlights: 'reconstruct', exposure: 1.25 });
    expect(RAW_DEVELOP_SHADER_UNIFORMS).toEqual({ exposureEv: 0, temperature: 0, tint: 0 });
  });
});

describe('white balance multipliers', () => {
  it('returns as-shot camera multipliers at the as-shot temperature', () => {
    const info = readWhiteBalanceInfo(metadata());
    const settings = defaultRawDevelopSettings(info.asShotTemperatureK);
    const result = rawWhiteBalanceMultipliers(settings, info);
    expect(result.status).toBe('as-shot');
    expect(result.multipliers[1]).toBe(1);
    expect(result.multipliers[0]).toBeCloseTo(2, 6);
    expect(result.multipliers[2]).toBeCloseTo(0.5, 6);
  });

  it('adapts temperature through the forward matrix deterministically', () => {
    const info = readWhiteBalanceInfo(metadata());
    const cool = rawWhiteBalanceMultipliers(defaultRawDevelopSettings(3000), info);
    const warm = rawWhiteBalanceMultipliers(defaultRawDevelopSettings(9000), info);
    expect(cool.status).toBe('adapted');
    expect(warm.status).toBe('adapted');
    expect(cool.multipliers[0]).toBeLessThan(warm.multipliers[0]);
    expect(cool.multipliers[2]).toBeGreaterThan(warm.multipliers[2]);
    const tinted = rawWhiteBalanceMultipliers({ ...defaultRawDevelopSettings(6000), tint: 40 }, info);
    expect(tinted.status).toBe('adapted');
    expect(tinted.multipliers[1]).toBe(1);
  });

  it('derives a D50 forward matrix from a D65 ColorMatrix with Bradford adaptation', () => {
    const derived = deriveForwardMatrixFromColorMatrices([
      { illuminant: 21, temperature: 6500, rows: 3, values: IDENTITY_FORWARD },
    ]);
    expect(derived).not.toBeNull();
    const d65 = [0.31271 / 0.32902, 1, (1 - 0.31271 - 0.32902) / 0.32902] as [number, number, number];
    const xyz = apply3x3(derived!.matrix, d65);
    const sum = xyz[0] + xyz[1] + xyz[2];
    expect(xyz[0] / sum).toBeCloseTo(0.34567, 3);
    expect(xyz[1] / sum).toBeCloseTo(0.3585, 3);
  });

  it('marks camera-applied and missing metadata instead of assuming', () => {
    const applied = readWhiteBalanceInfo(metadata({ whiteBalanceApplied: true }));
    const appliedResult = rawWhiteBalanceMultipliers(defaultRawDevelopSettings(9000), applied);
    expect(appliedResult.status).toBe('camera-applied');
    expect(appliedResult.multipliers).toEqual([1, 1, 1]);
    expect(appliedResult.warnings.join(' ')).toMatch(/already applied/i);

    const noNeutral = readWhiteBalanceInfo(metadata({ whiteBalance: null, dng: null }));
    expect(rawWhiteBalanceMultipliers(defaultRawDevelopSettings(6500), noNeutral).status).toBe('no-camera-neutral');

    const noForward = metadata();
    noForward.colorMatrices = { ...noForward.colorMatrices, forward: [], source: 'none' };
    const missing = readWhiteBalanceInfo(noForward);
    // CP4-07: a ColorMatrix exists, so the forward matrix is derived (Bradford).
    expect(missing.forwardDerived).toBe(true);
    const derivedResult = rawWhiteBalanceMultipliers(defaultRawDevelopSettings(3000), missing);
    expect(derivedResult.status).toBe('adapted');
    expect(derivedResult.warnings.join(' ')).toMatch(/derived from the file colour matrix/i);

    const noMatrices = metadata();
    noMatrices.colorMatrices = { ...noMatrices.colorMatrices, color: [], forward: [], source: 'none' };
    const stripped = readWhiteBalanceInfo(noMatrices);
    expect(stripped.forwardDerived).not.toBe(true);
    const fallback = rawWhiteBalanceMultipliers(defaultRawDevelopSettings(3000), stripped);
    expect(fallback.status).toBe('matrix-missing');
    expect(fallback.warnings.join(' ')).toMatch(/forward matrix missing/i);
  });
});
