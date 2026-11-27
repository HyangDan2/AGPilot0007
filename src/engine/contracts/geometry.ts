export type RotationQuarter = 0 | 90 | 180 | 270;

/** Crop rectangle in corrected output NIS, applied post-straighten (last step). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Non-destructive framing applied before color processing:
 * flips, quarter-turn rotation, fine straightening (cover/auto-crop), then crop.
 */
export interface GeometryTransform {
  rotation: RotationQuarter;
  straighten: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: CropRect | null;
}

export const MAX_STRAIGHTEN_DEGREES = 45;
export const MIN_CROP_EDGE = 0.01;

export const IDENTITY_GEOMETRY: GeometryTransform = Object.freeze({
  rotation: 0,
  straighten: 0,
  flipHorizontal: false,
  flipVertical: false,
  crop: null,
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const EPSILON = 1e-9;

export function normalizeCrop(value?: Partial<CropRect> | null): CropRect | null {
  if (!value || typeof value !== 'object') return null;
  const x = finite(value.x, Number.NaN);
  const y = finite(value.y, Number.NaN);
  const width = finite(value.width, Number.NaN);
  const height = finite(value.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < MIN_CROP_EDGE || height < MIN_CROP_EDGE) return null;
  const left = clamp(x, 0, 1 - MIN_CROP_EDGE);
  const top = clamp(y, 0, 1 - MIN_CROP_EDGE);
  const normalizedWidth = clamp(width, MIN_CROP_EDGE, 1 - left);
  const normalizedHeight = clamp(height, MIN_CROP_EDGE, 1 - top);
  if (
    left <= EPSILON &&
    top <= EPSILON &&
    normalizedWidth >= 1 - EPSILON &&
    normalizedHeight >= 1 - EPSILON
  ) {
    return null;
  }
  return { x: left, y: top, width: normalizedWidth, height: normalizedHeight };
}

export function normalizeGeometry(value?: Partial<GeometryTransform> | null): GeometryTransform {
  const rotation = value?.rotation;
  return {
    rotation: rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
    straighten: clamp(finite(value?.straighten, 0), -MAX_STRAIGHTEN_DEGREES, MAX_STRAIGHTEN_DEGREES),
    flipHorizontal: value?.flipHorizontal === true,
    flipVertical: value?.flipVertical === true,
    crop: normalizeCrop(value?.crop),
  };
}

export function geometryIsIdentity(value: GeometryTransform): boolean {
  return (
    value.rotation === 0 &&
    Math.abs(value.straighten) <= EPSILON &&
    !value.flipHorizontal &&
    !value.flipVertical &&
    value.crop === null
  );
}

export function validateGeometry(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid geometry');
  const v = value as GeometryTransform;
  if (v.rotation !== undefined && v.rotation !== 0 && v.rotation !== 90 && v.rotation !== 180 && v.rotation !== 270) {
    throw new Error('Invalid geometry rotation');
  }
  if (
    v.straighten !== undefined &&
    (!Number.isFinite(v.straighten) || Math.abs(v.straighten) > MAX_STRAIGHTEN_DEGREES)
  ) {
    throw new Error('Invalid geometry straighten');
  }
  if (v.flipHorizontal !== undefined && typeof v.flipHorizontal !== 'boolean') throw new Error('Invalid geometry flip');
  if (v.flipVertical !== undefined && typeof v.flipVertical !== 'boolean') throw new Error('Invalid geometry flip');
  if (v.crop !== undefined && v.crop !== null) {
    const crop = v.crop;
    if (!crop || typeof crop !== 'object' || Array.isArray(crop)) throw new Error('Invalid geometry crop');
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const n = crop[key];
      if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('Invalid geometry crop');
    }
    if (crop.width < MIN_CROP_EDGE || crop.height < MIN_CROP_EDGE) throw new Error('Invalid geometry crop');
    if (crop.x + crop.width > 1 + EPSILON || crop.y + crop.height > 1 + EPSILON) {
      throw new Error('Invalid geometry crop');
    }
  }
}
