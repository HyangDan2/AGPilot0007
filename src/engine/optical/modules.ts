import { createCoreRenderRegistry } from '../contracts/renderPlan';
import {
  geometryIsIdentity,
  normalizeGeometry,
  validateGeometry,
  type GeometryTransform,
} from '../contracts/geometry';
import { validateOpticalTransform, type OpticalTransform } from '../contracts/optical';
import { MAX_MASKS, validateMasks, type MaskData } from '../contracts/masks';
import type { EditModule, EditModuleRegistry } from '../contracts/moduleRegistry';
import type { RenderSettings } from '../pipeline/renderSettings';
import {
  assertOpticalRenderable,
  normalizeOpticalTransform,
  opticalIsIdentity,
} from './transform';
import { validateGeometryRenderable } from './geometry';

export const Q02_GEOMETRY_MODULE_ID = 'q02.geometry.transform';
export const Q02_OPTICAL_MODULE_ID = 'q02.optical.lens';

/** PoC harness cap from OPTICAL_POC §3.3; product code uses the 16-mask contract. */
export const Q02_HARNESS_MAX_MASKS = 8;

export interface OpticalRenderSettings extends RenderSettings {
  optical?: OpticalTransform;
  masks?: readonly MaskData[];
}

export type MaskBudgetMode = 'product' | 'harness';

/**
 * Validates the raw stack before any normalize step so limits are never met
 * through silent truncation (contract MAX_MASKS/MAX_STROKES/MAX_STROKE_POINTS).
 */
export function assertMaskBudget(masks: unknown, mode: MaskBudgetMode = 'product'): void {
  if (masks === undefined || masks === null) return;
  if (!Array.isArray(masks)) throw new Error('Invalid masks');
  const limit = mode === 'harness' ? Q02_HARNESS_MAX_MASKS : MAX_MASKS;
  if (masks.length > limit) {
    throw new Error(
      mode === 'harness'
        ? `Optical harness supports at most ${Q02_HARNESS_MAX_MASKS} masks`
        : `Invalid masks: at most ${MAX_MASKS} masks`,
    );
  }
  validateMasks(masks);
}

export function createGeometryStageModule(): EditModule<GeometryTransform> {
  return {
    id: Q02_GEOMETRY_MODULE_ID,
    stage: 'geometry',
    contractVersion: 1,
    role: 'feature',
    requires: ['core.source'],
    isActive: (settings) => !!settings.geometry && !geometryIsIdentity(settings.geometry),
    resourceUsage: () => ({ textures: 2, floatIntermediate: false }),
    normalize: (value) => normalizeGeometry(value as Partial<GeometryTransform> | null),
    validate: (value) => validateGeometry(value),
    execute: ({ settings }) => {
      if (settings.geometry) validateGeometryRenderable(settings.geometry);
    },
  };
}

export function createOpticalStageModule(): EditModule<OpticalTransform> {
  return {
    id: Q02_OPTICAL_MODULE_ID,
    stage: 'optical',
    contractVersion: 1,
    role: 'feature',
    requires: ['core.source'],
    isActive: (settings) => {
      const optical = (settings as OpticalRenderSettings).optical;
      return !!optical && !opticalIsIdentity(optical);
    },
    resourceUsage: () => ({ textures: 2, floatIntermediate: true }),
    normalize: (value) => normalizeOpticalTransform(value),
    validate: (value) => validateOpticalTransform(value),
    execute: ({ settings }) => {
      const opticalSettings = settings as OpticalRenderSettings;
      if (opticalSettings.optical) assertOpticalRenderable(opticalSettings.optical);
      assertMaskBudget(opticalSettings.masks, 'product');
    },
  };
}

/**
 * Q02 modules are opt-in on a copy of the core registry. Q01 remains the owner
 * of renderPlan.ts and the production runner; this factory is the only hook.
 */
export function createQ02RenderRegistry(
  base: EditModuleRegistry = createCoreRenderRegistry(),
): EditModuleRegistry {
  base.register(createOpticalStageModule());
  base.register(createGeometryStageModule());
  return base;
}
