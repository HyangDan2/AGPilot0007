import { normalizeMasks, validateMasks, type MaskData } from './masks';

export interface LensBlurState {
  enabled: boolean;
  /** Normalized manual depth, 0..1. */
  focusPlane: number;
  /** In-focus band width, 0..1. */
  focusRange: number;
  /** f-number, 1..22; circle-of-confusion proxy. */
  aperture: number;
  /** Aperture blades, 5..9 (integer). */
  bladeCount: number;
  rotationDeg: number;
  quality: 'preview' | 'export';
  /** Highlight bokeh boost, 0..2. */
  highlightBoost: number;
  /** Flat mask stack from the frozen masks.ts contract; null = procedural depth. */
  depthMask: MaskData[] | null;
}

export interface LensBlurCapability {
  maxTextureSize: number;
  maxTaps?: number;
  supportsFloatLinear?: boolean;
}

export interface LensBlurPlan {
  maxCocPx: number;
  taps: number;
  halfRes: boolean;
  focusPlane: number;
  focusRange: number;
}

/** Q02 implements this in `src/engine/optical/lensBlur*`; null keeps the byte-equal path. */
export type LensBlurPlanner = (
  state: LensBlurState,
  outputSize: { width: number; height: number },
  capability: LensBlurCapability,
) => LensBlurPlan | null;

export const LENS_BLUR_LIMITS = Object.freeze({
  focusPlane: Object.freeze({ min: 0, max: 1 }),
  focusRange: Object.freeze({ min: 0, max: 1 }),
  aperture: Object.freeze({ min: 1, max: 22 }),
  bladeCount: Object.freeze({ min: 5, max: 9 }),
  rotationDeg: Object.freeze({ min: -180, max: 180 }),
  highlightBoost: Object.freeze({ min: 0, max: 2 }),
});

export const LENS_BLUR_DEFAULTS: LensBlurState = Object.freeze({
  enabled: false,
  focusPlane: 0.5,
  focusRange: 0.2,
  aperture: 2.8,
  bladeCount: 6,
  rotationDeg: 0,
  quality: 'preview',
  highlightBoost: 0,
  depthMask: null,
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function normalized(value: unknown, fallback: number, min: number, max: number): number {
  return finite(value) ? clamp(value, min, max) : fallback;
}

/** Deterministic normalization; invalid/absent fields fall back to defaults. */
export function normalizeLensBlur(state: Partial<LensBlurState>): LensBlurState {
  const source = state ?? {};
  const depthMask = Array.isArray(source.depthMask) ? normalizeMasks(source.depthMask) : null;
  return {
    enabled: source.enabled === true,
    focusPlane: normalized(source.focusPlane, LENS_BLUR_DEFAULTS.focusPlane, LENS_BLUR_LIMITS.focusPlane.min, LENS_BLUR_LIMITS.focusPlane.max),
    focusRange: normalized(source.focusRange, LENS_BLUR_DEFAULTS.focusRange, LENS_BLUR_LIMITS.focusRange.min, LENS_BLUR_LIMITS.focusRange.max),
    aperture: normalized(source.aperture, LENS_BLUR_DEFAULTS.aperture, LENS_BLUR_LIMITS.aperture.min, LENS_BLUR_LIMITS.aperture.max),
    bladeCount: Math.round(
      normalized(source.bladeCount, LENS_BLUR_DEFAULTS.bladeCount, LENS_BLUR_LIMITS.bladeCount.min, LENS_BLUR_LIMITS.bladeCount.max),
    ),
    rotationDeg: normalized(source.rotationDeg, LENS_BLUR_DEFAULTS.rotationDeg, LENS_BLUR_LIMITS.rotationDeg.min, LENS_BLUR_LIMITS.rotationDeg.max),
    quality: source.quality === 'export' ? 'export' : 'preview',
    highlightBoost: normalized(source.highlightBoost, LENS_BLUR_DEFAULTS.highlightBoost, LENS_BLUR_LIMITS.highlightBoost.min, LENS_BLUR_LIMITS.highlightBoost.max),
    depthMask: depthMask && depthMask.length > 0 ? depthMask : null,
  };
}

export function isNeutralLensBlur(state: LensBlurState): boolean {
  return !state.enabled;
}

/** Strict recipe-boundary validation; throws instead of normalizing. */
export function validateLensBlur(value: unknown): asserts value is LensBlurState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid lens blur');
  const blur = value as Record<string, unknown>;
  for (const key of Object.keys(blur)) {
    if (
      key !== 'enabled' &&
      key !== 'focusPlane' &&
      key !== 'focusRange' &&
      key !== 'aperture' &&
      key !== 'bladeCount' &&
      key !== 'rotationDeg' &&
      key !== 'quality' &&
      key !== 'highlightBoost' &&
      key !== 'depthMask'
    ) {
      throw new Error(`Unknown lens blur field: ${key}`);
    }
  }
  if (typeof blur.enabled !== 'boolean') throw new Error('Invalid lens blur enabled value');
  const checkRange = (key: string, min: number, max: number): void => {
    const raw = blur[key];
    if (!finite(raw) || raw < min || raw > max) throw new Error(`Invalid lens blur ${key}`);
  };
  checkRange('focusPlane', LENS_BLUR_LIMITS.focusPlane.min, LENS_BLUR_LIMITS.focusPlane.max);
  checkRange('focusRange', LENS_BLUR_LIMITS.focusRange.min, LENS_BLUR_LIMITS.focusRange.max);
  checkRange('aperture', LENS_BLUR_LIMITS.aperture.min, LENS_BLUR_LIMITS.aperture.max);
  checkRange('rotationDeg', LENS_BLUR_LIMITS.rotationDeg.min, LENS_BLUR_LIMITS.rotationDeg.max);
  checkRange('highlightBoost', LENS_BLUR_LIMITS.highlightBoost.min, LENS_BLUR_LIMITS.highlightBoost.max);
  const blades = blur.bladeCount;
  if (
    !finite(blades) ||
    !Number.isInteger(blades) ||
    blades < LENS_BLUR_LIMITS.bladeCount.min ||
    blades > LENS_BLUR_LIMITS.bladeCount.max
  ) {
    throw new Error('Invalid lens blur blade count');
  }
  if (blur.quality !== 'preview' && blur.quality !== 'export') throw new Error('Invalid lens blur quality');
  if (blur.depthMask !== null && blur.depthMask !== undefined) {
    if (!Array.isArray(blur.depthMask)) throw new Error('Invalid lens blur depth mask');
    validateMasks(blur.depthMask);
  }
}
