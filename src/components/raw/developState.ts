// Provisional copies of the CP4-01a develop contract shapes (WO-P1-CP4 §2.3).
// Switch to `import type {...} from '../../engine/contracts/develop'` once Q01 lands it.
export type DevelopWbMode = 'as-shot' | 'custom';

export interface RawDevelopState {
  wb: {
    mode: DevelopWbMode;
    /** Absolute target temperature in kelvin. */
    temperatureK: number;
    /** Green/magenta offset, -100..100. */
    tint: number;
  };
  /** Exposure in EV, -5..5. */
  exposureEV: number;
  /** Highlight reconstruction amount, 0..1. */
  highlightRecovery: number;
}

export const DEVELOP_LIMITS = Object.freeze({
  temperatureK: Object.freeze({ min: 2000, max: 12000 }),
  tint: Object.freeze({ min: -100, max: 100 }),
  exposureEV: Object.freeze({ min: -5, max: 5 }),
  highlightRecovery: Object.freeze({ min: 0, max: 1 }),
});

export const RAW_NEUTRAL_DEVELOP: RawDevelopState = Object.freeze({
  wb: Object.freeze({ mode: 'as-shot' as const, temperatureK: 6500, tint: 0 }),
  exposureEV: 0,
  highlightRecovery: 0,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Clamps every numeric field; unknown WB modes fall back to as-shot. */
export function normalizeDevelopState(value: Partial<RawDevelopState> | null | undefined): RawDevelopState {
  const source = value ?? {};
  const wb = source.wb ?? RAW_NEUTRAL_DEVELOP.wb;
  const mode: DevelopWbMode = wb.mode === 'custom' ? 'custom' : 'as-shot';
  return {
    wb: {
      mode,
      temperatureK: clamp(finite(wb.temperatureK, RAW_NEUTRAL_DEVELOP.wb.temperatureK), DEVELOP_LIMITS.temperatureK.min, DEVELOP_LIMITS.temperatureK.max),
      tint: clamp(finite(wb.tint, 0), DEVELOP_LIMITS.tint.min, DEVELOP_LIMITS.tint.max),
    },
    exposureEV: Math.round(clamp(finite(source.exposureEV, 0), DEVELOP_LIMITS.exposureEV.min, DEVELOP_LIMITS.exposureEV.max) * 10) / 10,
    highlightRecovery: clamp(finite(source.highlightRecovery, 0), DEVELOP_LIMITS.highlightRecovery.min, DEVELOP_LIMITS.highlightRecovery.max),
  };
}

/**
 * True when the develop state reproduces the as-shot rendering. The shader guard
 * may only neutralise develop-owned controls when this is true; user exposure/WB
 * must stay effective otherwise (BL-CP3-01 closure requirement).
 */
export function isNeutralDevelop(state: RawDevelopState, asShotTemperatureK: number | null): boolean {
  if (state.exposureEV !== 0 || state.highlightRecovery !== 0) return false;
  if (state.wb.mode === 'as-shot') return state.wb.tint === 0;
  const reference = asShotTemperatureK ?? RAW_NEUTRAL_DEVELOP.wb.temperatureK;
  return Math.abs(state.wb.temperatureK - reference) < 0.5 && state.wb.tint === 0;
}
