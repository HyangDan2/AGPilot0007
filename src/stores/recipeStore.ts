import { get, set } from 'idb-keyval';
import { CustomRecipe, FilmId, DEFAULT_ADJUSTMENTS } from '../types/film';
import { normalizeRecipeFeatures, validateRecipeFeatures } from '../engine/pipeline/recipeFeatures';
import {
  RECIPE_SCHEMA_MAX,
  assertRecipePersistable,
  assertRecipeVersionSupported,
  detectRecipeSchemaVersion,
  resolveRecipeStorageKey,
} from '../engine/contracts/recipeValidation';
import { IDENTITY_GEOMETRY } from '../engine/contracts/geometry';
import {
  RECIPE_SCHEMA_V8,
  normalizeRecipeV8Geometry,
  validateRecipeV8Geometry,
} from '../engine/contracts/recipeV8';

import { FILM_PROFILES } from '../films/registry';
import { ADJUSTMENT_DEFINITIONS } from '../types/adjustments';
import { getMargarinePreset } from '../presets/margarine';

const RECIPES_IDB_KEY = resolveRecipeStorageKey((import.meta as any).env?.BASE_URL || '');
export const CURRENT_SCHEMA_VERSION = RECIPE_SCHEMA_MAX;

export async function loadSavedRecipes(): Promise<CustomRecipe[]> {
  try {
    const data = await get<CustomRecipe[]>(RECIPES_IDB_KEY);
    if (!Array.isArray(data)) return [];
    // Migrate in memory only; stored v1-v7 records stay untouched until an
    // explicit persistence action rewrites them as v8.
    const migrated: CustomRecipe[] = [];
    for (const entry of data) {
      try {
        migrated.push(migrateRecipe(entry));
      } catch (err) {
        console.error('Skipped invalid stored recipe:', err);
      }
    }
    return migrated;
  } catch (err) {
    console.error('Failed to load recipes from IndexedDB:', err);
    return [];
  }
}

export async function persistRecipes(recipes: CustomRecipe[]): Promise<void> {
  try {
    for (const recipe of recipes) assertRecipePersistable(recipe, RECIPES_IDB_KEY);
    await set(RECIPES_IDB_KEY, recipes);
  } catch (err) {
    console.error('Failed to persist recipes to IndexedDB:', err);
  }
}

function migrateRecipe(recipe: any): CustomRecipe {
  const declaredVersion = detectRecipeSchemaVersion(recipe);
  const hasGeometry = !!recipe && typeof recipe === 'object' && Object.prototype.hasOwnProperty.call(recipe, 'geometry');
  if (hasGeometry || (declaredVersion !== null && declaredVersion >= RECIPE_SCHEMA_V8)) {
    validateRecipeV8Geometry(recipe);
  }
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
    geometry: hasGeometry ? normalizeRecipeV8Geometry(recipe) : IDENTITY_GEOMETRY,
    ...normalizeRecipeFeatures(recipe, adjustments),
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

  assertRecipeVersionSupported(parsed.schemaVersion);
  if (!Object.hasOwn(FILM_PROFILES, parsed.baseFilmId)) throw new Error('Unknown base film');
  if (parsed.presetId && getMargarinePreset(parsed.presetId)?.baseFilmId !== parsed.baseFilmId) {
    throw new Error('Unknown or incompatible preset');
  }
  validateRecipeFeatures(parsed);
  return migrateRecipe(parsed);
}
