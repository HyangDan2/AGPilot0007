import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore as store } from '../src/stores/editorStore';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { IDENTITY_GEOMETRY } from '../src/engine/contracts/geometry';
import type { GeometryTransform } from '../src/engine/contracts/geometry';
import type { OpticalTransform } from '../src/engine/contracts/optical';
import type { LocalAdjustmentState } from '../src/engine/contracts/localAdjustments';
import type { DecodedImage } from '../src/engine/image/decoder';

const framed: GeometryTransform = {
  ...IDENTITY_GEOMETRY,
  rotation: 90,
  straighten: 4,
  flipHorizontal: true,
};

const opticalShift: OpticalTransform = {
  version: 1,
  homography: [1, 0, 0.01, 0, 1, 0, 0, 0, 1],
};

const localActive: LocalAdjustmentState = {
  enabled: true,
  groups: [
    {
      id: 'g1',
      name: 'Sky',
      enabled: true,
      masks: [
        {
          id: 'm1',
          name: 'Sky linear',
          enabled: true,
          blend: 'add',
          opacity: 1,
          inverted: false,
          kind: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          feather: 0.2,
        },
      ],
      adjustment: { exposure: 0.5 },
      opacity: 1,
      blend: 'add',
    },
  ],
};

const image = { name: 'frame.jpg', sourceUrl: '', originalWidth: 10, originalHeight: 8, previewWidth: 10, previewHeight: 8 } as unknown as DecodedImage;

beforeEach(() => store.setState(store.getInitialState(), true));

describe('CP3 framing state and history', () => {
  it('groups a geometry gesture into one undo entry and non-commits stay out of history', async () => {
    const start = store.getState().history.length;
    store.getState().setGeometry({ ...framed, rotation: 0, straighten: 1 }, false);
    store.getState().setGeometry({ ...framed, rotation: 0, straighten: 2 }, false);
    expect(store.getState().history.length).toBe(start);
    store.getState().setGeometry(framed);
    expect(store.getState().history.length).toBe(start + 1);
    store.getState().undo();
    expect(store.getState().geometry.straighten).toBe(0);
    expect(store.getState().geometry.rotation).toBe(0);
    store.getState().redo();
    expect(store.getState().geometry).toEqual(framed);
  });

  it('restores geometry, optical, and local adjustments through undo/redo', () => {
    store.getState().setGeometry(framed);
    store.getState().setOptical(opticalShift);
    store.getState().setLocalAdjustments(localActive);
    expect(store.getState().history.length).toBe(4);
    store.getState().undo();
    expect(store.getState().optical).toEqual(opticalShift);
    expect(store.getState().localAdjustments).toEqual(store.getInitialState().localAdjustments);
    store.getState().undo();
    expect(store.getState().optical).toBeNull();
    expect(store.getState().geometry).toEqual(framed);
    store.getState().undo();
    expect(store.getState().geometry).toEqual(IDENTITY_GEOMETRY);
    store.getState().redo();
    store.getState().redo();
    expect(store.getState().optical).toEqual(opticalShift);
  });

  it('resets framing groups on a new image and clears undo', () => {
    store.getState().setGeometry(framed);
    store.getState().setOptical(opticalShift);
    store.getState().setLocalAdjustments(localActive);
    store.getState().setImage(image);
    expect(store.getState().geometry).toEqual(IDENTITY_GEOMETRY);
    expect(store.getState().optical).toBeNull();
    expect(store.getState().localAdjustments.groups).toEqual([]);
    expect(store.getState().canUndo).toBe(false);
  });

  it('applies a multi-group patch as one entry and leaves unspecified groups untouched', () => {
    store.getState().setSharpening({ ...store.getState().sharpening, amount: 42 });
    const before = store.getState().history.length;
    store.getState().applyParameterGroups({
      film: { filmId: 'FS-002' },
      geometry: framed,
      optical: opticalShift,
      localAdjustments: localActive,
    });
    expect(store.getState().history.length).toBe(before + 1);
    expect(store.getState().activeFilmId).toBe('FS-002');
    expect(store.getState().activePresetId).toBeNull();
    expect(store.getState().sharpening.amount).toBe(42);
    expect(store.getState().geometry).toEqual(framed);
    expect(store.getState().optical).toEqual(opticalShift);
    expect(store.getState().localAdjustments.groups).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().activeFilmId).not.toBe('FS-002');
    expect(store.getState().geometry).toEqual(IDENTITY_GEOMETRY);
    expect(store.getState().optical).toBeNull();
  });

  it('ignores an unknown film and clears a preset that belongs to another film', () => {
    store.getState().applyMargarine('soft-white');
    const presetId = store.getState().activePresetId;
    expect(presetId).toBeTruthy();
    store.getState().applyParameterGroups({ film: { filmId: 'NOPE' as never } });
    expect(store.getState().activePresetId).toBe(presetId);
    store.getState().applyParameterGroups({ film: { filmId: 'FS-003' } });
    expect(store.getState().activeFilmId).toBe('FS-003');
    expect(store.getState().activePresetId).toBeNull();
  });
});

describe('CP3 recipe v8/v9 write and apply', () => {
  it('writes live geometry into a v8 recipe and restores it on apply', async () => {
    store.getState().setGeometry(framed);
    const saved = await store.getState().saveCurrentAsRecipe('Framed');
    expect(saved.schemaVersion).toBe(8);
    expect(saved.geometry).toEqual(framed);
    expect(saved.optical).toBeUndefined();
    const parsed = validateRecipeJSON(JSON.stringify(saved));
    expect(parsed.geometry).toEqual(framed);
    store.getState().resetGeometry();
    store.getState().applyRecipe(parsed);
    expect(store.getState().geometry).toEqual(framed);
  });

  it('writes v9 when optical is non-identity and restores it', async () => {
    store.getState().setOptical(opticalShift);
    const saved = await store.getState().saveCurrentAsRecipe('Optical');
    expect(saved.schemaVersion).toBe(9);
    expect(saved.optical).toEqual(opticalShift);
    expect(saved.localAdjustments).toBeUndefined();
    const parsed = validateRecipeJSON(JSON.stringify(saved));
    expect(parsed.optical).toEqual(opticalShift);
    store.getState().resetOptical();
    store.getState().applyRecipe(parsed);
    expect(store.getState().optical).toEqual(opticalShift);
  });

  it('writes v9 for active local adjustments and stays v8 for inactive groups', async () => {
    store.getState().setLocalAdjustments({ enabled: false, groups: localActive.groups });
    expect((await store.getState().saveCurrentAsRecipe('Inactive')).schemaVersion).toBe(8);
    store.getState().setLocalAdjustments(localActive);
    const saved = await store.getState().saveCurrentAsRecipe('Local');
    expect(saved.schemaVersion).toBe(9);
    expect(saved.localAdjustments).toEqual(localActive);
    const parsed = validateRecipeJSON(JSON.stringify(saved));
    store.getState().resetLocalAdjustments();
    store.getState().applyRecipe(parsed);
    expect(store.getState().localAdjustments).toEqual(localActive);
  });
});

describe('CP3 recipe v9 validation', () => {
  const base = { name: 'V9', baseFilmId: 'FS-001', profileVersion: '1.0.0', adjustments: {}, createdAt: 1, updatedAt: 1 };
  const geometry = { ...IDENTITY_GEOMETRY };

  it('rejects v9 fields declared under an older schema version', () => {
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 8, geometry, optical: opticalShift })),
    ).toThrow('Unexpected v9 field in recipe');
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...base, geometry, localAdjustments: localActive })),
    ).toThrow('Unexpected v9 field in recipe');
  });

  it('rejects unknown top-level v9 keys and missing geometry', () => {
    expect(() =>
      validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 9, geometry, unknownV9: true })),
    ).toThrow(/Unknown recipe v9 field/);
    expect(() => validateRecipeJSON(JSON.stringify({ ...base, schemaVersion: 9 }))).toThrow(/geometry wrapper/);
  });

  it('round-trips optical and local adjustments losslessly', () => {
    const recipe = {
      ...base,
      schemaVersion: 9,
      geometry: framed,
      optical: { ...opticalShift, distortion: { k1: 0.05, p1: 0.01 } },
      localAdjustments: localActive,
    };
    const parsed = validateRecipeJSON(JSON.stringify(recipe));
    expect(parsed.schemaVersion).toBe(9);
    expect(parsed.geometry).toEqual(framed);
    expect(parsed.optical).toEqual(recipe.optical);
    expect(parsed.localAdjustments).toEqual(localActive);
  });

  it('delegates optical and local field validation', () => {
    expect(() =>
      validateRecipeJSON(
        JSON.stringify({ ...base, schemaVersion: 9, geometry, optical: { version: 1, homography: [0, 0, 0, 0, 0, 0, 0, 0, 0] } }),
      ),
    ).toThrow(/singular/);
    expect(() =>
      validateRecipeJSON(
        JSON.stringify({ ...base, schemaVersion: 9, geometry: { rotation: 91 } }),
      ),
    ).toThrow(/Invalid geometry rotation/);
    expect(() =>
      validateRecipeJSON(
        JSON.stringify({ ...base, schemaVersion: 9, geometry, localAdjustments: { enabled: true, groups: 'nope' } }),
      ),
    ).toThrow(/local adjustment groups/);
  });
});