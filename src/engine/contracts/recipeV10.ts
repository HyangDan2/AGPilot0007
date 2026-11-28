import type { CustomRecipe } from '../../types/film';
import { validateOpticalTransform, type OpticalTransform } from './optical';
import { validateLocalAdjustments, type LocalAdjustmentState } from './localAdjustments';
import { validateRecipeV8Geometry } from './recipeV8';
import type { GeometryTransform } from './geometry';
import { validateLensBlur, type LensBlurState } from './lensBlur';
import { validateDevelop, type RawDevelopState } from './develop';

export const RECIPE_SCHEMA_V10 = 10;

/**
 * v10 adds the CP4 lens-blur and RAW develop groups on top of v9. Like v9 it is
 * written only when one of those features is active; otherwise the reader/writer
 * keeps emitting v8 (default) or v9 (optical/local active).
 */
export interface RecipeV10 extends CustomRecipe {
  schemaVersion: 10;
  geometry: GeometryTransform;
  optical?: OpticalTransform;
  localAdjustments?: LocalAdjustmentState;
  lensBlur?: LensBlurState;
  develop?: RawDevelopState;
}

const RECIPE_V10_KEYS = new Set([
  'id',
  'name',
  'baseFilmId',
  'profileVersion',
  'adjustments',
  'createdAt',
  'updatedAt',
  'schemaVersion',
  'presetId',
  'presetVersion',
  'sharpening',
  'colorMixer',
  'curves',
  'camera',
  'geometry',
  'optical',
  'localAdjustments',
  'lensBlur',
  'develop',
]);

export function hasRecipeV10Fields(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, 'lensBlur') || Object.prototype.hasOwnProperty.call(value, 'develop');
}

export function validateRecipeV10(value: unknown): asserts value is RecipeV10 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid recipe v10 payload');
  }
  if ((value as { schemaVersion?: unknown }).schemaVersion !== RECIPE_SCHEMA_V10) {
    throw new Error('Invalid recipe v10 schema version');
  }
  for (const key of Object.keys(value)) {
    if (!RECIPE_V10_KEYS.has(key)) throw new Error(`Unknown recipe v10 field: ${key}`);
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'geometry')) {
    throw new Error('Invalid recipe geometry wrapper');
  }
  validateRecipeV8Geometry(value);
  const recipe = value as { optical?: unknown; localAdjustments?: unknown; lensBlur?: unknown; develop?: unknown };
  if (Object.prototype.hasOwnProperty.call(recipe, 'optical')) validateOpticalTransform(recipe.optical);
  if (Object.prototype.hasOwnProperty.call(recipe, 'localAdjustments')) validateLocalAdjustments(recipe.localAdjustments);
  if (Object.prototype.hasOwnProperty.call(recipe, 'lensBlur')) validateLensBlur(recipe.lensBlur);
  if (Object.prototype.hasOwnProperty.call(recipe, 'develop')) validateDevelop(recipe.develop);
}
