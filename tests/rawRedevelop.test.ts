// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeDevelop, RAW_NEUTRAL_DEVELOP, type RawDevelopState } from '../src/engine/contracts/develop';
import {
  createLatestTaskRunner,
  highlightRecoveryFromStrength,
  rawDevelopSettingsEqual,
  rawDevelopSettingsFromState,
} from '../src/engine/raw/rawRedevelop';
import {
  createRawRedeveloper,
  getRawDevelopInfo,
  openRawForEditing,
  redevelopRawPreview,
} from '../src/engine/raw/rawPreview';
import { defaultRawDevelopSettings } from '../src/types/rawDevelop';

const state = (patch: Partial<RawDevelopState> = {}): RawDevelopState => normalizeDevelop({ ...RAW_NEUTRAL_DEVELOP, ...patch });

describe('develop state → decoder settings mapping (CP4-07)', () => {
  it('maps neutral as-shot state to the open-time defaults', () => {
    const mapped = rawDevelopSettingsFromState(state(), 5300);
    expect(mapped).toEqual(defaultRawDevelopSettings(5300));
    expect(rawDevelopSettingsEqual(mapped, defaultRawDevelopSettings(5300))).toBe(true);
  });

  it('maps custom WB absolute kelvin/tint and exposure straight through', () => {
    const mapped = rawDevelopSettingsFromState(
      state({ wb: { mode: 'custom', temperatureK: 7200, tint: 18 }, exposureEV: 1.25 }),
      5300,
    );
    expect(mapped.temperatureK).toBe(7200);
    expect(mapped.tint).toBe(18);
    expect(mapped.exposureEv).toBe(1.25);
  });

  it('clamps out-of-range values deterministically', () => {
    const mapped = rawDevelopSettingsFromState(
      state({ wb: { mode: 'custom', temperatureK: 999999, tint: 999 }, exposureEV: 99 }),
      5300,
    );
    expect(mapped.temperatureK).toBeLessThanOrEqual(50000);
    expect(mapped.tint).toBe(100);
    expect(mapped.exposureEv).toBe(5);
  });

  it('maps recovery strength onto the decoder modes', () => {
    expect(highlightRecoveryFromStrength(0)).toBe('off');
    expect(highlightRecoveryFromStrength(0.2)).toBe('blend');
    expect(highlightRecoveryFromStrength(0.5)).toBe('blend');
    expect(highlightRecoveryFromStrength(0.51)).toBe('reconstruct');
    expect(highlightRecoveryFromStrength(1)).toBe('reconstruct');
  });

  it('compares with the as-shot tolerance (0.5 K) and exact tint/mode', () => {
    const base = defaultRawDevelopSettings(5300);
    expect(rawDevelopSettingsEqual(base, { ...base, temperatureK: base.temperatureK + 0.4 })).toBe(true);
    expect(rawDevelopSettingsEqual(base, { ...base, temperatureK: base.temperatureK + 0.6 })).toBe(false);
    expect(rawDevelopSettingsEqual(base, { ...base, tint: 1 })).toBe(false);
    expect(rawDevelopSettingsEqual(base, { ...base, highlightRecovery: 'blend' })).toBe(false);
  });
});

describe('latest-wins task runner', () => {
  it('debounces trailing requests and commits only the last one', async () => {
    vi.useFakeTimers();
    try {
      const committed: string[] = [];
      const runner = createLatestTaskRunner<string>({
        delayMs: 200,
        onCommit: (value) => committed.push(value),
        onError: () => {},
      });
      runner.request(async () => 'a');
      await vi.advanceTimersByTimeAsync(100);
      runner.request(async () => 'b');
      await vi.advanceTimersByTimeAsync(100);
      runner.request(async () => 'c');
      expect(committed).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(committed).toEqual(['c']);
      runner.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a superseded in-flight decode never commits (stale result discarded)', async () => {
    vi.useFakeTimers();
    try {
      const committed: string[] = [];
      const aborted: string[] = [];
      const runner = createLatestTaskRunner<string>({
        delayMs: 10,
        onCommit: (value) => committed.push(value),
        onError: () => {},
      });
      let releaseSlow: (value: string) => void = () => {};
      runner.request((signal) => new Promise<string>((resolvePromise) => {
        signal.addEventListener('abort', () => aborted.push('slow'));
        releaseSlow = resolvePromise;
      }));
      const first = runner.flush();

      runner.request(async () => 'fast');
      await vi.advanceTimersByTimeAsync(10);
      releaseSlow('stale');
      await vi.advanceTimersByTimeAsync(0);
      expect(await first).toBeNull();
      expect(aborted).toEqual(['slow']);
      expect(committed).toEqual(['fast']);
      runner.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel drops a pending task and dispose aborts the in-flight one', async () => {
    vi.useFakeTimers();
    try {
      const committed: string[] = [];
      const runner = createLatestTaskRunner<string>({
        delayMs: 50,
        onCommit: (value) => committed.push(value),
        onError: () => {},
      });
      runner.request(async () => 'dropped');
      runner.cancel();
      await vi.advanceTimersByTimeAsync(100);

      let aborted = false;
      runner.request((signal) => new Promise<string>((resolvePromise) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolvePromise('late');
        });
      }));
      const flight = runner.flush();
      runner.dispose();
      await vi.advanceTimersByTimeAsync(10);
      expect(await flight).toBeNull();
      expect(aborted).toBe(true);
      expect(committed).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

const SAMPLE_DIR = process.env.Q03_RAW_SAMPLE_DIR ?? resolve(process.cwd(), 'poc/q03-imaging/testdata');
const DNG = join(SAMPLE_DIR, 'dng', 'R0000357.DNG');
const hasSample = existsSync(DNG);

describe.skipIf(!hasSample)('re-develop integration (24 MP DNG)', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeAll(() => {
    const context = {
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: () => {},
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    };
    URL.createObjectURL = vi.fn(() => 'blob:raw-develop');
  });

  afterAll(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
  });

  const open = async () => {
    const bytes = new Uint8Array(readFileSync(DNG));
    return openRawForEditing(
      { data: bytes, name: 'R0000357.DNG', type: 'image/x-adobe-dng', size: bytes.byteLength },
      { id: 'redevelop-dng' },
    );
  };

  it('neutral state skips the decode and keeps the asset untouched', async () => {
    const opened = await open();
    const before = getRawDevelopInfo(opened.source)!;
    let commits = 0;
    const red = createRawRedeveloper(opened.source, { debounceMs: 0, onCommit: () => { commits += 1; } })!;
    red.request(state());
    const result = await red.flush();
    expect(result?.skipped).toBe(true);
    expect(commits).toBe(1);
    expect(result?.preview).toBe(opened.image.previewCanvas);
    const after = getRawDevelopInfo(opened.source)!;
    expect(after.settings).toEqual(before.settings);
    red.dispose();
  });

  it('re-develops EV/WB through the decoder while preserving source identity', async () => {
    const opened = await open();
    const sourceRef = opened.source;
    const neutral = await redevelopRawPreview(sourceRef, state());
    expect(neutral.skipped).toBe(true);

    const ev = await redevelopRawPreview(sourceRef, state({ exposureEV: 1 }));
    expect(ev.skipped).toBe(false);
    expect(ev.settings.exposureEv).toBe(1);
    expect(opened.source).toBe(sourceRef);
    expect((opened.source.working as { data: Uint16Array }).data).toBe((ev.working as { data: Uint16Array }).data);
    expect(getRawDevelopInfo(sourceRef)!.settings.exposureEv).toBe(1);
    expect(ev.preview).not.toBe(opened.image.previewCanvas);
    // The preview canvas the editor held is superseded by onCommit, not mutated.
    expect(ev.previewWidth).toBe(neutral.previewWidth);

    const wb = await redevelopRawPreview(sourceRef, state({ wb: { mode: 'custom', temperatureK: 7200, tint: 12 } }));
    expect(wb.settings.temperatureK).toBe(7200);
    expect(wb.settings.tint).toBe(12);
    expect(getRawDevelopInfo(sourceRef)!.settings.temperatureK).toBe(7200);

    const back = await redevelopRawPreview(sourceRef, state());
    expect(back.skipped).toBe(false);
    expect(back.settings).toEqual(defaultRawDevelopSettings(getRawDevelopInfo(sourceRef)!.report.asShotTemperatureK));
  }, 600_000);

  it('a newer request aborts the in-flight decode and only it commits', async () => {
    const opened = await open();
    const commits: RawDevelopState[] = [];
    const red = createRawRedeveloper(opened.source, {
      debounceMs: 10,
      onCommit: (decoded) => {
        commits.push({
          wb: { mode: 'custom', temperatureK: decoded.settings.temperatureK, tint: decoded.settings.tint },
          exposureEV: decoded.settings.exposureEv,
          highlightRecovery: 0,
        });
      },
    })!;
    red.request(state({ exposureEV: 1 }));
    const first = red.flush();
    red.request(state({ exposureEV: -1 }));
    const second = await red.flush();
    expect(await first).toBeNull();
    expect(second?.settings.exposureEv).toBe(-1);
    expect(commits).toHaveLength(1);
    expect(commits[0].exposureEV).toBe(-1);
    expect((opened.source.working as { data: Uint16Array }).data).toBe((second!.working as { data: Uint16Array }).data);
    red.dispose();
  }, 600_000);

  it('non-RAW sources are rejected, never routed into the decoder', async () => {
    const fake = { source: { id: 'sdr', decoderId: 'x' }, working: {}, warnings: [] } as never;
    expect(createRawRedeveloper(fake)).toBeNull();
  });
});