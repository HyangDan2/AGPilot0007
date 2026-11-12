import { ToneCurves, CurveChannel, CurvePoint, defaultCurves, normalizeCurves, identityPoints } from '../types/curves';
import { getCameraEffects, supportsCameraEffects } from '../films/cameraEffects';
import { CameraSettings, DateStampSettings, OpticalSettings, normalizeCamera } from '../types/camera';
import { RETRO90 } from '../films/retro90';
import { create } from 'zustand';
import { DecodedImage } from '../engine/image/decoder';
import { FilmId, AdjustmentSettings, DEFAULT_ADJUSTMENTS, CustomRecipe } from '../types/film';
import { FILM_PROFILES } from '../films/registry';
import { loadSavedRecipes, persistRecipes, validateRecipeJSON, CURRENT_SCHEMA_VERSION } from './recipeStore';

import { getMargarinePreset, MARGARINE_PRESETS } from '../presets/margarine';

interface EditorSnapshot { curves: ToneCurves; camera: CameraSettings; adjustments: AdjustmentSettings; activeFilmId: FilmId; activePresetId: string | null }

export type AppView = 'home' | 'editor';

interface EditorState {
  curves: ToneCurves;
  isToneCurveOpen: boolean;
  curveChannel: CurveChannel;
  curvePointIndex: number;
  setCurvePointIndex: (index: number) => void;
  toggleToneCurve: () => void;
  setCurveChannel: (channel: CurveChannel) => void;
  setCurve: (channel: CurveChannel, points: CurvePoint[], commit?: boolean) => void;
  resetCurves: (all?: boolean) => void;
  camera: CameraSettings;
  hasOldSchoolSettings: boolean;
  isCameraEffectsOpen: boolean;
  toggleCameraEffects: () => void;
  isFilterSetOpen: boolean;
  openFilterSet: () => void;
  closeFilterSet: () => void;
  applyOldSchool: () => void;
  updateDateStamp: (patch: Partial<DateStampSettings>) => void;
  updateOptics: (patch: Partial<OpticalSettings>) => void;
  resetCamera: () => void;
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
  curves: defaultCurves(),
  isToneCurveOpen: false,
  curveChannel: 'white',
  curvePointIndex: 0,
  setCurvePointIndex: index => set({curvePointIndex: Math.max(0,Math.min(15,Math.floor(index)))}),
  toggleToneCurve: () => set({isToneCurveOpen: !get().isToneCurveOpen, isCameraEffectsOpen: false}),
  setCurveChannel: curveChannel => set({curveChannel,curvePointIndex:0}),
  setCurve: (channel, points, commit = true) => {
    const state = get();
    const curves = normalizeCurves({...state.curves, [channel]: points});
    if (!commit) { set({curves}); return; }
    const snapshot = {curves, camera: normalizeCamera(state.camera), adjustments: {...state.adjustments}, activeFilmId: state.activeFilmId, activePresetId: state.activePresetId};
    if (JSON.stringify(snapshot) === JSON.stringify(state.history[state.historyIndex])) return;
    const history = [...state.history.slice(0,state.historyIndex+1), snapshot].slice(-50);
    set({curves, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo:false});
  },
  resetCurves: (all = false) => {
    if (all) set({curves: defaultCurves()});
    get().setCurve(get().curveChannel, identityPoints());
  },
  camera: normalizeCamera(),
  hasOldSchoolSettings: false,
  isCameraEffectsOpen: false,
  toggleCameraEffects: () => { if (supportsCameraEffects(get().activeFilmId)) set({ isCameraEffectsOpen: !get().isCameraEffectsOpen, isToneCurveOpen: false }); },
  isFilterSetOpen: false,
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
  history: [{ curves: defaultCurves(), camera: normalizeCamera(), adjustments: { ...DEFAULT_ADJUSTMENTS }, activeFilmId: 'FS-001', activePresetId: null }],
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
    const snapshot = { curves: normalizeCurves(get().curves), camera: normalizeCamera(get().camera), adjustments: { ...preset.adjustments }, activeFilmId: preset.baseFilmId, activePresetId: id };
    const history = [...get().history.slice(0, get().historyIndex + 1), snapshot].slice(-50);
    set({ isCameraEffectsOpen: false, ...snapshot, lastPresetId: id, history, historyIndex: history.length - 1, canUndo: history.length > 1, canRedo: false });
  },
  openFilterSet: () => set({ isFilterSetOpen: true, isMargarineOpen: false }),
  closeFilterSet: () => set({ isFilterSetOpen: false }),
  applyOldSchool: () => {
    const snapshot: EditorSnapshot = {
      curves: normalizeCurves(get().curves),
      activeFilmId: 'FS-010', activePresetId: null,
      adjustments: { ...DEFAULT_ADJUSTMENTS, ...RETRO90.defaultAdjustments },
      camera: get().hasOldSchoolSettings ? normalizeCamera(get().camera) : normalizeCamera({ ...get().camera, optics: { glow: 12, halation: 8, softness: 8, quality: 'standard' } }),
    };
    const history = [...get().history.slice(0,get().historyIndex+1),snapshot].slice(-50);
    set({ ...snapshot, hasOldSchoolSettings: true, isCameraEffectsOpen: false, isFilterSetOpen: false, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo: false });
  },
  updateDateStamp: (patch) => {
    const state = get();
    if (!getCameraEffects(state.activeFilmId).includes('dateStamp')) return;
    const camera = normalizeCamera({ ...state.camera, dateStamp: { ...state.camera.dateStamp, ...patch } });
    if (JSON.stringify(camera) === JSON.stringify(state.camera)) return;
    const snapshot = { curves: normalizeCurves(get().curves), camera, activeFilmId: state.activeFilmId, activePresetId: state.activePresetId, adjustments: { ...state.adjustments } };
    const history = [...state.history.slice(0,state.historyIndex+1),snapshot].slice(-50);
    set({ camera, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo: false });
  },
  updateOptics: (patch) => {
    const state = get();
    if (!getCameraEffects(state.activeFilmId).some(effect => effect !== 'dateStamp')) return;
    const camera = normalizeCamera({ ...state.camera, optics: { ...state.camera.optics, ...patch } });
    if (JSON.stringify(camera) === JSON.stringify(state.camera)) return;
    const snapshot = { curves: normalizeCurves(get().curves), camera, activeFilmId: state.activeFilmId, activePresetId: state.activePresetId, adjustments: { ...state.adjustments } };
    const history = [...state.history.slice(0,state.historyIndex+1),snapshot].slice(-50);
    set({ camera, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo: false });
  },
  resetCamera: () => {
    const state=get();
    if (!supportsCameraEffects(state.activeFilmId)) return;
    const snapshot={ curves: normalizeCurves(get().curves), camera: normalizeCamera(), activeFilmId: state.activeFilmId, activePresetId: state.activePresetId, adjustments: {...state.adjustments} };
    const history=[...state.history.slice(0,state.historyIndex+1),snapshot].slice(-50);
    set({...snapshot,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
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
    const state = get();
    const camera = normalizeCamera(state.camera.dateStamp.source === 'exif' ? {
      ...state.camera, dateStamp: { ...state.camera.dateStamp, date: img.captureDate || '', enabled: state.camera.dateStamp.enabled && !!img.captureDate }
    } : state.camera);
    const snapshot = { curves: normalizeCurves(get().curves), camera, activeFilmId: state.activeFilmId, activePresetId: state.activePresetId, adjustments: { ...state.adjustments } };
    set({
      isCameraEffectsOpen: false,
      camera, history: [snapshot], historyIndex: 0, canUndo: false, canRedo: false,
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
    const camera = normalizeCamera(get().camera);
    newHistory.push({ curves: normalizeCurves(get().curves), camera, adjustments: newAdjustments, activeFilmId: filmId, activePresetId: null });

    set({
      camera,
      isCameraEffectsOpen: false,
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
    newHistory.push({ curves: normalizeCurves(get().curves), camera: normalizeCamera(get().camera), adjustments: updated, activeFilmId: get().activeFilmId, activePresetId: get().activePresetId });

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
      ...(get().activeFilmId === 'FS-010' ? RETRO90.defaultAdjustments : {}),
    };
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    const camera = normalizeCamera({ ...get().camera, optics: get().activeFilmId === 'FS-010' ? { glow: 12, halation: 8, softness: 8, quality: 'standard' } : get().camera.optics });
    newHistory.push({ curves: defaultCurves(), camera, adjustments: { ...resetValues }, activeFilmId: get().activeFilmId, activePresetId: get().activePresetId });

    set({
      camera,
      curves: defaultCurves(),
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
        isCameraEffectsOpen: false,
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
        isCameraEffectsOpen: false,
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
      schemaVersion: CURRENT_SCHEMA_VERSION,
      curves: normalizeCurves(state.curves),
      camera: normalizeCamera(state.camera),
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
    const snapshot = { curves: normalizeCurves(recipe.curves), camera: normalizeCamera(recipe.camera), activeFilmId: recipe.baseFilmId, activePresetId: getMargarinePreset(recipe.presetId)?.id || null, adjustments: { ...recipe.adjustments } };
    const history = [...get().history.slice(0, get().historyIndex + 1), snapshot].slice(-50);
    set({ curves: snapshot.curves, camera: snapshot.camera, isCameraEffectsOpen: false, ...(recipe.baseFilmId === 'FS-010' ? { hasOldSchoolSettings: true } : {}), history, historyIndex: history.length - 1, canUndo: history.length > 1, canRedo: false,
      activeFilmId: recipe.baseFilmId,
      activePresetId: getMargarinePreset(recipe.presetId)?.id || null,
      ...(recipe.presetId && getMargarinePreset(recipe.presetId) ? { lastPresetId: recipe.presetId } : {}),
      adjustments: { ...recipe.adjustments },
    });
  },

  importRecipe: async (jsonStr: string) => {
    const validated = validateRecipeJSON(jsonStr);
    if (get().recipes.some(recipe => recipe.id === validated.id)) {
      validated.id = `rcp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    }
    const updated = [validated, ...get().recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
    return validated;
  },
}));
