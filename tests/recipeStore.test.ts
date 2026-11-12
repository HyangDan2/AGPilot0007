import { describe, it, expect } from 'vitest';
import { validateRecipeJSON } from '../src/stores/recipeStore';

describe('Recipe Store & Schema Validation', () => {
  it('validates and parses a correct recipe JSON', () => {
    const validJson = JSON.stringify({
      id: 'rcp-test-01',
      name: 'Nordic Dawn',
      baseFilmId: 'FS-002',
      profileVersion: '1.0.0',
      adjustments: {
        exposure: 0.35,
        temperature: -10,
        tint: 5,
        contrast: 15,
        grain: 20,
      },
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      schemaVersion: 1,
    });

    const parsed = validateRecipeJSON(validJson);
    expect(parsed.name).toBe('Nordic Dawn');
    expect(parsed.baseFilmId).toBe('FS-002');
    expect(parsed.adjustments.exposure).toBe(0.35);
    expect(parsed.adjustments.contrast).toBe(15);
    expect(parsed.schemaVersion).toBe(3);
  });

  it('safely handles missing adjustment fields by merging defaults', () => {
    const partialJson = JSON.stringify({
      name: 'Minimal Recipe',
      baseFilmId: 'FS-001',
    });

    const parsed = validateRecipeJSON(partialJson);
    expect(parsed.name).toBe('Minimal Recipe');
    expect(parsed.baseFilmId).toBe('FS-001');
    expect(parsed.adjustments.exposure).toBe(0);
    expect(parsed.adjustments.saturation).toBe(0);
    expect(parsed.adjustments.filmStrength).toBe(100);
  });

  it('rejects malformed non-JSON strings with clear error', () => {
    expect(() => validateRecipeJSON('NOT_JSON_DATA')).toThrow(/Invalid JSON format/);
  });

  it('rejects JSON missing name or baseFilmId', () => {
    expect(() => validateRecipeJSON(JSON.stringify({ exposure: 1 }))).toThrow(/missing valid "name"/);
    expect(() => validateRecipeJSON(JSON.stringify({ name: 'Foo' }))).toThrow(/missing valid "baseFilmId"/);
  });
});
