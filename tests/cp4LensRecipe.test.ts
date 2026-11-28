import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore as store } from '../src/stores/editorStore';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { normalizeLensBlur } from '../src/engine/contracts/lensBlur';
import { normalizeDevelop } from '../src/engine/contracts/develop';
import { IDENTITY_GEOMETRY } from '../src/engine/contracts/geometry';

const activeLensBlur = normalizeLensBlur({
  enabled: true,
  focusPlane: 0.35,
  focusRange: 0.15,
  aperture: 2,
  bladeCount: 7,
  rotationDeg: 12,
  highlightBoost: 0.6,
  depthMask: [
    {
      id: 'd1',
      name: 'Depth',
      enabled: true,
      blend: 'add',
      opacity: 1,
      inverted: false,
      kind: 'radial',
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.3,
      radiusY: 0.4,
      rotation: 0,
      feather: 0.2,
    },
  ],
});

const customDevelop = normalizeDevelop({
  wb: { mode: 'custom', temperatureK: 5600, tint: 12 },
  exposureEV: 0.5,
  highlightRecovery: 0.4,
});

const baseRecipe = { name: 'V10', baseFilmId: 'FS-001', profileVersion: '1.0.0', adjustments: {}, createdAt: 1, updatedAt: 1 };

describe('CP4-06 lens blur recipe round trip', () => {
  beforeEach(() => {
    store.setState(store.getInitialState(), true);
  });

  it('stays on v8 while lens blur is disabled', async () => {
    const saved = await store.getState().saveCurrentAsRecipe('Neutral lens');
    expect(saved.schemaVersion).toBe(8);
    expect(saved.lensBlur).toBeUndefined();
    expect(saved.develop).toBeUndefined();
  });

  it('writes an active lens blur as v10 and restores it on apply', async () => {
    store.getState().setLensBlur(activeLensBlur);
    const saved = await store.getState().saveCurrentAsRecipe('Bokeh');
    expect(saved.schemaVersion).toBe(10);
    expect(saved.lensBlur).toEqual(activeLensBlur);

    const parsed = validateRecipeJSON(JSON.stringify(saved));
    expect(parsed.schemaVersion).toBe(10);
    expect(parsed.lensBlur).toEqual(activeLensBlur);

    store.setState({ lensBlur: normalizeLensBlur({}) });
    store.getState().applyRecipe(parsed);
    expect(store.getState().lensBlur).toEqual(activeLensBlur);
  });

  it('applies recipe develop only when a RAW image supplies the develop baseline', () => {
    const recipe = validateRecipeJSON(
      JSON.stringify({
        ...baseRecipe,
        schemaVersion: 10,
        geometry: IDENTITY_GEOMETRY,
        lensBlur: activeLensBlur,
        develop: customDevelop,
      }),
    );
    expect(recipe.develop).toEqual(customDevelop);

    store.getState().applyRecipe(recipe);
    expect(store.getState().lensBlur).toEqual(activeLensBlur);
    // No RAW source is open: the display develop state must stay null instead
    // of shadowing the decoder baseline.
    expect(store.getState().rawDevelop).toBeNull();
    expect(store.getState().develop).toBeNull();
  });

  it('rejects v10 fields under an older schema', () => {
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...baseRecipe, schemaVersion: 9, geometry: IDENTITY_GEOMETRY, lensBlur: activeLensBlur })),
    ).toThrow(/Unexpected v10 field/);
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...baseRecipe, schemaVersion: 9, geometry: IDENTITY_GEOMETRY, develop: customDevelop })),
    ).toThrow(/Unexpected v10 field/);
  });
});
