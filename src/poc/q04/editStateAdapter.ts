import { CURRENT_SCHEMA_VERSION } from '../../stores/recipeStore';
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

/** Mirrors Q01 RECIPE_SCHEMA_MAX: v8 geometry exists as a contract but is not persisted yet. */
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
 * v7 recipes never carry framing. Saving from a shared state therefore stores
 * only the color/detail groups; geometry stays per-photo UI state.
 */
export function recipeFromSharedEditState(
  shared: SharedEditState,
  meta: { id: string; name: string; profileVersion?: string; createdAt?: number; updatedAt?: number },
): CustomRecipe {
  return recipeFromEditState(fromSharedEditState(shared), meta);
}

/**
 * Applies a stored recipe to a shared state while preserving that photo's own
 * framing. v8+ recipes and persisted geometry are rejected until Q01 activates
 * the v8 storage checkpoint.
 */
export function applyStoredRecipeToShared(shared: SharedEditState, recipe: CustomRecipe): SharedEditState {
  assertStoredRecipeV7(recipe);
  return { ...editStateFromRecipe(recipe), geometry: shared.geometry };
}

/** Persistable v7 recipe: version 1..7 (or absent legacy version) and no stored geometry. */
export function assertStoredRecipeV7(recipe: CustomRecipe): void {
  const version = recipe.schemaVersion;
  if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > STORED_RECIPE_SCHEMA_MAX)) {
    throw new Error(`Unsupported recipe version for v7 storage: ${String(version)}`);
  }
  if (Object.hasOwn(recipe, 'geometry')) {
    throw new Error('Geometry must not be persisted in a v7 recipe');
  }
}
