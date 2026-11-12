import { get, set } from 'idb-keyval';
import { CustomRecipe, FilmId, DEFAULT_ADJUSTMENTS } from '../types/film';

const RECIPES_IDB_KEY = 'hd2lab_film_studio_recipes_v1';
const CURRENT_SCHEMA_VERSION = 1;

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
  return {
    id: String(recipe.id || `recipe-${Date.now()}`),
    name: String(recipe.name || 'Untitled Recipe'),
    baseFilmId: (recipe.baseFilmId || 'FS-001') as FilmId,
    profileVersion: String(recipe.profileVersion || '1.0.0'),
    adjustments: {
      ...DEFAULT_ADJUSTMENTS,
      ...(recipe.adjustments || {}),
    },
    createdAt: typeof recipe.createdAt === 'number' ? recipe.createdAt : Date.now(),
    updatedAt: typeof recipe.updatedAt === 'number' ? recipe.updatedAt : Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
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

  return migrateRecipe(parsed);
}
