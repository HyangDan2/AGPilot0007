import type { RawMetadata } from 'flashraw';
import {
  RAW_DEVELOP_FALLBACK_TEMPERATURE_K,
  defaultRawDevelopSettings,
  normalizeRawDevelop,
  rawDevelopIsIdentity,
  type RawDevelopSettings,
  type RawHighlightRecovery,
} from '../../types/rawDevelop';
import { apply3x3, invert3x3, inspectCameraColor, type CameraColorReport } from './cameraColor';

/**
 * RAW develop model (CP3-03 §1–2).
 *
 * White balance is expressed as absolute kelvin + tint and converted to camera
 * RGB multipliers from metadata only:
 *   as-shot neutral (DNG AsShotNeutral, else inverse as-shot multipliers)
 *   → target white XYZ (CIE daylight/Planckian approximations, D50-adapted with Bradford)
 *   → camera neutral via the forward matrix → multipliers normalised to G = 1.
 * When the ForwardMatrix tag is absent, the camera→XYZ matrix is derived from
 * the DNG ColorMatrix (inverse + Bradford adaptation to D50) and the report
 * marks it as derived; only when no ColorMatrix exists either are the as-shot
 * multipliers returned unchanged (documented fallback, no silent assumption).
 */

export type RawWhiteBalanceStatus =
  | 'as-shot'
  | 'adapted'
  | 'camera-applied'
  | 'no-camera-neutral'
  | 'matrix-missing'
  | 'adaptation-failed';

export interface RawWhiteBalanceInfo {
  /** As-shot camera multipliers normalised to G = 1. */
  asShotMultipliers: [number, number, number] | null;
  /** As-shot camera RGB of the neutral, normalised to G = 1. */
  asShotNeutral: [number, number, number] | null;
  appliedByCamera: boolean;
  forwardMatrix: number[] | null;
  /** True when `forwardMatrix` was derived from the DNG ColorMatrix (no ForwardMatrix tag). */
  forwardDerived?: boolean;
  /** Best-effort as-shot CCT (McCamy approximation) or null. */
  asShotTemperatureK: number | null;
  color: CameraColorReport;
}

export interface RawWhiteBalanceResult {
  multipliers: [number, number, number];
  status: RawWhiteBalanceStatus;
  warnings: string[];
}

export interface RawDevelopReport {
  settings: RawDevelopSettings;
  whiteBalance: RawWhiteBalanceResult;
  asShotTemperatureK: number | null;
  /** DNG BaselineExposure hint; not auto-applied with tone 'linear'. */
  baselineExposureEv: number | null;
  color: CameraColorReport;
  warnings: string[];
}

export interface RawDevelopDecodeOptions {
  output: 'linear-rgb';
  sampleType: 'f16';
  tone: 'linear';
  demosaic: 'half-size' | 'auto';
  highlights: 'clip' | 'blend' | 'reconstruct';
  exposure: number;
  whiteBalanceMultipliers?: [number, number, number];
}

/**
 * Q01 must zero its shader exposure/WB uniforms for RAW sources: the develop
 * seam already applied them at decode time (avoid double application).
 */
export const RAW_DEVELOP_SHADER_UNIFORMS = Object.freeze({ exposureEv: 0, temperature: 0, tint: 0 });

const TINT_Y_SHIFT = 0.05;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const temperatureEquals = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

function normalizeToGreen(values: readonly number[]): [number, number, number] | null {
  if (values.length !== 3 || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const green = values[1];
  if (!(green > 0)) return null;
  const normalized: [number, number, number] = [values[0] / green, 1, values[2] / green];
  return normalized.every((value) => Number.isFinite(value)) ? normalized : null;
}

/** CIE daylight / Planckian approximations (Kim et al.), valid 1667–25000 K. */
function cctToXy(kelvin: number, tint: number): [number, number] {
  const t = clamp(kelvin, 1667, 25000);
  const x = t <= 4000
    ? -0.2661239e9 / (t ** 3) - 0.2343589e6 / (t ** 2) + 0.8776956e3 / t + 0.179910
    : -3.0258469e9 / (t ** 3) + 2.1070379e6 / (t ** 2) + 0.2226347e3 / t + 0.240390;
  const y = t <= 2222
    ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  // Tint shifts the chromaticity along the green/magenta axis in y (documented approximation).
  return [x, y + (clamp(tint, -100, 100) / 100) * TINT_Y_SHIFT];
}

/** McCamy correlated-colour-temperature approximation. */
function cctFromXy([x, y]: readonly [number, number]): number | null {
  const denominator = 0.1858 - y;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) return null;
  const n = (x - 0.3320) / denominator;
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  return Number.isFinite(cct) && cct > 0 ? cct : null;
}

function xyzFromXy([x, y]: readonly [number, number]): [number, number, number] | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 1e-6) return null;
  return [x / y, 1, (1 - x - y) / y];
}

function targetWhiteXyz(kelvin: number, tint: number): [number, number, number] | null {
  // Absolute XYZ of the target illuminant white. The forward matrix is calibrated
  // at D50, so no chromatic adaptation is applied here; identity at the as-shot
  // temperature is guaranteed by the shortcut in `rawWhiteBalanceMultipliers`.
  return xyzFromXy(cctToXy(kelvin, tint));
}

/** Bradford cone-response matrix and its inverse (linear sRGB working space). */
const BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV = [
  0.9869929, -0.1470543, 0.1599627,
  0.4323053, 0.5183603, 0.0492912,
  -0.0085287, 0.0400428, 0.9684867,
];

const ILLUMINANT_WHITE_XY: Readonly<Record<number, readonly [number, number]>> = Object.freeze({
  17: [0.44757, 0.40745], // Standard A
  19: [0.29902, 0.31485], // Illuminant C-like
  20: [0.34842, 0.35161], // D55
  21: [0.31271, 0.32902], // D65
  23: [0.34567, 0.3585], // D50
});

const D50_XY: readonly [number, number] = [0.34567, 0.3585];

function multiply3x3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row * 3 + column] = a[row * 3] * b[column]
        + a[row * 3 + 1] * b[3 + column]
        + a[row * 3 + 2] * b[6 + column];
    }
  }
  return out;
}

function bradfordAdaptation(sourceXy: readonly [number, number]): number[] | null {
  const source = xyzFromXy(sourceXy);
  const target = xyzFromXy(D50_XY);
  if (!source || !target) return null;
  const sourceLms = apply3x3(BRADFORD, source);
  const targetLms = apply3x3(BRADFORD, target);
  if (!sourceLms.every((value) => Math.abs(value) > 1e-9)) return null;
  const scale = [
    targetLms[0] / sourceLms[0], 0, 0,
    0, targetLms[1] / sourceLms[1], 0,
    0, 0, targetLms[2] / sourceLms[2],
  ];
  return multiply3x3(BRADFORD_INV, multiply3x3(scale, BRADFORD));
}

/**
 * Camera→XYZ(D50) from a DNG ColorMatrix when no ForwardMatrix tag exists:
 * invert the XYZ→camera matrix at its illuminant, then Bradford-adapt that
 * white to D50. Standard DNG approximation; the report marks it as derived.
 */
export function deriveForwardMatrixFromColorMatrices(
  matrices: readonly { illuminant: number; temperature: number | null; rows: number; values: number[] }[] | null | undefined,
): { matrix: number[]; sourceTemperatureK: number | null } | null {
  if (!matrices || matrices.length === 0) return null;
  const usable = matrices.filter((matrix) => matrix.rows === 3 && matrix.values.length === 9 && matrix.values.every((value) => Number.isFinite(value)));
  const pick = usable.find((matrix) => matrix.illuminant === 21)
    ?? usable.find((matrix) => typeof matrix.temperature === 'number' && Number.isFinite(matrix.temperature))
    ?? usable[0];
  if (!pick) return null;
  const sourceXy = ILLUMINANT_WHITE_XY[pick.illuminant]
    ?? (typeof pick.temperature === 'number' ? cctToXy(pick.temperature, 0) : null);
  if (!sourceXy) return null;
  const cameraToXyz = invert3x3(pick.values);
  if (!cameraToXyz) return null;
  const adaptation = bradfordAdaptation(sourceXy);
  if (!adaptation) return null;
  const forward = multiply3x3(adaptation, cameraToXyz);
  if (!forward.every((value) => Number.isFinite(value))) return null;
  return { matrix: forward, sourceTemperatureK: typeof pick.temperature === 'number' ? pick.temperature : null };
}

export function readWhiteBalanceInfo(metadata: RawMetadata): RawWhiteBalanceInfo {
  const color = inspectCameraColor(metadata);
  const wb = metadata.whiteBalance;
  const asShotMultipliers = wb && wb.every((value) => Number.isFinite(value) && value > 0)
    ? normalizeToGreen([wb[0] / wb[1], 1, wb[2] / wb[1]])
    : null;

  let asShotNeutral: [number, number, number] | null = null;
  const dngNeutral = metadata.dng?.asShotNeutral;
  if (Array.isArray(dngNeutral) && dngNeutral.length === 3) {
    asShotNeutral = normalizeToGreen(dngNeutral);
  } else if (asShotMultipliers) {
    asShotNeutral = normalizeToGreen([1 / asShotMultipliers[0], 1, 1 / asShotMultipliers[2]]);
  } else if (metadata.whiteBalanceApplied) {
    asShotNeutral = [1, 1, 1];
  }

  let forwardMatrix = color.forward;
  let forwardDerived = false;
  if (!forwardMatrix) {
    const derived = deriveForwardMatrixFromColorMatrices(metadata.colorMatrices?.color);
    if (derived) {
      forwardMatrix = derived.matrix;
      forwardDerived = true;
    }
  }

  let asShotTemperatureK: number | null = null;
  const asShotXy = metadata.dng?.asShotWhiteXY;
  if (Array.isArray(asShotXy) && asShotXy.length === 2 && asShotXy.every((value) => Number.isFinite(value))) {
    asShotTemperatureK = cctFromXy([asShotXy[0], asShotXy[1]]);
  }
  if (asShotTemperatureK === null && forwardMatrix && asShotNeutral) {
    const xyz = apply3x3(forwardMatrix, asShotNeutral);
    const sum = xyz[0] + xyz[1] + xyz[2];
    if (sum > 1e-9) asShotTemperatureK = cctFromXy([xyz[0] / sum, xyz[1] / sum]);
  }

  return {
    asShotMultipliers,
    asShotNeutral,
    appliedByCamera: metadata.whiteBalanceApplied,
    forwardMatrix,
    forwardDerived,
    asShotTemperatureK,
    color,
  };
}

export function resolveRawDevelopSettings(
  value: Partial<RawDevelopSettings> | null | undefined,
  info: RawWhiteBalanceInfo,
): RawDevelopSettings {
  return normalizeRawDevelop(value, defaultRawDevelopSettings(info.asShotTemperatureK));
}

export function rawWhiteBalanceMultipliers(
  settings: RawDevelopSettings,
  info: RawWhiteBalanceInfo,
): RawWhiteBalanceResult {
  const warnings: string[] = [];
  const reference = info.asShotTemperatureK ?? RAW_DEVELOP_FALLBACK_TEMPERATURE_K;
  const atAsShot = temperatureEquals(settings.temperatureK, reference) && settings.tint === 0;

  if (info.appliedByCamera) {
    if (!atAsShot) {
      warnings.push('Camera already applied white balance; temperature/tint develop offsets are ignored.');
    }
    return { multipliers: [1, 1, 1], status: 'camera-applied', warnings };
  }
  if (!info.asShotNeutral || !info.asShotMultipliers) {
    warnings.push('No as-shot camera neutral available; decoder white balance left untouched.');
    return { multipliers: [1, 1, 1], status: 'no-camera-neutral', warnings };
  }
  if (info.asShotTemperatureK === null) {
    warnings.push(`As-shot temperature unavailable; ${RAW_DEVELOP_FALLBACK_TEMPERATURE_K} K used as the identity reference.`);
  }
  if (atAsShot) {
    return { multipliers: info.asShotMultipliers, status: 'as-shot', warnings };
  }
  if (!info.forwardMatrix) {
    warnings.push('Camera→XYZ forward matrix missing; temperature/tint not applied (as-shot multipliers kept).');
    return { multipliers: info.asShotMultipliers, status: 'matrix-missing', warnings };
  }
  const inverse = invert3x3(info.forwardMatrix);
  const target = targetWhiteXyz(settings.temperatureK, settings.tint);
  if (!inverse || !target) {
    warnings.push('White-balance adaptation failed; as-shot multipliers kept.');
    return { multipliers: info.asShotMultipliers, status: 'adaptation-failed', warnings };
  }
  const neutralTarget = normalizeToGreen(apply3x3(inverse, target));
  if (!neutralTarget) {
    warnings.push('White-balance adaptation produced an invalid neutral; as-shot multipliers kept.');
    return { multipliers: info.asShotMultipliers, status: 'adaptation-failed', warnings };
  }
  const raw = normalizeToGreen([1 / neutralTarget[0], 1, 1 / neutralTarget[2]]);
  if (!raw) {
    warnings.push('White-balance multipliers were not positive; as-shot multipliers kept.');
    return { multipliers: info.asShotMultipliers, status: 'adaptation-failed', warnings };
  }
  const multipliers: [number, number, number] = [
    clamp(raw[0], 0.05, 20),
    clamp(raw[1], 0.05, 20),
    clamp(raw[2], 0.05, 20),
  ];
  if (multipliers.some((value, index) => value !== raw[index])) {
    warnings.push('White-balance multipliers were clamped to a safe range.');
  }
  if (info.forwardDerived) {
    warnings.push('Camera→XYZ forward matrix missing; derived from the file colour matrix with Bradford adaptation.');
  }
  return { multipliers, status: 'adapted', warnings };
}

function highlightOption(mode: RawHighlightRecovery): RawDevelopDecodeOptions['highlights'] {
  return mode === 'blend' ? 'blend' : mode === 'reconstruct' ? 'reconstruct' : 'clip';
}

export function rawDevelopDecodeOptions(
  settings: RawDevelopSettings,
  whiteBalance: RawWhiteBalanceResult,
  mode: 'preview' | 'export',
): RawDevelopDecodeOptions {
  return {
    output: 'linear-rgb',
    sampleType: 'f16',
    tone: 'linear',
    demosaic: mode === 'preview' ? 'half-size' : 'auto',
    highlights: highlightOption(settings.highlightRecovery),
    exposure: settings.exposureEv,
    ...(whiteBalance.multipliers ? { whiteBalanceMultipliers: whiteBalance.multipliers } : {}),
  };
}

export function createRawDevelopReport(
  settings: RawDevelopSettings,
  info: RawWhiteBalanceInfo,
  whiteBalance: RawWhiteBalanceResult,
  metadata: RawMetadata,
): RawDevelopReport {
  const warnings = [...whiteBalance.warnings];
  if (info.color.status === 'missing') {
    warnings.push('No camera colour matrices in metadata; colour follows the decoder default rendering.');
  } else if (info.color.status === 'invalid') {
    warnings.push(`Camera colour matrices unusable (${info.color.reason ?? 'invalid'}); decoder default rendering used.`);
  }
  return {
    settings,
    whiteBalance,
    asShotTemperatureK: info.asShotTemperatureK,
    baselineExposureEv: metadata.dng?.baselineExposure ?? null,
    color: info.color,
    warnings,
  };
}

export { rawDevelopIsIdentity };
