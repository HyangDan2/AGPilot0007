import { create } from 'zustand';
import { DecodedImage } from '../engine/image/decoder';
import { FilmId, AdjustmentSettings, DEFAULT_ADJUSTMENTS, CustomRecipe } from '../types/film';
import { FILM_PROFILES } from '../films/registry';
import { loadSavedRecipes, persistRecipes, validateRecipeJSON } from './recipeStore';

import { getMargarinePreset, MARGARINE_PRESETS } from '../presets/margarine';

interface EditorSnapshot { adjustments: AdjustmentSettings; activeFilmId: FilmId; activePresetId: string | null }

export type AppView = 'home' | 'editor';

interface EditorState {
  currentView: AppView;
  image: DecodedImage | null;
  activeFilmId: FilmId;
  adjustments: AdjustmentSettings;
  compareMode: 'none' | 'original' | 'split';
  splitPos: number;
  zoom: number;
  pan: { x: number; y: number };
  isExporting: boolean;
  exportProgress: { progress: number; stage: string };
  recipes: CustomRecipe[];
  activePresetId: string | null;
  lastPresetId: string;
  isMargarineOpen: boolean;
  selectMargarine: () => void;
  applyMargarine: (id: string) => void;
  closeMargarine: () => void;
  history: EditorSnapshot[];
  historyIndex: number;

  // Actions
  setView: (view: AppView) => void;
  setImage: (img: DecodedImage) => void;
  setFilm: (filmId: FilmId) => void;
  setAdjustment: <K extends keyof AdjustmentSettings>(key: K, val: number) => void;
  resetAdjustments: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setCompareMode: (mode: 'none' | 'original' | 'split') => void;
  setSplitPos: (pos: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setZoomAndPan: (zoom: number, pan: { x: number; y: number }) => void;
  resetZoomPan: () => void;

  // Recipe actions
  loadRecipes: () => Promise<void>;
  saveCurrentAsRecipe: (name: string) => Promise<CustomRecipe>;
  deleteRecipe: (id: string) => Promise<void>;
  renameRecipe: (id: string, newName: string) => Promise<void>;
  duplicateRecipe: (id: string) => Promise<void>;
  applyRecipe: (recipe: CustomRecipe) => void;
  importRecipe: (jsonStr: string) => Promise<CustomRecipe>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  currentView: 'home',
  image: null,
  activeFilmId: 'FS-001',
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  compareMode: 'none',
  splitPos: 0.5,
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  isExporting: false,
  exportProgress: { progress: 0, stage: '' },
  recipes: [],
  activePresetId: null,
  lastPresetId: MARGARINE_PRESETS[0].id,
  isMargarineOpen: false,
  history: [{ adjustments: { ...DEFAULT_ADJUSTMENTS }, activeFilmId: 'FS-001', activePresetId: null }],
  historyIndex: 0,
  canUndo: false,
  canRedo: false,

  selectMargarine: () => {
    if (get().activePresetId) set({ isMargarineOpen: true });
    else get().applyMargarine(get().lastPresetId);
  },
  closeMargarine: () => set({ isMargarineOpen: false }),
  applyMargarine: (id) => {
    const preset = getMargarinePreset(id);
    if (!preset) return;
    const snapshot = { adjustments: { ...preset.adjustments }, activeFilmId: preset.baseFilmId, activePresetId: id };
    const history = [...get().history.slice(0, get().historyIndex + 1), snapshot].slice(-50);
    set({ ...snapshot, lastPresetId: id, history, historyIndex: history.length - 1, canUndo: history.length > 1, canRedo: false });
  },
  setView: (view) => set({ currentView: view }),

  setImage: (img) => {
    const prevImg = get().image;
    if (prevImg && prevImg.sourceUrl && prevImg.sourceUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prevImg.sourceUrl);
      } catch {
        // ignore revoke error
      }
    }
    set({
      image: img,
      currentView: 'editor',
      zoom: 1.0,
      pan: { x: 0, y: 0 },
    });
  },

  setFilm: (filmId) => {
    const profile = FILM_PROFILES[filmId];
    if (!profile) return;
    const current = get().adjustments;
    // Apply film-specific default grain if user hasn't explicitly customized
    const newAdjustments: AdjustmentSettings = {
      ...current,
      grain: profile.grain.amount,
      filmStrength: 100,
    };

    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push({ adjustments: newAdjustments, activeFilmId: filmId, activePresetId: null });

    set({
      activeFilmId: filmId,
      activePresetId: null,
      adjustments: newAdjustments,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      canUndo: newHistory.length > 1,
      canRedo: false,
    });
  },

  setAdjustment: (key, val) => {
    const current = get().adjustments;
    if (current[key] === val) return;

    const updated = { ...current, [key]: val };
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push({ adjustments: updated, activeFilmId: get().activeFilmId, activePresetId: get().activePresetId });

    // Limit history stack to 50
    if (newHistory.length > 50) newHistory.shift();

    set({
      adjustments: updated,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      canUndo: newHistory.length > 1,
      canRedo: false,
    });
  },

  resetAdjustments: () => {
    const film = FILM_PROFILES[get().activeFilmId];
    const resetValues: AdjustmentSettings = getMargarinePreset(get().activePresetId)?.adjustments || {
      ...DEFAULT_ADJUSTMENTS,
      grain: film ? film.grain.amount : 0,
    };
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push({ adjustments: { ...resetValues }, activeFilmId: get().activeFilmId, activePresetId: get().activePresetId });

    set({
      adjustments: resetValues,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      canUndo: newHistory.length > 1,
      canRedo: false,
    });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      set({
        historyIndex: newIndex,
        ...history[newIndex],
        ...(history[newIndex].activePresetId ? { lastPresetId: history[newIndex].activePresetId! } : {}),
        adjustments: { ...history[newIndex].adjustments },
        canUndo: newIndex > 0,
        canRedo: true,
      });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        ...history[newIndex],
        ...(history[newIndex].activePresetId ? { lastPresetId: history[newIndex].activePresetId! } : {}),
        adjustments: { ...history[newIndex].adjustments },
        canUndo: true,
        canRedo: newIndex < history.length - 1,
      });
    }
  },

  setCompareMode: (mode) => set({ compareMode: mode }),
  setSplitPos: (pos) => set({ splitPos: Math.min(1.0, Math.max(0.0, pos)) }),
  setZoom: (zoom) => set({ zoom: Math.min(8.0, Math.max(1.0, zoom)) }),
  setPan: (pan) => set({ pan }),
  setZoomAndPan: (zoom, pan) => set({ zoom: Math.min(8.0, Math.max(1.0, zoom)), pan }),
  resetZoomPan: () => set({ zoom: 1.0, pan: { x: 0, y: 0 } }),

  loadRecipes: async () => {
    const recipes = await loadSavedRecipes();
    set({ recipes });
  },

  saveCurrentAsRecipe: async (name: string) => {
    const state = get();
    const newRecipe: CustomRecipe = {
      id: `rcp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || 'Untitled Recipe',
      baseFilmId: state.activeFilmId,
      ...(state.activePresetId ? { presetId: state.activePresetId, presetVersion: getMargarinePreset(state.activePresetId)?.version } : {}),
      profileVersion: FILM_PROFILES[state.activeFilmId]?.version || '1.0.0',
      adjustments: { ...state.adjustments },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      schemaVersion: 1,
    };

    const updated = [newRecipe, ...state.recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
    return newRecipe;
  },

  deleteRecipe: async (id: string) => {
    const updated = get().recipes.filter((r) => r.id !== id);
    set({ recipes: updated });
    await persistRecipes(updated);
  },

  renameRecipe: async (id: string, newName: string) => {
    const updated = get().recipes.map((r) =>
      r.id === id ? { ...r, name: newName.trim(), updatedAt: Date.now() } : r
    );
    set({ recipes: updated });
    await persistRecipes(updated);
  },

  duplicateRecipe: async (id: string) => {
    const target = get().recipes.find((r) => r.id === id);
    if (!target) return;
    const duplicated: CustomRecipe = {
      ...target,
      id: `rcp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: `${target.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [duplicated, ...get().recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
  },

  applyRecipe: (recipe: CustomRecipe) => {
    const snapshot = { activeFilmId: recipe.baseFilmId, activePresetId: getMargarinePreset(recipe.presetId)?.id || null, adjustments: { ...recipe.adjustments } };
    const history = [...get().history.slice(0, get().historyIndex + 1), snapshot].slice(-50);
    set({ history, historyIndex: history.length - 1, canUndo: history.length > 1, canRedo: false,
      activeFilmId: recipe.baseFilmId,
      activePresetId: getMargarinePreset(recipe.presetId)?.id || null,
      ...(recipe.presetId && getMargarinePreset(recipe.presetId) ? { lastPresetId: recipe.presetId } : {}),
      adjustments: { ...recipe.adjustments },
    });
  },

  importRecipe: async (jsonStr: string) => {
    const validated = validateRecipeJSON(jsonStr);
    const updated = [validated, ...get().recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
    return validated;
  },
}));
