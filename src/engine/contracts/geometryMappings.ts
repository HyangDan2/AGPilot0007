import type { GeometryTransform, RotationQuarter } from './geometry';

/**
 * Geometry application order, shared by CPU reference code and GPU shaders.
 * Source pixels are flipped, quarter-turned, straightened, then cropped.
 */
export const GEOMETRY_TRANSFORM_ORDER = ['flip', 'rotate', 'straighten', 'crop'] as const;

export type GeometryTransformStep = (typeof GEOMETRY_TRANSFORM_ORDER)[number];

export interface NormalizedPoint {
  x: number;
  y: number;
}

const EPSILON = 1e-12;

function rotateForward(point: NormalizedPoint, rotation: RotationQuarter): NormalizedPoint {
  switch (rotation) {
    case 90:
      return { x: 1 - point.y, y: point.x };
    case 180:
      return { x: 1 - point.x, y: 1 - point.y };
    case 270:
      return { x: point.y, y: 1 - point.x };
    default:
      return { x: point.x, y: point.y };
  }
}

function rotateInverse(point: NormalizedPoint, rotation: RotationQuarter): NormalizedPoint {
  switch (rotation) {
    case 90:
      return { x: point.y, y: 1 - point.x };
    case 180:
      return { x: 1 - point.x, y: 1 - point.y };
    case 270:
      return { x: 1 - point.y, y: point.x };
    default:
      return { x: point.x, y: point.y };
  }
}

export function rotatedAspect(rotation: RotationQuarter, sourceAspect: number): number {
  return rotation === 90 || rotation === 270 ? 1 / sourceAspect : sourceAspect;
}

/**
 * Zoom factor that keeps the rotated frame covered while straightening.
 * Coordinates are aspect-corrected centered units before scaling.
 */
export function straightenScale(aspect: number, degrees: number): number {
  if (Math.abs(degrees) <= EPSILON) return 1;
  const radians = (degrees * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(radians));
  const absSin = Math.abs(Math.sin(radians));
  return Math.max(absCos + absSin / aspect, aspect * absSin + absCos);
}

function straightenForward(point: NormalizedPoint, aspect: number, degrees: number): NormalizedPoint {
  if (Math.abs(degrees) <= EPSILON) return point;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scale = straightenScale(aspect, degrees);
  const centeredX = (point.x - 0.5) * aspect;
  const centeredY = point.y - 0.5;
  const x = (cos * centeredX - sin * centeredY) * scale;
  const y = (sin * centeredX + cos * centeredY) * scale;
  return { x: x / aspect + 0.5, y: y + 0.5 };
}

function straightenInverse(point: NormalizedPoint, aspect: number, degrees: number): NormalizedPoint {
  if (Math.abs(degrees) <= EPSILON) return point;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scale = straightenScale(aspect, degrees);
  const centeredX = (point.x - 0.5) * aspect;
  const centeredY = point.y - 0.5;
  const x = (cos * centeredX + sin * centeredY) / scale;
  const y = (-sin * centeredX + cos * centeredY) / scale;
  return { x: x / aspect + 0.5, y: y + 0.5 };
}

/** Source image coordinates -> corrected output coordinates (all normalized). */
export function sourceToGeometry(
  point: NormalizedPoint,
  geometry: GeometryTransform,
  sourceAspect: number,
): NormalizedPoint {
  let result = { x: point.x, y: point.y };
  if (geometry.flipHorizontal) result.x = 1 - result.x;
  if (geometry.flipVertical) result.y = 1 - result.y;
  result = rotateForward(result, geometry.rotation);
  result = straightenForward(result, rotatedAspect(geometry.rotation, sourceAspect), geometry.straighten);
  if (geometry.crop) {
    result = {
      x: (result.x - geometry.crop.x) / geometry.crop.width,
      y: (result.y - geometry.crop.y) / geometry.crop.height,
    };
  }
  return result;
}

/** Corrected output coordinates -> source image coordinates (inverse mapping). */
export function geometryToSource(
  point: NormalizedPoint,
  geometry: GeometryTransform,
  sourceAspect: number,
): NormalizedPoint {
  let result = { x: point.x, y: point.y };
  if (geometry.crop) {
    result = {
      x: result.x * geometry.crop.width + geometry.crop.x,
      y: result.y * geometry.crop.height + geometry.crop.y,
    };
  }
  result = straightenInverse(result, rotatedAspect(geometry.rotation, sourceAspect), geometry.straighten);
  result = rotateInverse(result, geometry.rotation);
  if (geometry.flipHorizontal) result.x = 1 - result.x;
  if (geometry.flipVertical) result.y = 1 - result.y;
  return result;
}

/** Output image aspect after rotation and crop. */
export function geometryOutputAspect(geometry: GeometryTransform, sourceAspect: number): number {
  const rotated = rotatedAspect(geometry.rotation, sourceAspect);
  return geometry.crop ? rotated * (geometry.crop.width / geometry.crop.height) : rotated;
}
