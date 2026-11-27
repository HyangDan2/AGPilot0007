import { CURRENT_SCHEMA_VERSION } from '../../stores/recipeStore';
import { assertRecipeVersionSupported } from '../../engine/contracts/recipeValidation';
import { validateRecipeV8Geometry } from '../../engine/contracts/recipeV8';
import type { CustomRecipe } from '../../types/film';
import { createEditState, editStateFromRecipe, recipeFromEditState } from './editState';
import type { EditState } from './types';

/**
 * Q01's canonical EditState (feature/phase1-pro-engine
 * src/engine/contracts/editState.ts) adds `geometry` to the v7 fields. The Q04
 * PoC cannot import that module before Q01 merges, so this adapter mirrors the
 * shape structurally and treats geometry as opaque: only Q01 normalizeGeometry
 * may inspect or clamp it.
 */
export interface SharedEditState extends EditState {
  geometry: unknown;
}

/** Mirrors Q01 RECIPE_SCHEMA_MAX: v8 framing is persisted, older versions stay readable. */
export const STORED_RECIPE_SCHEMA_MAX = CURRENT_SCHEMA_VERSION;

/** Attaches framing to a PoC edit state without touching the shared reference. */
export function toSharedEditState(edit: EditState, geometry: unknown): SharedEditState {
  return { ...edit, geometry };
}

/** Drops framing; createEditState copies only the known v7 fields. */
export function fromSharedEditState(shared: SharedEditState): EditState {
  return createEditState(shared);
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
