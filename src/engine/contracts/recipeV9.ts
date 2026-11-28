import type { CustomRecipe } from '../../types/film';
import {
  validateOpticalTransform,
  type OpticalTransform,
} from './optical';
import {
  validateLocalAdjustments,
  type LocalAdjustmentState,
} from './localAdjustments';
import { validateRecipeV8Geometry } from './recipeV8';
import type { GeometryTransform } from './geometry';

export const RECIPE_SCHEMA_V9 = 9;

/**
 * v9 adds lens/perspective correction and local mask groups to the v8 framing
 * recipe. It is only written when one of those features is actually active;
 * otherwise v8 stays the output so CP2 readers keep opening the file.
 */
export interface RecipeV9 extends CustomRecipe {
  schemaVersion: 9;
  geometry: GeometryTransform;
  optical?: OpticalTransform;
  localAdjustments?: LocalAdjustmentState;
}

const RECIPE_V9_KEYS = new Set([
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
]);

export function hasRecipeV9Fields(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.prototype.hasOwnProperty.call(value, 'optical') || Object.prototype.hasOwnProperty.call(value, 'localAdjustments');
}

export function validateRecipeV9(value: unknown): asserts value is RecipeV9 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid recipe v9 payload');
  }
  if ((value as { schemaVersion?: unknown }).schemaVersion !== RECIPE_SCHEMA_V9) {
    throw new Error('Invalid recipe v9 schema version');
  }
  for (const key of Object.keys(value)) {
    if (!RECIPE_V9_KEYS.has(key)) throw new Error(`Unknown recipe v9 field: ${key}`);
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'geometry')) {
    throw new Error('Invalid recipe geometry wrapper');
  }
  validateRecipeV8Geometry(value);
  const recipe = value as { optical?: unknown; localAdjustments?: unknown };
  if (Object.prototype.hasOwnProperty.call(recipe, 'optical')) validateOpticalTransform(recipe.optical);
  if (Object.prototype.hasOwnProperty.call(recipe, 'localAdjustments')) validateLocalAdjustments(recipe.localAdjustments);
}