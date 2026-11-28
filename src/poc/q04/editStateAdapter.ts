import { assertRecipeVersionSupported, RECIPE_SCHEMA_MAX } from '../../engine/contracts/recipeValidation';
import { validateRecipeV8Geometry } from '../../engine/contracts/recipeV8';
import type { CustomRecipe } from '../../types/film';
import { createEditState, editStateFromRecipe, recipeFromEditState } from './editState';
import type { EditState } from './types';

/**
 * Q01's canonical EditState adds `geometry` to the v7 fields. The PoC now
 * carries framing itself, so the shared shape only widens geometry to opaque:
 * only Q01 normalizeGeometry may inspect or clamp a shared geometry value.
 */
export type SharedEditState = Omit<EditState, 'geometry'> & { geometry: unknown };

/** Mirrors Q01 RECIPE_SCHEMA_MAX: highest storable schema; older versions stay readable. */
export const STORED_RECIPE_SCHEMA_MAX = RECIPE_SCHEMA_MAX;

/** Attaches framing to a PoC edit state without touching the shared reference. */
export function toSharedEditState(edit: EditState, geometry: unknown): SharedEditState {
  return { ...edit, geometry };
}

/** Drops the shared framing back to neutral; the opaque value is never reinterpreted here. */
export function fromSharedEditState(shared: SharedEditState): EditState {
  return createEditState({ ...shared, geometry: undefined });
}

/**
 * Saves color/detail groups with neutral v8 framing. Per-photo framing stays in
 * the shared state and is not copied into a shared recipe.
 */
export function recipeFromSharedEditState(
  shared: SharedEditState,
  meta: { id: string; name: string; profileVersion?: string; createdAt?: number; updatedAt?: number },
): CustomRecipe {
  return recipeFromEditState(fromSharedEditState(shared), meta);
}

/**
 * Applies a stored v1-v8 recipe to a shared state while preserving that photo's
 * own framing. v8 recipes must carry a valid geometry wrapper.
 */
export function applyStoredRecipeToShared(shared: SharedEditState, recipe: CustomRecipe): SharedEditState {
  assertStoredRecipe(recipe);
  return { ...editStateFromRecipe(recipe), geometry: shared.geometry };
}

/** Persistable recipe: version 1..8 (or absent legacy version), with valid v8 geometry. */
export function assertStoredRecipe(recipe: CustomRecipe): void {
  assertRecipeVersionSupported(recipe.schemaVersion);
  if ((recipe.schemaVersion ?? 0) >= 8 || Object.hasOwn(recipe, 'geometry')) {
    validateRecipeV8Geometry(recipe);
  }
}
