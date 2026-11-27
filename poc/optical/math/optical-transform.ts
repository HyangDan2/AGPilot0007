import type { Vec2 } from './homography';
import type { OpticalGeometry } from './coordinates';
import type { DistortionParams } from './distortion';

// Adapter for the Q01 shared optical contract (src/engine/contracts/optical.ts).
// Q02 keeps its own sampling geometry type; this module is the only place that
// knows the wire format, so the Q01 contract is never modified from here.
//
// Differences resolved here:
// - Q01 requires `version: 1` on the wire object; Q02 geometry has no version.
// - Q01 accepts an optional perspective quad (TL, TR, BR, BL) for provenance;
//   Q02 sampling only consumes the homography, so the quad is carried through
//   when supplied instead of being dropped.
// - Q01 rejects non-finite, singular homographies and invalid quads;
//   `toOpticalTransform` validates before returning so Q02 cannot emit an
//   object that Q01 would reject.

export const OPTICAL_TRANSFORM_VERSION = 1 as const;
export const OPTICAL_MATRIX_EPSILON = 1e-8;
export const OPTICAL_MAX_K1 = 1.5;
export const OPTICAL_MAX_DISTORTION = 1;
export const OPTICAL_MAX_TANGENTIAL = 0.5;

export interface OpticalTransformPoint {
  x: number;
  y: number;
}

/** Unit-square corners mapped to a source sampling quad: TL, TR, BR, BL. */
export type OpticalPerspectiveQuad = readonly [
  OpticalTransformPoint,
  OpticalTransformPoint,
  OpticalTransformPoint,
  OpticalTransformPoint,
];

export interface OpticalTransformV1 {
  version: 1;
  homography: readonly number[];
  distortion?: DistortionParams;
  perspective?: OpticalPerspectiveQuad;
}

export interface PocContractGeometry extends OpticalGeometry {
  perspective?: readonly Vec2[];
}

function determinantMat3(matrix: readonly number[]): number {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function isInvertibleMat3(matrix: readonly number[]): boolean {
  if (!Array.isArray(matrix) || matrix.length !== 9 || !matrix.every(Number.isFinite)) return false;
  return Math.abs(determinantMat3(matrix)) > OPTICAL_MATRIX_EPSILON;
}

function isConvexQuad(quad: readonly OpticalTransformPoint[]): boolean {
  let sign = 0;
  let area = 0;
  for (let index = 0; index < 4; index++) {
    const a = quad[index];
    const b = quad[(index + 1) % 4];
    const c = quad[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    area += cross;
    if (Math.abs(cross) <= 1e-12) return false;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (sign !== current) return false;
  }
  return Math.abs(area) > 1e-10;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Mirrors Q01 validateOpticalTransform: version, finite/invertible matrix,
// coefficient bounds, quad range and convexity.
export function assertOpticalTransform(value: unknown): asserts value is OpticalTransformV1 {
  if (!isObject(value) || value.version !== OPTICAL_TRANSFORM_VERSION) {
    throw new Error('Invalid optical transform');
  }
  const homography = value.homography;
  if (!Array.isArray(homography) || homography.length !== 9 || !homography.every((entry) => typeof entry === 'number')) {
    throw new Error('Invalid optical homography');
  }
  if (!homography.every(Number.isFinite)) throw new Error('Optical homography must be finite');
  if (!isInvertibleMat3(homography)) throw new Error('Optical homography is singular');

  const distortion = value.distortion;
  if (distortion !== undefined) {
    if (!isObject(distortion) || typeof distortion.k1 !== 'number' || !Number.isFinite(distortion.k1)) {
      throw new Error('Invalid optical distortion');
    }
    if (Math.abs(distortion.k1) > OPTICAL_MAX_K1) throw new Error('Invalid optical distortion');
    for (const key of ['k2', 'k3'] as const) {
      const coefficient = distortion[key];
      if (
        coefficient !== undefined &&
        (typeof coefficient !== 'number' ||
          !Number.isFinite(coefficient) ||
          Math.abs(coefficient) > OPTICAL_MAX_DISTORTION)
      ) {
        throw new Error('Invalid optical distortion');
      }
    }
    for (const key of ['p1', 'p2'] as const) {
      const coefficient = distortion[key];
      if (
        coefficient !== undefined &&
        (typeof coefficient !== 'number' ||
          !Number.isFinite(coefficient) ||
          Math.abs(coefficient) > OPTICAL_MAX_TANGENTIAL)
      ) {
        throw new Error('Invalid optical distortion');
      }
    }
  }

  const perspective = value.perspective;
  if (perspective !== undefined) {
    if (!Array.isArray(perspective) || perspective.length !== 4) {
      throw new Error('Invalid optical perspective');
    }
    for (const point of perspective) {
      if (
        !isObject(point) ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        (point.x as number) < -0.5 ||
        (point.x as number) > 1.5 ||
        (point.y as number) < -0.5 ||
        (point.y as number) > 1.5
      ) {
        throw new Error('Invalid optical perspective');
      }
    }
    if (!isConvexQuad(perspective as OpticalTransformPoint[])) {
      throw new Error('Invalid optical perspective');
    }
  }
}

function copyPerspective(quad: readonly Vec2[]): OpticalPerspectiveQuad {
  return quad.map((point) => ({ x: point.x, y: point.y })) as unknown as OpticalPerspectiveQuad;
}

export function toOpticalTransform(
  geometry: PocContractGeometry,
  perspective?: readonly Vec2[]
): OpticalTransformV1 {
  const quad = perspective ?? geometry.perspective;
  const transform: OpticalTransformV1 = {
    version: OPTICAL_TRANSFORM_VERSION,
    homography: [...geometry.homography],
    ...(geometry.distortion ? { distortion: { ...geometry.distortion } } : {}),
    ...(quad ? { perspective: copyPerspective(quad) } : {}),
  };
  assertOpticalTransform(transform);
  return transform;
}

export function fromOpticalTransform(value: unknown): PocContractGeometry {
  assertOpticalTransform(value);
  return {
    homography: [...value.homography],
    ...(value.distortion ? { distortion: { ...value.distortion } } : {}),
    ...(value.perspective ? { perspective: value.perspective.map((point) => ({ x: point.x, y: point.y })) } : {}),
  };
}