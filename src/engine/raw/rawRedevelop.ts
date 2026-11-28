import type { RawDevelopState } from '../contracts/develop';
import type { RawDevelopSettings, RawHighlightRecovery } from '../../types/rawDevelop';
import { defaultRawDevelopSettings, normalizeRawDevelop } from '../../types/rawDevelop';

/**
 * CP4-07 helpers: contract develop state → decoder develop settings, and the
 * trailing-debounce/latest-wins runner that guards re-develop decodes.
 */

/**
 * Panel strength 0..1 maps onto the decoder's discrete recovery modes. 0 is off,
 * up to half strength is the blend, above that the full reconstruct.
 */
export function highlightRecoveryFromStrength(strength: number): RawHighlightRecovery {
  if (!(strength > 0)) return 'off';
  return strength <= 0.5 ? 'blend' : 'reconstruct';
}

/**
 * Absolute decoder settings for a develop state. As-shot WB resolves to the
 * same reference `openRawForEditing` used, so a neutral state reproduces the
 * decode-time settings exactly (the neutral fast path).
 */
export function rawDevelopSettingsFromState(
  state: RawDevelopState,
  asShotTemperatureK: number | null,
): RawDevelopSettings {
  const base = defaultRawDevelopSettings(asShotTemperatureK);
  const custom = state.wb.mode === 'custom' ? state.wb : null;
  return normalizeRawDevelop(
    {
      exposureEv: state.exposureEV,
      temperatureK: custom ? custom.temperatureK : base.temperatureK,
      tint: custom ? custom.tint : 0,
      highlightRecovery: highlightRecoveryFromStrength(state.highlightRecovery),
    },
    base,
  );
}

/** Same tolerance the as-shot identity predicate uses: 0.5 K, exact tint/mode. */
export function rawDevelopSettingsEqual(a: RawDevelopSettings, b: RawDevelopSettings): boolean {
  return Math.abs(a.exposureEv - b.exposureEv) < 1e-6
    && Math.abs(a.temperatureK - b.temperatureK) < 0.5
    && a.tint === b.tint
    && a.highlightRecovery === b.highlightRecovery;
}

export interface LatestTaskRunner<T> {
  /** Replaces the pending task and restarts the trailing timer. */
  request(task: (signal: AbortSignal) => Promise<T>): void;
  /** Starts the pending task now (or rejoins the in-flight one); resolves its committed value or null when discarded. */
  flush(): Promise<T | null>;
  /** Drops the pending task and aborts the in-flight one; nothing commits afterwards. */
  cancel(): void;
  dispose(): void;
}

/**
 * Trailing debounce + latest-wins. A newer request aborts the in-flight decode,
 * and a result that finishes after being superseded never reaches `onCommit`.
 */
export function createLatestTaskRunner<T>(options: {
  delayMs: number;
  onCommit: (value: T) => void;
  onError: (error: unknown) => void;
}): LatestTaskRunner<T> {
  let pending: ((signal: AbortSignal) => Promise<T>) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let inFlight: Promise<T | null> | null = null;
  let generation = 0;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const start = (): Promise<T | null> => {
    const task = pending;
    pending = null;
    clearTimer();
    if (!task || disposed) return Promise.resolve(null);
    generation += 1;
    const mine = generation;
    controller?.abort();
    const abort = new AbortController();
    controller = abort;
    const run = (async () => {
      try {
        const value = await task(abort.signal);
        if (disposed || mine !== generation) return null;
        options.onCommit(value);
        return value;
      } catch (error) {
        if (disposed || mine !== generation) return null;
        if (abort.signal.aborted) return null;
        options.onError(error);
        return null;
      } finally {
        if (mine === generation) {
          inFlight = null;
          controller = null;
        }
      }
    })();
    inFlight = run;
    return run;
  };

  return {
    request(task) {
      if (disposed) return;
      pending = task;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void start();
      }, options.delayMs);
    },
    flush() {
      if (disposed) return Promise.resolve(null);
      if (pending) return start();
      return inFlight ?? Promise.resolve(null);
    },
    cancel() {
      pending = null;
      clearTimer();
      generation += 1;
      controller?.abort();
      controller = null;
      inFlight = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      clearTimer();
      generation += 1;
      controller?.abort();
      controller = null;
      inFlight = null;
    },
  };
}