import type { CustomRecipe } from '../../types/film';
import { normalizeGeometry, validateGeometry, type GeometryTransform } from './geometry';

export const RECIPE_SCHEMA_V8 = 8;

/**
 * Recipe v8 adds non-destructive framing. It is defined here ahead of the
 * recipeStore wiring so feature work orders can normalize/validate the same
 * shape; CURRENT_SCHEMA_VERSION stays at 7 until CP1 geometry is implemented.
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
