import { normalizeColorMixer, validateColorMixer } from '../types/colorMixer';
import { normalizeCurves, CURVE_CHANNELS } from '../types/curves';
import { normalizeCamera, isValidStampDate } from '../types/camera';
import { get, set } from 'idb-keyval';
import { CustomRecipe, FilmId, DEFAULT_ADJUSTMENTS } from '../types/film';

import { FILM_PROFILES } from '../films/registry';
import { ADJUSTMENT_DEFINITIONS } from '../types/adjustments';
import { getMargarinePreset } from '../presets/margarine';

const RECIPES_IDB_KEY = ((import.meta as any).env?.BASE_URL || '').includes('/beta/')
  ? 'hd2lab_film_studio_beta_recipes_v1'
  : 'hd2lab_film_studio_recipes_v1';
export const CURRENT_SCHEMA_VERSION = 5;

export async function loadSavedRecipes(): Promise<CustomRecipe[]> {
  try {
    const data = await get<CustomRecipe[]>(RECIPES_IDB_KEY);
    if (!Array.isArray(data)) return [];
    // Migration handling if schema version changes
    return data.map((r) => migrateRecipe(r));
  } catch (err) {
    console.error('Failed to load recipes from IndexedDB:', err);
    return [];
  }
}

export async function persistRecipes(recipes: CustomRecipe[]): Promise<void> {
  try {
    await set(RECIPES_IDB_KEY, recipes);
  } catch (err) {
    console.error('Failed to persist recipes to IndexedDB:', err);
  }
}

function migrateRecipe(recipe: any): CustomRecipe {
  const baseFilmId: FilmId = Object.hasOwn(FILM_PROFILES, recipe.baseFilmId) ? recipe.baseFilmId : 'FS-001';
  const adjustments = { ...DEFAULT_ADJUSTMENTS };
  for (const def of ADJUSTMENT_DEFINITIONS) {
    const value = recipe.adjustments?.[def.key];
    if (typeof value === 'number' && Number.isFinite(value)) adjustments[def.key] = Math.min(def.max, Math.max(def.min, value));
  }
  return {
    ...(getMargarinePreset(recipe.presetId)?.baseFilmId === recipe.baseFilmId ? { presetId: recipe.presetId, presetVersion: typeof recipe.presetVersion === 'string' ? recipe.presetVersion : getMargarinePreset(recipe.presetId)?.version } : {}),
    id: String(recipe.id || `recipe-${Date.now()}`),
    name: String(recipe.name || 'Untitled Recipe'),
    baseFilmId,
    profileVersion: String(recipe.profileVersion || '1.0.0'),
    adjustments,
    createdAt: typeof recipe.createdAt === 'number' ? recipe.createdAt : Date.now(),
    updatedAt: typeof recipe.updatedAt === 'number' ? recipe.updatedAt : Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    camera: normalizeCamera(recipe.camera),
    curves: normalizeCurves(recipe.curves),
    colorMixer: normalizeColorMixer(recipe.colorMixer),
  };
}

export function validateRecipeJSON(jsonStr: string): CustomRecipe {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Invalid JSON format');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Recipe JSON must be a valid JSON object');
  }

  if (!parsed.name || typeof parsed.name !== 'string') {
    throw new Error('Recipe missing valid "name" property');
  }

  if (!parsed.baseFilmId || typeof parsed.baseFilmId !== 'string') {
    throw new Error('Recipe missing valid "baseFilmId" property');
  }

  if (parsed.schemaVersion !== undefined && (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1 || parsed.schemaVersion > CURRENT_SCHEMA_VERSION)) throw new Error('Unsupported recipe version');
  if (parsed.camera?.dateStamp?.enabled && !isValidStampDate(parsed.camera.dateStamp.date)) throw new Error('Invalid imprint date');
  if (!Object.hasOwn(FILM_PROFILES, parsed.baseFilmId)) throw new Error('Unknown base film');
  if (parsed.presetId && getMargarinePreset(parsed.presetId)?.baseFilmId !== parsed.baseFilmId) {
    throw new Error('Unknown or incompatible preset');
  }
  if (parsed.curves !== undefined) {
    if (!parsed.curves || typeof parsed.curves !== 'object') throw new Error('Invalid tone curves');
    const normalized = normalizeCurves(parsed.curves);
    for (const channel of CURVE_CHANNELS) if (parsed.curves[channel] !== undefined && JSON.stringify(parsed.curves[channel]) !== JSON.stringify(normalized[channel])) throw new Error('Invalid tone curve points');
  }
  if(parsed.colorMixer!==undefined)validateColorMixer(parsed.colorMixer);
  return migrateRecipe(parsed);
}
