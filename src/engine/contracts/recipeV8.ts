import type { CustomRecipe } from '../../types/film';
import { normalizeGeometry, validateGeometry, type GeometryTransform } from './geometry';

export const RECIPE_SCHEMA_V8 = 8;

/**
 * Recipe v8 adds non-destructive framing and is the fallback schema written by
 * the app when no v9 optical/local features are active. Reading stays backward
 * compatible: v1-v7 records are migrated in memory, and a v8 record without a
 * geometry wrapper is rejected rather than silently defaulted.
 */
export interface RecipeV8 extends CustomRecipe {
  schemaVersion: 8;
  geometry: GeometryTransform;
}

export function normalizeRecipeV8Geometry(value: unknown): GeometryTransform {
  const geometry =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { geometry?: GeometryTransform }).geometry
      : undefined;
  return normalizeGeometry(geometry);
}

export function validateRecipeV8Geometry(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid recipe geometry wrapper');
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'geometry')) {
    throw new Error('Invalid recipe geometry wrapper');
  }
  const geometry = (value as { geometry?: unknown }).geometry;
  if (geometry === null || typeof geometry !== 'object' || Array.isArray(geometry)) {
    throw new Error('Invalid recipe geometry');
  }
  const allowed = new Set(['rotation', 'straighten', 'flipHorizontal', 'flipVertical', 'crop']);
  for (const key of Object.keys(geometry)) {
    if (!allowed.has(key)) throw new Error(`Unknown recipe geometry field: ${key}`);
  }
  const crop = (geometry as { crop?: unknown }).crop;
  if (crop !== undefined && crop !== null) {
    if (typeof crop !== 'object' || Array.isArray(crop)) throw new Error('Invalid geometry crop');
    for (const key of Object.keys(crop)) {
      if (key !== 'x' && key !== 'y' && key !== 'width' && key !== 'height') {
        throw new Error(`Unknown recipe geometry crop field: ${key}`);
      }
    }
  }
  validateGeometry(geometry);
}

/**
 * Pure v7 -> v8 step. Call it after the existing recipeStore migration, which
 * already normalizes schemas 1-7 into the v7 feature groups.
 */
export function toRecipeV8(recipe: CustomRecipe): RecipeV8 {
  if (!Number.isInteger(recipe.schemaVersion) || recipe.schemaVersion < 1 || recipe.schemaVersion > 7) {
    throw new Error('Unsupported recipe version for v8 migration');
  }
  return {
    ...recipe,
    schemaVersion: 8,
    geometry: normalizeRecipeV8Geometry(recipe),
  };
}

export function isRecipeV8(value: unknown): value is RecipeV8 {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === RECIPE_SCHEMA_V8
  );
}
