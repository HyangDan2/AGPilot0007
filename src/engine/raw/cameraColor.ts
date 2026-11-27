import type { ColorMatrices, ColorMatrix } from 'flashraw';

/**
 * Camera colour-matrix validation (CP3-03 §5).
 *
 * flashraw already converts camera RGB to linear sRGB for `output: 'linear-rgb'`,
 * so these helpers are used to *verify provenance and numerical validity* of the
 * metadata and to test the conversion model on synthetic patches. They are not
 * applied to decoded pixels (that would convert twice).
 *
 * Fallback contract: when `colorMatrices.source` is `'none'` or the forward
 * matrix is missing/non-finite, no per-camera adaptation claim is made; WB falls
 * back to the as-shot camera multipliers and the report carries a warning.
 */

export type CameraColorStatus = 'verified' | 'missing' | 'invalid';

export interface CameraColorReport {
  status: CameraColorStatus;
  source: 'file' | 'camera-db' | 'none';
  /** Row-major 3x3, camera → XYZ(D50). */
  forward: number[] | null;
  forwardTemperatureK: number | null;
  /** Row-major 3x3, XYZ → camera. */
  color: number[] | null;
  colorTemperatureK: number | null;
  reason: string | null;
}

const EPSILON = 1e-9;

export function isFiniteMatrix(values: unknown, rows = 3): values is number[] {
  return Array.isArray(values)
    && values.length === rows * 3
    && values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

interface PickedMatrix { values: number[]; temperatureK: number | null }

function pickMatrix(entries: ColorMatrix[] | undefined): PickedMatrix | null {
  if (!Array.isArray(entries)) return null;
  const usable = entries.filter((entry) => entry && entry.rows === 3 && isFiniteMatrix(entry.values));
  if (usable.length === 0) return null;
  // Prefer the D65 calibration (EXIF LightSource 21 / DNG illuminant 21), then the first entry.
  const chosen = usable.find((entry) => entry.illuminant === 21) ?? usable[0];
  return {
    values: [...chosen.values],
    temperatureK: typeof chosen.temperature === 'number' && Number.isFinite(chosen.temperature) ? chosen.temperature : null,
  };
}

export function invert3x3(matrix: readonly number[]): number[] | null {
  if (!isFiniteMatrix(matrix)) return null;
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return null;
  const scale = 1 / det;
  const inverse = [
    (e * i - f * h) * scale, (c * h - b * i) * scale, (b * f - c * e) * scale,
    (f * g - d * i) * scale, (a * i - c * g) * scale, (c * d - a * f) * scale,
    (d * h - e * g) * scale, (b * g - a * h) * scale, (a * e - b * d) * scale,
  ];
  return inverse.every((value) => Number.isFinite(value)) ? inverse : null;
}

export function apply3x3(matrix: readonly number[], vector: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

export function inspectCameraColor(metadata: { colorMatrices?: ColorMatrices | null }): CameraColorReport {
  const matrices = metadata.colorMatrices;
  if (!matrices || matrices.source === 'none') {
    return {
      status: 'missing',
      source: matrices?.source ?? 'none',
      forward: null,
      forwardTemperatureK: null,
      color: null,
      colorTemperatureK: null,
      reason: 'no camera colour matrices (source: none)',
    };
  }
  const forward = pickMatrix(matrices.forward);
  const color = pickMatrix(matrices.color);
  const base = {
    source: matrices.source,
    forward: forward?.values ?? null,
    forwardTemperatureK: forward?.temperatureK ?? null,
    color: color?.values ?? null,
    colorTemperatureK: color?.temperatureK ?? null,
  } as const;
  if (!color) {
    return { ...base, status: 'invalid', reason: 'XYZ→camera colour matrix is missing or non-finite' };
  }
  if (!forward) {
    return { ...base, status: 'invalid', reason: 'camera→XYZ forward matrix is missing or non-finite' };
  }
  if (!invert3x3(forward.values)) {
    return { ...base, status: 'invalid', reason: 'camera→XYZ forward matrix is singular' };
  }
  return { ...base, status: 'verified', reason: null };
}

/** Camera RGB → absolute XYZ under D50 (DNG ForwardMatrix convention). */
export function cameraRgbToXyzD50(forward: readonly number[], rgb: readonly [number, number, number]): [number, number, number] {
  return apply3x3(forward, rgb);
}

/**
 * D50 XYZ → linear sRGB, Bradford-adapted (IEC 61966-2-1 primaries with the
 * standard D50 white). Used for synthetic-patch validation only.
 */
export const XYZ_D50_TO_LINEAR_SRGB: readonly number[] = Object.freeze([
  3.1338561, -1.6168667, -0.4906146,
  -0.9787684, 1.9161415, 0.0334540,
  0.0719453, -0.2289914, 1.4052427,
]);

export function xyzD50ToLinearSrgb(xyz: readonly [number, number, number]): [number, number, number] {
  return apply3x3(XYZ_D50_TO_LINEAR_SRGB, xyz);
}

export function cameraRgbToLinearSrgb(forward: readonly number[], rgb: readonly [number, number, number]): [number, number, number] {
  return xyzD50ToLinearSrgb(cameraRgbToXyzD50(forward, rgb));
}
