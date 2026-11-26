import type { AdjustmentSettings } from '../../types/film';
import { normalizeSharpening, validateSharpening, type SharpeningSettings } from '../../types/sharpening';
import { normalizeColorMixer, validateColorMixer, type ColorMixerSettings } from '../../types/colorMixer';
import { normalizeCurves, validateCurvesShape, type ToneCurves } from '../../types/curves';
import { normalizeCamera, isValidStampDate, type CameraSettings } from '../../types/camera';

export type RecipeFeatureKey = 'camera' | 'curves' | 'sharpening' | 'colorMixer';

export interface RecipeFeatureDefinition {
  key: RecipeFeatureKey;
  normalize: (recipe: any, adjustments: AdjustmentSettings) => unknown;
  validate?: (recipe: any) => void;
}

export interface NormalizedRecipeFeatures {
  camera: CameraSettings;
  curves: ToneCurves;
  sharpening: SharpeningSettings;
  colorMixer: ColorMixerSettings;
}

const cameraFeature: RecipeFeatureDefinition = {
  key: 'camera',
  normalize: (recipe) => normalizeCamera(recipe.camera),
  validate: (recipe) => {
    if (recipe.camera?.dateStamp?.enabled && !isValidStampDate(recipe.camera.dateStamp.date)) {
      throw new Error('Invalid imprint date');
    }
  },
};

const curvesFeature: RecipeFeatureDefinition = {
  key: 'curves',
  normalize: (recipe) => normalizeCurves(recipe.curves),
  validate: (recipe) => {
    if (recipe.curves !== undefined) validateCurvesShape(recipe.curves);
  },
};

const sharpeningFeature: RecipeFeatureDefinition = {
  key: 'sharpening',
  normalize: (recipe, adjustments) => normalizeSharpening(recipe.sharpening, adjustments.sharpness),
  validate: (recipe) => {
    if (recipe.sharpening !== undefined) validateSharpening(recipe.sharpening);
  },
};

const colorMixerFeature: RecipeFeatureDefinition = {
  key: 'colorMixer',
  normalize: (recipe) => normalizeColorMixer(recipe.colorMixer),
  validate: (recipe) => {
    if (recipe.colorMixer !== undefined) validateColorMixer(recipe.colorMixer);
  },
};

export const RECIPE_FEATURES: readonly RecipeFeatureDefinition[] = [
  cameraFeature,
  curvesFeature,
  sharpeningFeature,
  colorMixerFeature,
];

export function normalizeRecipeFeatures(recipe: any, adjustments: AdjustmentSettings): NormalizedRecipeFeatures {
  return {
    camera: cameraFeature.normalize(recipe, adjustments) as CameraSettings,
    curves: curvesFeature.normalize(recipe, adjustments) as ToneCurves,
    sharpening: sharpeningFeature.normalize(recipe, adjustments) as SharpeningSettings,
    colorMixer: colorMixerFeature.normalize(recipe, adjustments) as ColorMixerSettings,
  };
}

export function validateRecipeFeatures(recipe: any): void {
  for (const feature of RECIPE_FEATURES) feature.validate?.(recipe);
}
