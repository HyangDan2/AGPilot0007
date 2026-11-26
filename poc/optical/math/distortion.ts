import type { Vec2 } from './homography';

// Brown-Conrady model in centered coordinates where image corners sit at
// (+/-1, +/-1); the corner radius is sqrt(2). k1..k3 are dimensionless radial
// coefficients, p1/p2 tangential coefficients. This is a virtual lens model:
// coefficients are not measured from a specific physical lens.
export interface DistortionParams {
  k1: number;
  k2?: number;
  k3?: number;
  p1?: number;
  p2?: number;
}

const MAX_ITERATIONS = 16;
const TOLERANCE = 1e-9;
// Application domain: the centered image reaches sqrt(2) at the corners; a
// small margin covers source-space lookups outside the unit square.
const DOMAIN_RADIUS = 1.5;
const JACOBIAN_EXTENT = 1.2;

function coefficients(d: DistortionParams): [number, number, number, number, number] {
  return [d.k1, d.k2 ?? 0, d.k3 ?? 0, d.p1 ?? 0, d.p2 ?? 0];
}

function jacobian(x: number, y: number, d: DistortionParams): [number, number, number, number] {
  const [k1, k2, k3, p1, p2] = coefficients(d);
  const r2 = x * x + y * y;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 ** 3;
  const dRadial = k1 + 2 * k2 * r2 + 3 * k3 * r2 * r2;
  const j00 = radial + 2 * x * x * dRadial + 2 * p1 * y + 6 * p2 * x;
  const j01 = 2 * x * y * dRadial + 2 * p1 * x + 2 * p2 * y;
  const j11 = radial + 2 * y * y * dRadial + 6 * p1 * y + 2 * p2 * x;
  return [j00, j01, j01, j11];
}

// A distortion is usable only when the forward map is locally one-to-one over
// the centered domain: the radial profile must increase monotonically and the
// tangential Jacobian determinant must stay positive. Folding coefficients are
// rejected instead of being silently inverted by Newton.
export function isDistortionInvertible(d: DistortionParams): boolean {
  const [k1, k2, k3, p1, p2] = coefficients(d);
  for (const value of [k1, k2, k3, p1, p2]) {
    if (!Number.isFinite(value)) return false;
  }
  for (let i = 0; i <= 256; i++) {
    const r = (i / 256) * DOMAIN_RADIUS;
    const r2 = r * r;
    const derivative = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2 + 7 * k3 * r2 ** 3;
    if (derivative <= 1e-6) return false;
  }
  if (p1 === 0 && p2 === 0) return true;
  for (let iy = 0; iy <= 16; iy++) {
    for (let ix = 0; ix <= 16; ix++) {
      const x = -JACOBIAN_EXTENT + (2 * JACOBIAN_EXTENT * ix) / 16;
      const y = -JACOBIAN_EXTENT + (2 * JACOBIAN_EXTENT * iy) / 16;
      const [j00, j01, j10, j11] = jacobian(x, y, d);
      if (j00 * j11 - j01 * j10 <= 1e-6) return false;
    }
  }
  return true;
}

// Maps an undistorted centered point to its distorted location.
export function distortNormalized(p: Vec2, d: DistortionParams): Vec2 {
  const [k1, k2, k3, p1, p2] = coefficients(d);
  const r2 = p.x * p.x + p.y * p.y;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  return {
    x: p.x * radial + 2 * p1 * p.x * p.y + p2 * (r2 + 2 * p.x * p.x),
    y: p.y * radial + p1 * (r2 + 2 * p.y * p.y) + 2 * p2 * p.x * p.y,
  };
}

export interface UndistortResult {
  ok: boolean;
  value: Vec2;
  residual: number;
  iterations: number;
  reason?: string;
}

// Inverts the distortion with a 2D Newton solve of distort(x) = q. The initial
// guess comes from a bracketed radial solve so strong (but monotonic)
// coefficients converge; the final residual is verified before reporting ok.
export function tryUndistortNormalized(
  q: Vec2,
  d: DistortionParams,
  options: { iterations?: number; tolerance?: number } = {}
): UndistortResult {
  const iterations = options.iterations ?? MAX_ITERATIONS;
  const tolerance = options.tolerance ?? TOLERANCE;
  if (!isDistortionInvertible(d)) {
    return { ok: false, value: { x: q.x, y: q.y }, residual: Infinity, iterations: 0, reason: 'non-invertible' };
  }
  const [k1, k2, k3] = coefficients(d);
  const targetRadius = Math.hypot(q.x, q.y);
  let x = q.x;
  let y = q.y;
  if (targetRadius > 0) {
    const radialAt = (r: number) => {
      const r2 = r * r;
      return r * (1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 ** 3);
    };
    if (radialAt(DOMAIN_RADIUS) < targetRadius) {
      return { ok: false, value: { x: q.x, y: q.y }, residual: Infinity, iterations: 0, reason: 'outside-domain' };
    }
    let lo = 0;
    let hi = DOMAIN_RADIUS;
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) * 0.5;
      if (radialAt(mid) < targetRadius) lo = mid;
      else hi = mid;
    }
    const scale = ((lo + hi) * 0.5) / targetRadius;
    x = q.x * scale;
    y = q.y * scale;
  }
  let used = 0;
  let residual = Math.hypot(distortNormalized({ x, y }, d).x - q.x, distortNormalized({ x, y }, d).y - q.y);
  for (let i = 0; i < iterations; i++) {
    used = i + 1;
    const mapped = distortNormalized({ x, y }, d);
    const fx = mapped.x - q.x;
    const fy = mapped.y - q.y;
    residual = Math.hypot(fx, fy);
    if (residual < tolerance) break;
    const [j00, j01, j10, j11] = jacobian(x, y, d);
    const det = j00 * j11 - j01 * j10;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      return { ok: false, value: { x, y }, residual, iterations: used, reason: 'singular-jacobian' };
    }
    const stepX = (j11 * fx - j01 * fy) / det;
    const stepY = (j00 * fy - j10 * fx) / det;
    if (!Number.isFinite(stepX) || !Number.isFinite(stepY)) {
      return { ok: false, value: { x, y }, residual, iterations: used, reason: 'diverged' };
    }
    x -= stepX;
    y -= stepY;
  }
  const finalMap = distortNormalized({ x, y }, d);
  residual = Math.hypot(finalMap.x - q.x, finalMap.y - q.y);
  if (!Number.isFinite(residual) || residual > Math.max(1e-6, tolerance * 10)) {
    return { ok: false, value: { x, y }, residual, iterations: used, reason: 'residual' };
  }
  return { ok: true, value: { x, y }, residual, iterations: used };
}

export function undistortNormalized(
  q: Vec2,
  d: DistortionParams,
  options: { iterations?: number; tolerance?: number } = {}
): Vec2 {
  const result = tryUndistortNormalized(q, d, options);
  if (!result.ok) throw new Error(`Distortion is not invertible at the requested point (${result.reason})`);
  return result.value;
}
