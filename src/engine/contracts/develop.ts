import type { RenderSettings } from '../pipeline/renderSettings';

/**
 * RAW develop baseline contract (CP4 / Recipe V10). The develop stage runs on
 * decoded source pixels before user adjustments; user exposure/WB stay additive
 * on top and are never zeroed (fixes BL-CP3-01).
 */
export type RawWhiteBalance =
  | { mode: 'as-shot' }
  | { mode: 'custom'; temperatureK: number; tint: number };

export interface RawDevelopState {
  wb: RawWhiteBalance;
  /** Exposure in EV, -5..+5, 0 = neutral. */
  exposureEV: number;
  /** Highlight recovery strength, 0..1, 0 = off. */
  highlightRecovery: number;
}

export const RAW_DEVELOP_STATE_LIMITS = Object.freeze({
  temperatureK: Object.freeze({ min: 2000, max: 12000 }),
  tint: Object.freeze({ min: -100, max: 100 }),
  exposureEV: Object.freeze({ min: -5, max: 5 }),
  highlightRecovery: Object.freeze({ min: 0, max: 1 }),
});

export const RAW_NEUTRAL_DEVELOP: RawDevelopState = Object.freeze({
  wb: Object.freeze({ mode: 'as-shot' }) as RawWhiteBalance,
  exposureEV: 0,
  highlightRecovery: 0,
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Deterministic normalization: invalid values fall back to neutral, ranges clamp. */
export function normalizeDevelop(value: Partial<RawDevelopState> | null | undefined): RawDevelopState {
  const source = value ?? {};
  const wb = source.wb;
  const custom =
    wb && wb.mode === 'custom' && finite(wb.temperatureK) && finite(wb.tint)
      ? {
          mode: 'custom' as const,
          temperatureK: clamp(wb.temperatureK, RAW_DEVELOP_STATE_LIMITS.temperatureK.min, RAW_DEVELOP_STATE_LIMITS.temperatureK.max),
          tint: clamp(wb.tint, RAW_DEVELOP_STATE_LIMITS.tint.min, RAW_DEVELOP_STATE_LIMITS.tint.max),
        }
      : null;
  return {
    wb: custom ?? RAW_NEUTRAL_DEVELOP.wb,
    exposureEV: finite(source.exposureEV)
      ? clamp(source.exposureEV, RAW_DEVELOP_STATE_LIMITS.exposureEV.min, RAW_DEVELOP_STATE_LIMITS.exposureEV.max)
      : 0,
    highlightRecovery: finite(source.highlightRecovery)
      ? clamp(source.highlightRecovery, RAW_DEVELOP_STATE_LIMITS.highlightRecovery.min, RAW_DEVELOP_STATE_LIMITS.highlightRecovery.max)
      : 0,
  };
}

export function isNeutralDevelop(state: RawDevelopState): boolean {
  return state.wb.mode === 'as-shot' && state.exposureEV === 0 && state.highlightRecovery === 0;
}

/** Strict recipe-boundary validation; throws instead of normalizing. */
export function validateDevelop(value: unknown): asserts value is RawDevelopState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid develop settings');
  const develop = value as Record<string, unknown>;
  for (const key of Object.keys(develop)) {
    if (key !== 'wb' && key !== 'exposureEV' && key !== 'highlightRecovery') {
      throw new Error(`Unknown develop field: ${key}`);
    }
  }
  const wb = develop.wb;
  if (!wb || typeof wb !== 'object' || Array.isArray(wb)) throw new Error('Invalid develop white balance');
  const balance = wb as Record<string, unknown>;
  if (balance.mode === 'as-shot') {
    if (Object.keys(balance).length !== 1) throw new Error('Invalid develop white balance');
  } else if (balance.mode === 'custom') {
    for (const key of Object.keys(balance)) {
      if (key !== 'mode' && key !== 'temperatureK' && key !== 'tint') {
        throw new Error(`Unknown develop white balance field: ${key}`);
      }
    }
    const { temperatureK, tint } = balance;
    if (
      !finite(temperatureK) ||
      temperatureK < RAW_DEVELOP_STATE_LIMITS.temperatureK.min ||
      temperatureK > RAW_DEVELOP_STATE_LIMITS.temperatureK.max
    ) {
      throw new Error('Invalid develop temperature');
    }
    if (!finite(tint) || tint < RAW_DEVELOP_STATE_LIMITS.tint.min || tint > RAW_DEVELOP_STATE_LIMITS.tint.max) {
      throw new Error('Invalid develop tint');
    }
  } else {
    throw new Error('Invalid develop white balance mode');
  }
  const exposure = develop.exposureEV;
  if (
    !finite(exposure) ||
    exposure < RAW_DEVELOP_STATE_LIMITS.exposureEV.min ||
    exposure > RAW_DEVELOP_STATE_LIMITS.exposureEV.max
  ) {
    throw new Error('Invalid develop exposure');
  }
  const recovery = develop.highlightRecovery;
  if (
    !finite(recovery) ||
    recovery < RAW_DEVELOP_STATE_LIMITS.highlightRecovery.min ||
    recovery > RAW_DEVELOP_STATE_LIMITS.highlightRecovery.max
  ) {
    throw new Error('Invalid develop highlight recovery');
  }
}

/**
 * Minimal view of the RAW decoder's develop info needed for composition. Q03's
 * full getRawDevelopInfo() result satisfies it structurally once the RAW engine
 * exposes `developBaked` (CP4-03).
 */
export interface RawDevelopInfo {
  /**
   * True when the decoder already applied the develop baseline to the source
   * pixels. Absent means baked: the CP3 decode path always develops.
   */
  developBaked?: boolean;
}

/**
 * Composes develop as the BASELINE stage. User adjustments stay additive on
 * top; they are never zeroed (BL-CP3-01). Double application is prevented by
 * `info.developBaked`, not by discarding user input.
 *
 * When the decoder did not bake the develop, only its EV offset can be folded
 * into the shader exposure; kelvin/tint have no faithful shader-unit equivalent
 * and stay decoder-only.
 */
export function composeDevelop(settings: RenderSettings, dev: RawDevelopState, info: RawDevelopInfo): RenderSettings {
  if (info.developBaked !== false) return settings;
  if (isNeutralDevelop(dev)) return settings;
  return {
    ...settings,
    adjustments: { ...settings.adjustments, exposure: settings.adjustments.exposure + dev.exposureEV },
  };
}

/** Structural view of Q03's CP3 getRawDevelopInfo() record. */
export interface DecodeDevelopInfo {
  identity?: boolean;
  settings?: {
    exposureEv?: number;
    temperatureK?: number;
    tint?: number;
    highlightRecovery?: number | 'off' | 'blend' | 'reconstruct';
  };
}

/**
 * Maps the decoder's CP3 develop record into the contract state until the RAW
 * engine adopts RawDevelopState directly (CP4-03).
 */
export function rawDevelopStateFromInfo(info: DecodeDevelopInfo | null | undefined): RawDevelopState {
  const settings = info?.settings;
  if (!info || info.identity || !settings) return RAW_NEUTRAL_DEVELOP;
  const recovery =
    typeof settings.highlightRecovery === 'number'
      ? settings.highlightRecovery
      : settings.highlightRecovery === 'reconstruct'
        ? 1
        : settings.highlightRecovery === 'blend'
          ? 0.5
          : 0;
  const custom =
    finite(settings.temperatureK) && finite(settings.tint)
      ? {
          mode: 'custom' as const,
          temperatureK: clamp(settings.temperatureK, RAW_DEVELOP_STATE_LIMITS.temperatureK.min, RAW_DEVELOP_STATE_LIMITS.temperatureK.max),
          tint: clamp(settings.tint, RAW_DEVELOP_STATE_LIMITS.tint.min, RAW_DEVELOP_STATE_LIMITS.tint.max),
        }
      : null;
  return {
    wb: custom ?? RAW_NEUTRAL_DEVELOP.wb,
    exposureEV: finite(settings.exposureEv)
      ? clamp(settings.exposureEv, RAW_DEVELOP_STATE_LIMITS.exposureEV.min, RAW_DEVELOP_STATE_LIMITS.exposureEV.max)
      : 0,
    highlightRecovery: clamp(recovery, RAW_DEVELOP_STATE_LIMITS.highlightRecovery.min, RAW_DEVELOP_STATE_LIMITS.highlightRecovery.max),
  };
}
