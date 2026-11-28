import {
  applyOpticalHomography,
  createPerspectiveQuad,
  validateOpticalTransform,
  type Mat3,
  type OpticalTransform,
  type PerspectiveQuad,
  type Point2,
} from '../contracts/optical';

export interface OpticalUniforms {
  /** Column-major mat3 for uniformMatrix3fv(location, false, values). */
  homography: Float32Array;
  radial: readonly [number, number, number, number];
  tangential: readonly [number, number];
}

export function normalizeOpticalTransform(value: unknown): OpticalTransform {
  validateOpticalTransform(value);
  return {
    version: 1,
    homography: [...value.homography],
    ...(value.distortion ? { distortion: { ...value.distortion } } : {}),
    ...(value.perspective
      ? {
          perspective: [
            { x: value.perspective[0].x, y: value.perspective[0].y },
            { x: value.perspective[1].x, y: value.perspective[1].y },
            { x: value.perspective[2].x, y: value.perspective[2].y },
            { x: value.perspective[3].x, y: value.perspective[3].y },
          ] as const,
        }
      : {}),
  };
}

/** Rejects non-invertible coefficients before any render is scheduled. */
export function assertOpticalRenderable(value: unknown): OpticalTransform {
  return normalizeOpticalTransform(value);
}

/**
 * Solves the projective mapping from the unit square (TL, TR, BR, BL) to the
 * supplied perspective quad. The returned row-major matrix is the corrected-NIS
 * -> source-NIS homography used by the optical sampler.
 */
export function homographyFromPerspectiveQuad(quad: PerspectiveQuad): Mat3 {
  const [q0, q1, q2, q3] = quad;
  const dx1 = q1.x - q2.x;
  const dx2 = q3.x - q2.x;
  const dx3 = q0.x - q1.x + q2.x - q3.x;
  const dy1 = q1.y - q2.y;
  const dy2 = q3.y - q2.y;
  const dy3 = q0.y - q1.y + q2.y - q3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-12) {
    throw new Error('Optical perspective quad is degenerate');
  }
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = q1.x - q0.x + g * q1.x;
  const b = q3.x - q0.x + h * q3.x;
  const d = q1.y - q0.y + g * q1.y;
  const e = q3.y - q0.y + h * q3.y;
  const values = [a, b, q0.x, d, e, q0.y, g, h, 1];
  if (!values.every(Number.isFinite)) {
    throw new Error('Optical perspective quad is degenerate');
  }
  const homography = values.map((value) => (value === 0 ? 0 : value));
  validateOpticalTransform({ version: 1, homography, perspective: quad });
  return homography;
}

/**
 * Builds a validated perspective-only optical transform from the same
 * vertical/horizontal controls as the frozen perspective quad helper.
 */
export function createPerspectiveTransform(vertical: number, horizontal: number): OpticalTransform {
  const perspective = createPerspectiveQuad(vertical, horizontal);
  const homography = homographyFromPerspectiveQuad(perspective);
  return normalizeOpticalTransform({ version: 1, homography, perspective });
}

export function opticalIsIdentity(value: OpticalTransform): boolean {
  if (!Array.isArray(value.homography)) return false;
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (
    value.homography.length !== 9 ||
    !value.homography.every((entry, index) => Math.abs(entry - identity[index]) <= 1e-12)
  ) {
    return false;
  }
  const distortion = value.distortion;
  if (!distortion) return true;
  return (
    Math.abs(distortion.k1) <= 1e-12 &&
    Math.abs(distortion.k2 ?? 0) <= 1e-12 &&
    Math.abs(distortion.k3 ?? 0) <= 1e-12 &&
    Math.abs(distortion.p1 ?? 0) <= 1e-12 &&
    Math.abs(distortion.p2 ?? 0) <= 1e-12
  );
}

/** Corrected NIS -> source NIS: Brown-Conrady in centered space, then homography. */
export function opticalCorrectedToSource(uv: Point2, transform: OpticalTransform): Point2 {
  const x = (uv.x - 0.5) * 2;
  const y = (uv.y - 0.5) * 2;
  const distortion = transform.distortion;
  let cx = x;
  let cy = y;
  if (distortion) {
    const k1 = distortion.k1;
    const k2 = distortion.k2 ?? 0;
    const k3 = distortion.k3 ?? 0;
    const p1 = distortion.p1 ?? 0;
    const p2 = distortion.p2 ?? 0;
    const r2 = x * x + y * y;
    const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    cx = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    cy = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
  }
  return applyOpticalHomography(transform.homography, { x: cx * 0.5 + 0.5, y: cy * 0.5 + 0.5 });
}

export function opticalUniforms(transform: OpticalTransform): OpticalUniforms {
  const m = transform.homography;
  const d = transform.distortion;
  return {
    homography: new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]),
    radial: [d?.k1 ?? 0, d?.k2 ?? 0, d?.k3 ?? 0, 0],
    tangential: [d?.p1 ?? 0, d?.p2 ?? 0],
  };
}

/**
 * GLSL ES 3.00 mirror of opticalCorrectedToSource. The perspective quad is
 * provenance only; sampling uses its solved homography, exactly like the CPU path.
 */
export const OPTICAL_SHADER_CHUNK = /* glsl */ `
uniform mat3 u_q02_optical_h;
uniform vec4 u_q02_optical_radial;
uniform vec2 u_q02_optical_tangential;

vec2 q02_optical_corrected_to_source(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float radial = 1.0 + u_q02_optical_radial.x * r2
                   + u_q02_optical_radial.y * r2 * r2
                   + u_q02_optical_radial.z * r2 * r2 * r2;
  vec2 q = vec2(
    p.x * radial + 2.0 * u_q02_optical_tangential.x * p.x * p.y
      + u_q02_optical_tangential.y * (r2 + 2.0 * p.x * p.x),
    p.y * radial + u_q02_optical_tangential.x * (r2 + 2.0 * p.y * p.y)
      + 2.0 * u_q02_optical_tangential.y * p.x * p.y
  );
  vec3 h = u_q02_optical_h * vec3(q * 0.5 + 0.5, 1.0);
  return h.xy / h.z;
}
`;
