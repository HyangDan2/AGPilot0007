import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => []), set: vi.fn(async () => undefined) }));
import { MARGARINE_PRESETS } from '../src/presets/margarine';
import { useEditorStore } from '../src/stores/editorStore';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { FILM_PROFILES } from '../src/films/registry';

beforeEach(() => useEditorStore.setState(useEditorStore.getInitialState(), true));
describe('Margarine workflow', () => {
  it('keeps every authored look distinct and resolvable', () => {
    expect(MARGARINE_PRESETS).toHaveLength(58);
    expect(new Set(MARGARINE_PRESETS.map(p => p.id)).size).toBe(58);
    expect(new Set(MARGARINE_PRESETS.map(p => p.baseFilmId + JSON.stringify(p.adjustments))).size).toBe(58);
    for (const p of MARGARINE_PRESETS) expect(FILM_PROFILES[p.baseFilmId]).toBeDefined();
  });
  it('selects once, opens on repeat, and returns to the last look', () => {
    const store = useEditorStore;
    store.getState().selectMargarine();
    expect(store.getState().activePresetId).toBe('soft-white');
    expect(store.getState().isMargarineOpen).toBe(false);
    store.getState().selectMargarine();
    expect(store.getState().isMargarineOpen).toBe(true);
    store.getState().applyMargarine('cafe-brown');
    store.getState().setFilm('FS-009');
    expect(store.getState().activePresetId).toBeNull();
    store.getState().selectMargarine();
    expect(store.getState().activePresetId).toBe('cafe-brown');
  });
  it('undoes and redoes the base LUT and preset identity together', () => {
    const store = useEditorStore;
    store.getState().applyMargarine('cafe-brown');
    store.getState().setFilm('FS-009');
    store.getState().undo();
    expect(store.getState().activeFilmId).toBe('FS-003');
    expect(store.getState().activePresetId).toBe('cafe-brown');
    store.getState().redo();
    expect(store.getState().activeFilmId).toBe('FS-009');
    expect(store.getState().activePresetId).toBeNull();
  });
  it('round-trips modified preset recipes and preserves old recipes', async () => {
    const store = useEditorStore;
    store.getState().applyMargarine('cream-daylight');
    store.getState().setAdjustment('exposure', .5);
    const saved = await store.getState().saveCurrentAsRecipe('Cream custom');
    const parsed = validateRecipeJSON(JSON.stringify(saved));
    expect(parsed.presetId).toBe('cream-daylight');
    expect(parsed.presetVersion).toBe('1.0.0');
    store.getState().setFilm('FS-009');
    store.getState().applyRecipe(parsed);
    expect(store.getState().adjustments.exposure).toBe(.5);
    expect(store.getState().activePresetId).toBe('cream-daylight');
    const old = validateRecipeJSON(JSON.stringify({ name: 'Legacy', baseFilmId: 'FS-001' }));
    store.getState().applyRecipe(old);
    expect(store.getState().activePresetId).toBeNull();
    expect(() => validateRecipeJSON(JSON.stringify({name: 'Bad', baseFilmId: 'FS-009', presetId: 'cream-daylight'}))).toThrow(/incompatible/);
  });
});
