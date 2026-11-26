import { describe, it, expect } from 'vitest';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';

describe('Recipe feature registry compatibility (schemas 1-7)', () => {
  const base = {
    name: 'Compat recipe',
    baseFilmId: 'FS-001',
    profileVersion: '1.0.0',
    adjustments: { exposure: 0.4, contrast: 12, sharpness: 35 },
    camera: { dateStamp: { enabled: true, date: '2026-11-26' }, optics: { glow: 10, halation: 5, softness: 4, quality: 'high' } },
    curves: { white: [[0, 0], [0.5, 0.6], [1, 1]], red: [[0, 0], [1, 1]] },
    sharpening: { amount: 40, radius: 1.2, detail: 30, masking: 10, mode: 'advanced' },
    colorMixer: { enabled: true, points: [] },
  };

  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    it(`migrates schema ${version} to the current version`, () => {
      const parsed = validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: version }));
      expect(parsed.schemaVersion).toBe(7);
      expect(parsed.adjustments.exposure).toBe(0.4);
      expect(parsed.curves?.white).toEqual([[0, 0], [0.5, 0.6], [1, 1]]);
      expect(parsed.sharpening?.amount).toBe(40);
      expect(parsed.camera?.dateStamp.enabled).toBe(true);
      expect(parsed.colorMixer?.enabled).toBe(true);
    });
  }

  it('fills missing feature groups with neutral values', () => {
    const parsed = validateRecipeJSON(JSON.stringify({ name: 'Legacy v1', baseFilmId: 'FS-002', schemaVersion: 1 }));
    expect(parsed.camera?.dateStamp.enabled).toBe(false);
    expect(parsed.curves?.white).toEqual([[0, 0], [1, 1]]);
    expect(parsed.sharpening?.amount).toBe(0);
    expect(parsed.colorMixer?.points).toEqual([]);
  });

  it('maps a legacy sharpness value into the legacy sharpening mode', () => {
    const parsed = validateRecipeJSON(JSON.stringify({
      name: 'Legacy sharpness',
      baseFilmId: 'FS-001',
      schemaVersion: 6,
      adjustments: { ...DEFAULT_ADJUSTMENTS, sharpness: 45 },
    }));
    expect(parsed.sharpening).toMatchObject({ amount: 45, mode: 'legacy' });
  });

  it('rejects future schema versions', () => {
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8 }))).toThrow(/Unsupported recipe version/);
  });

  it('rejects invalid camera, curve, sharpening and mixer payloads through the registry', () => {
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, camera: { dateStamp: { enabled: true, date: '2026-02-31' } } }))).toThrow(/Invalid imprint date/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, curves: { white: [[0.5, 0.5]] } }))).toThrow(/Invalid tone curve points/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, curves: null }))).toThrow(/Invalid tone curves/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, sharpening: { amount: 10, mode: 'turbo' } }))).toThrow(/Invalid sharpening mode/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, sharpening: { amount: 500 } }))).toThrow(/Invalid sharpening value/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, colorMixer: { points: 'nope' } }))).toThrow(/Invalid point colors/);
  });
});
