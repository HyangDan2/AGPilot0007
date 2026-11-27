/**
 * RAW develop settings owned by the RAW decoder seam (CP3-03).
 *
 * The values here are the single source of truth for both the preview develop
 * (half-size linear source) and the export-time full-resolution resolver, so
 * preview and export cannot drift.
 */

export type RawHighlightRecovery = 'off' | 'blend' | 'reconstruct';

export interface RawDevelopSettings {
  /** Exposure in EV, applied in linear light by the decoder. */
  exposureEv: number;
  /** Target illuminant temperature in kelvin (absolute, not a delta). */
  temperatureK: number;
  /** Green/magenta tint offset, -100..100. */
  tint: number;
  highlightRecovery: RawHighlightRecovery;
}

export const RAW_HIGHLIGHT_RECOVERY_MODES: readonly RawHighlightRecovery[] = ['off', 'blend', 'reconstruct'];

export const RAW_DEVELOP_LIMITS = Object.freeze({
  exposureEv: Object.freeze({ min: -5, max: 5 }),
  temperatureK: Object.freeze({ min: 2000, max: 50000 }),
  tint: Object.freeze({ min: -100, max: 100 }),
});

/** Documented fallback when the file carries no as-shot temperature. */
export const RAW_DEVELOP_FALLBACK_TEMPERATURE_K = 6500;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function isRawHighlightRecovery(value: unknown): value is RawHighlightRecovery {
  return value === 'off' || value === 'blend' || value === 'reconstruct';
}

export function defaultRawDevelopSettings(asShotTemperatureK: number | null = null): RawDevelopSettings {
  const temperatureK = asShotTemperatureK !== null && Number.isFinite(asShotTemperatureK)
    ? clamp(asShotTemperatureK, RAW_DEVELOP_LIMITS.temperatureK.min, RAW_DEVELOP_LIMITS.temperatureK.max)
    : RAW_DEVELOP_FALLBACK_TEMPERATURE_K;
  return { exposureEv: 0, temperatureK, tint: 0, highlightRecovery: 'off' };
}

/**
 * Deterministic normalisation: non-finite numbers fall back to the default,
 * out-of-range values are clamped, unknown recovery modes become 'off'.
 * Call `validateRawDevelop` first when the caller must reject instead.
 */
export function normalizeRawDevelop(
  value: Partial<RawDevelopSettings> | null | undefined,
  base: RawDevelopSettings,
): RawDevelopSettings {
  const source = value ?? {};
  const exposure = source.exposureEv;
  const temperature = source.temperatureK;
  const tint = source.tint;
  return {
    exposureEv: Number.isFinite(exposure)
      ? clamp(exposure as number, RAW_DEVELOP_LIMITS.exposureEv.min, RAW_DEVELOP_LIMITS.exposureEv.max)
      : base.exposureEv,
    temperatureK: Number.isFinite(temperature)
      ? clamp(temperature as number, RAW_DEVELOP_LIMITS.temperatureK.min, RAW_DEVELOP_LIMITS.temperatureK.max)
      : base.temperatureK,
    tint: Number.isFinite(tint)
      ? clamp(tint as number, RAW_DEVELOP_LIMITS.tint.min, RAW_DEVELOP_LIMITS.tint.max)
      : base.tint,
    highlightRecovery: isRawHighlightRecovery(source.highlightRecovery) ? source.highlightRecovery : base.highlightRecovery,
  };
}

/** Returns human-readable problems; an empty array means the input is valid. */
export function validateRawDevelop(value: Partial<RawDevelopSettings> | null | undefined): string[] {
  const errors: string[] = [];
  if (!value) return ['RAW develop settings are missing'];
  const checkNumber = (key: 'exposureEv' | 'temperatureK' | 'tint'): void => {
    const raw = value[key];
    if (raw === undefined) return;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.push(`${key} must be a finite number`);
      return;
    }
    const limit = RAW_DEVELOP_LIMITS[key];
    if (raw < limit.min || raw > limit.max) {
      errors.push(`${key} must be between ${limit.min} and ${limit.max}`);
    }
  };
  checkNumber('exposureEv');
  checkNumber('temperatureK');
  checkNumber('tint');
  if (value.highlightRecovery !== undefined && !isRawHighlightRecovery(value.highlightRecovery)) {
    errors.push('highlightRecovery must be one of off, blend, reconstruct');
  }
  return errors;
}

const temperatureEquals = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

/**
 * True when the develop settings reproduce the as-shot rendering, i.e. no
 * exposure/WB/highlight intent beyond the defaults. Q01 uses this to decide
 * whether it must zero the shader exposure/temperature/tint uniforms when a
 * RAW source is present (the decoder already applied them).
 */
export function rawDevelopIsIdentity(settings: RawDevelopSettings, asShotTemperatureK: number | null): boolean {
  const reference = asShotTemperatureK !== null && Number.isFinite(asShotTemperatureK)
    ? asShotTemperatureK
    : RAW_DEVELOP_FALLBACK_TEMPERATURE_K;
  return settings.exposureEv === 0
    && settings.tint === 0
    && settings.highlightRecovery === 'off'
    && temperatureEquals(settings.temperatureK, reference);
}
