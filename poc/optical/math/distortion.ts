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

// Maps an undistorted centered point to its distorted location.
export function distortNormalized(p: Vec2, d: DistortionParams): Vec2 {
  const k1 = d.k1;
  const k2 = d.k2 ?? 0;
  const k3 = d.k3 ?? 0;
  const p1 = d.p1 ?? 0;
  const p2 = d.p2 ?? 0;
  const r2 = p.x * p.x + p.y * p.y;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  return {
    x: p.x * radial + 2 * p1 * p.x * p.y + p2 * (r2 + 2 * p.x * p.x),
    y: p.y * radial + p1 * (r2 + 2 * p.y * p.y) + 2 * p2 * p.x * p.y,
  };
}

// Inverts the distortion with a 2D Newton solve of distort(x) = q. A plain
// fixed-point iteration loses convergence once the radial derivative exceeds
// one away from the centre; Newton stays stable for the coefficient range used
// by the PoC (|k1| <= 0.5 in the corner-normalized domain).
export function undistortNormalized(
  q: Vec2,
  d: DistortionParams,
  options: { iterations?: number; tolerance?: number } = {}
): Vec2 {
  const iterations = options.iterations ?? MAX_ITERATIONS;
  const tolerance = options.tolerance ?? TOLERANCE;
  const k1 = d.k1;
  const k2 = d.k2 ?? 0;
  const k3 = d.k3 ?? 0;
  const p1 = d.p1 ?? 0;
  const p2 = d.p2 ?? 0;
  let x = q.x;
  let y = q.y;
  for (let i = 0; i < iterations; i++) {
    const r2 = x * x + y * y;
    const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 ** 3;
    const dRadial = k1 + 2 * k2 * r2 + 3 * k3 * r2 * r2;
    const tangentX = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const tangentY = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    const fx = x * radial + tangentX - q.x;
    const fy = y * radial + tangentY - q.y;
    if (Math.hypot(fx, fy) < tolerance) break;
    const j00 = radial + 2 * x * x * dRadial + 2 * p1 * y + 6 * p2 * x;
    const j01 = 2 * x * y * dRadial + 2 * p1 * x + 2 * p2 * y;
    const j10 = j01;
    const j11 = radial + 2 * y * y * dRadial + 6 * p1 * y + 2 * p2 * x;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-9) break;
    const stepX = (j11 * fx - j01 * fy) / det;
    const stepY = (j00 * fy - j10 * fx) / det;
    x -= stepX;
    y -= stepY;
    if (Math.hypot(stepX, stepY) < tolerance) break;
  }
  return { x, y };
}
