import { loadSavedRecipes, persistRecipes } from '../../stores/recipeStore';
import type { CustomRecipe } from '../../types/film';

export interface PersistReport {
  ok: boolean;
  expected: number;
  actual: number;
  error?: string;
}

export interface PersistDeps {
  persist: (recipes: CustomRecipe[]) => Promise<void>;
  load: () => Promise<CustomRecipe[]>;
}

export const defaultPersistDeps: PersistDeps = { persist: persistRecipes, load: loadSavedRecipes };

/**
 * persistRecipes (Q01-owned) swallows IndexedDB failures, so success is only
 * reported after reading the store back and finding every saved recipe. A
 * missing or stale record is surfaced instead of being treated as saved.
 */
export async function persistRecipesVerified(
  recipes: CustomRecipe[],
  deps: PersistDeps = defaultPersistDeps,
): Promise<PersistReport> {
  try {
    await deps.persist(recipes);
    const stored = await deps.load();
    const byId = new Map(stored.map((recipe) => [recipe.id, recipe]));
    const missing = recipes.filter((recipe) => {
      const saved = byId.get(recipe.id);
      return !saved || saved.updatedAt !== recipe.updatedAt;
    });
    if (missing.length) {
      return { ok: false, expected: recipes.length, actual: stored.length, error: `read-back mismatch: ${missing.map((recipe) => recipe.name).join(', ')}` };
    }
    return { ok: true, expected: recipes.length, actual: stored.length };
  } catch (error) {
    return { ok: false, expected: recipes.length, actual: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
