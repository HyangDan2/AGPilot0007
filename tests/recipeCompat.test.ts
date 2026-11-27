import { describe, it, expect } from 'vitest';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import { IDENTITY_GEOMETRY, assertRecipeVersionSupported, toRecipeV8 } from '../src/engine/contracts';
import type { CustomRecipe } from '../src/types/film';

describe('Recipe feature registry compatibility (schemas 1-8)', () => {
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
      expect(parsed.schemaVersion).toBe(8);
      expect(parsed.geometry).toEqual(IDENTITY_GEOMETRY);
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
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 10 }))).toThrow(/Unsupported recipe version/);
  });

  it('round-trips v8 framing through JSON without losing values', () => {
    const geometry = {
      rotation: 270,
      straighten: -12.5,
      flipHorizontal: true,
      flipVertical: false,
      crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
    };
    const parsed = validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry }));
    expect(parsed.schemaVersion).toBe(8);
    expect(parsed.geometry).toEqual(geometry);
    const reparsed = validateRecipeJSON(JSON.stringify(parsed));
    expect(reparsed.schemaVersion).toBe(8);
    expect(reparsed.geometry).toEqual(geometry);
  });

  it('keeps valid v7 framing when upgrading instead of stripping it', () => {
    const geometry = { rotation: 90, straighten: 5, flipHorizontal: false, flipVertical: true, crop: null };
    const parsed = validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 7, geometry }));
    expect(parsed.schemaVersion).toBe(8);
    expect(parsed.geometry).toEqual(geometry);
  });

  it('rejects missing, malformed and unknown geometry instead of silently dropping it', () => {
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8 }))).toThrow(/geometry wrapper/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry: null }))).toThrow(/Invalid recipe geometry/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry: [{ rotation: 90 }] }))).toThrow(/Invalid recipe geometry/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry: { rotation: 45 } }))).toThrow(/Invalid geometry rotation/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry: { rotation: 90, straigthen: 4 } }))).toThrow(/Unknown recipe geometry field/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry: { crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5, rotation: 90 } } }))).toThrow(/Unknown recipe geometry crop field/);
  });

  it('never mutates a v7 payload or recipe while upgrading; older readers reject v8', () => {
    const raw = JSON.stringify({ ...base, id: 'legacy-v7', schemaVersion: 7 });
    const before = JSON.parse(raw);
    const first = validateRecipeJSON(raw);
    const second = validateRecipeJSON(raw);
    expect(JSON.parse(raw)).toEqual(before);
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(8);

    const v7Recipe = { ...first, schemaVersion: 7, geometry: undefined } as CustomRecipe;
    const copy = structuredClone(v7Recipe);
    const upgraded = toRecipeV8(v7Recipe);
    expect(v7Recipe).toEqual(copy);
    expect(upgraded.schemaVersion).toBe(8);

    expect(() => assertRecipeVersionSupported(8, 7)).toThrow(/Unsupported recipe version/);
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
