import { applyMat3, invertMat3, type Mat3, type Vec2 } from './homography';
import { distortNormalized, undistortNormalized, type DistortionParams } from './distortion';

// Coordinate contract
// - Pixel space: origin top-left, x right, y down, range [0, width] x [0, height].
// - NIS (normalized image space): u = x / width, v = y / height, range [0, 1].
//   NIS is invariant between preview (longest edge <= 2048 px) and export
//   (source resolution), which is what keeps preview/export parity exact.
// - Centered space: x = (u - 0.5) * 2, y = (v - 0.5) * 2; corners at +/-1 and
//   corner radius sqrt(2). Lens distortion coefficients live in this space.
// - Short-side units: x = u * (width / min(width, height)), y = v * (height /
//   min(width, height)); one unit equals the image short side, so mask radii and
//   feather widths are isotropic and resolution independent.

export function pixelToUv(px: number, py: number, width: number, height: number): Vec2 {
  return { x: px / width, y: py / height };
}

export function uvToPixel(uv: Vec2, width: number, height: number): Vec2 {
  return { x: uv.x * width, y: uv.y * height };
}

export function uvToCentered(uv: Vec2): Vec2 {
  return { x: (uv.x - 0.5) * 2, y: (uv.y - 0.5) * 2 };
}

export function centeredToUv(p: Vec2): Vec2 {
  return { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5 };
}

export function uvToShortSide(uv: Vec2, aspect: number): Vec2 {
  const scaleX = aspect >= 1 ? aspect : 1;
  const scaleY = aspect >= 1 ? 1 : 1 / aspect;
  return { x: uv.x * scaleX, y: uv.y * scaleY };
}

export function shortSideToUv(p: Vec2, aspect: number): Vec2 {
  const scaleX = aspect >= 1 ? aspect : 1;
  const scaleY = aspect >= 1 ? 1 : 1 / aspect;
  return { x: p.x / scaleX, y: p.y / scaleY };
}

export interface OpticalGeometry {
  // Sampling homography corrected NIS -> source NIS (unit square stretched onto
  // the captured source region).
  homography: Mat3;
  distortion?: DistortionParams;
}

// Output (corrected) UV -> source UV, as used by a sampling shader.
export function correctedToSource(uv: Vec2, geometry: OpticalGeometry): Vec2 {
  const centered = uvToCentered(uv);
  const distorted = geometry.distortion
    ? distortNormalized(centered, geometry.distortion)
    : centered;
  return applyMat3(geometry.homography, centeredToUv(distorted));
}

// Source UV -> output (corrected) UV. Used to place or re-register masks,
// sampling points and UI overlays that were defined on the source image.
export function sourceToCorrected(uv: Vec2, geometry: OpticalGeometry): Vec2 {
  const inverse = invertMat3(geometry.homography);
  const pre = applyMat3(inverse, uv);
  const centered = uvToCentered(pre);
  const undistorted = geometry.distortion
    ? undistortNormalized(centered, geometry.distortion)
    : centered;
  return centeredToUv(undistorted);
}

export function isInsideUnitSquare(p: Vec2, epsilon = 0): boolean {
  return (
    p.x >= -epsilon && p.x <= 1 + epsilon && p.y >= -epsilon && p.y <= 1 + epsilon
  );
}
