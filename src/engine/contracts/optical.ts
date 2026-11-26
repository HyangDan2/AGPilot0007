export interface Point2 {
  x: number;
  y: number;
}

/** Row-major 3x3 projective matrix mapped in normalized image space (NIS). */
export type Mat3 = readonly number[];

export interface DistortionParams {
  k1: number;
  k2?: number;
  k3?: number;
  p1?: number;
  p2?: number;
}

/** Unit-square corners mapped to a source sampling quad: TL, TR, BR, BL. */
export type PerspectiveQuad = readonly [Point2, Point2, Point2, Point2];

/**
 * Optical correction contract shared with Q02. The homography maps corrected
 * NIS coordinates to source NIS; lens distortion is applied in centered space
 * before the homography (Brown-Conrady). Q02 owns the solving and resampling
 * implementation.
 */
export interface OpticalTransform {
  version: 1;
  homography: Mat3;
  distortion?: DistortionParams;
  perspective?: PerspectiveQuad;
}

export const IDENTITY_OPTICAL_HOMOGRAPHY: Mat3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export const OPTICAL_MAX_K1 = 1.5;
export const OPTICAL_MAX_DISTORTION = 1;
export const OPTICAL_MAX_TANGENTIAL = 0.5;
export const OPTICAL_PERSPECTIVE_STRENGTH = 0.15;
export const OPTICAL_MATRIX_EPSILON = 1e-8;

const DISTORTION_DOMAIN_RADIUS = 1.5;
const DISTORTION_RADIAL_SAMPLES = 256;
const DISTORTION_JACOBIAN_EXTENT = 1.2;
const DISTORTION_JACOBIAN_STEPS = 16;
const DISTORTION_INVERTIBILITY_EPSILON = 1e-6;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function determinantMat3(matrix: readonly number[]): number {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function isInvertibleMat3(matrix: readonly number[]): boolean {
  if (!Array.isArray(matrix) || matrix.length !== 9 || !matrix.every(Number.isFinite)) return false;
  return Math.abs(determinantMat3(matrix)) > OPTICAL_MATRIX_EPSILON;
}

/**
 * Mirrors the Q02 runtime invertibility gate (OPTICAL_POC §12.1.1): the radial
 * profile must increase monotonically over the image domain and the full
 * Brown-Conrady Jacobian must stay positive when tangential terms are present.
 */
function isDistortionInvertible(k1: number, k2: number, k3: number, p1: number, p2: number): boolean {
  for (let i = 0; i <= DISTORTION_RADIAL_SAMPLES; i++) {
    const r = (i / DISTORTION_RADIAL_SAMPLES) * DISTORTION_DOMAIN_RADIUS;
    const r2 = r * r;
    const derivative = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2 + 7 * k3 * r2 * r2 * r2;
    if (derivative <= DISTORTION_INVERTIBILITY_EPSILON) return false;
  }
  if (p1 === 0 && p2 === 0) return true;
  for (let iy = 0; iy <= DISTORTION_JACOBIAN_STEPS; iy++) {
    for (let ix = 0; ix <= DISTORTION_JACOBIAN_STEPS; ix++) {
      const x = -DISTORTION_JACOBIAN_EXTENT + (2 * DISTORTION_JACOBIAN_EXTENT * ix) / DISTORTION_JACOBIAN_STEPS;
      const y = -DISTORTION_JACOBIAN_EXTENT + (2 * DISTORTION_JACOBIAN_EXTENT * iy) / DISTORTION_JACOBIAN_STEPS;
      const r2 = x * x + y * y;
      const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
      const radialDerivative = k1 + 2 * k2 * r2 + 3 * k3 * r2 * r2;
      const j00 = radial + 2 * x * x * radialDerivative + 2 * p1 * y + 6 * p2 * x;
      const j01 = 2 * x * y * radialDerivative + 2 * p1 * x + 2 * p2 * y;
      const j11 = radial + 2 * y * y * radialDerivative + 6 * p1 * y + 2 * p2 * x;
      if (j00 * j11 - j01 * j01 <= DISTORTION_INVERTIBILITY_EPSILON) return false;
    }
  }
  return true;
}

export function createOpticalTransform(overrides: Partial<OpticalTransform> = {}): OpticalTransform {
  return {
    version: 1,
    homography: [...IDENTITY_OPTICAL_HOMOGRAPHY],
    ...overrides,
  };
}

export function createPerspectiveQuad(
  vertical: number,
  horizontal: number,
  strength = OPTICAL_PERSPECTIVE_STRENGTH,
): PerspectiveQuad {
  const clamp = (value: number) => Math.min(1, Math.max(-1, value));
  const boundedStrength = Math.min(0.5, Math.max(0, Number.isFinite(strength) ? strength : OPTICAL_PERSPECTIVE_STRENGTH));
  const v = clamp(Number.isFinite(vertical) ? vertical : 0) * boundedStrength;
  const h = clamp(Number.isFinite(horizontal) ? horizontal : 0) * boundedStrength;
  return [
    { x: v, y: 0 },
    { x: 1 - v, y: h },
    { x: 1, y: 1 - h },
    { x: 0, y: 1 },
  ];
}

function isConvexQuad(quad: readonly Point2[]): boolean {
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

export function applyOpticalHomography(matrix: Mat3, point: Point2): Point2 {
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(w) <= OPTICAL_MATRIX_EPSILON) throw new Error('Optical point maps to infinity');
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w,
  };
}

export function validateOpticalTransform(value: unknown): asserts value is OpticalTransform {
  if (!isObject(value) || value.version !== 1) throw new Error('Invalid optical transform');
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
        (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || Math.abs(coefficient) > OPTICAL_MAX_DISTORTION)
      ) {
        throw new Error('Invalid optical distortion');
      }
    }
    for (const key of ['p1', 'p2'] as const) {
      const coefficient = distortion[key];
      if (
        coefficient !== undefined &&
        (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || Math.abs(coefficient) > OPTICAL_MAX_TANGENTIAL)
      ) {
        throw new Error('Invalid optical distortion');
      }
    }
    const k1 = distortion.k1 as number;
    const k2 = typeof distortion.k2 === 'number' ? distortion.k2 : 0;
    const k3 = typeof distortion.k3 === 'number' ? distortion.k3 : 0;
    const p1 = typeof distortion.p1 === 'number' ? distortion.p1 : 0;
    const p2 = typeof distortion.p2 === 'number' ? distortion.p2 : 0;
    if (!isDistortionInvertible(k1, k2, k3, p1, p2)) {
      throw new Error('Optical distortion is not invertible in the image domain');
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
    if (!isConvexQuad(perspective as Point2[])) throw new Error('Invalid optical perspective');
  }
}
