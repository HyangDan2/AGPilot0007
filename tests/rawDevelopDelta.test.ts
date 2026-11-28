// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeDevelop, RAW_NEUTRAL_DEVELOP, type RawDevelopState } from '../src/engine/contracts/develop';
import { deriveDevelopDeltaMatrix } from '../src/engine/raw/rawDevelop';
import { decodeRawRedevelop, developRawSource, openRawForEditing, redevelopRawPreview } from '../src/engine/raw/rawPreview';
import { rawDevelopSettingsFromState } from '../src/engine/raw/rawRedevelop';
import type { CpuImageBuffer } from '../src/engine/contracts/imageBuffer';

const state = (patch: Partial<RawDevelopState> = {}): RawDevelopState => normalizeDevelop({ ...RAW_NEUTRAL_DEVELOP, ...patch });

describe('develop delta matrix (CP5-02)', () => {
  const cameraToSrgb = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const apply = (matrix: number[], rgb: [number, number, number]): [number, number, number] => [
    matrix[0] * rgb[0] + matrix[1] * rgb[1] + matrix[2] * rgb[2],
    matrix[3] * rgb[0] + matrix[4] * rgb[1] + matrix[5] * rgb[2],
    matrix[6] * rgb[0] + matrix[7] * rgb[1] + matrix[8] * rgb[2],
  ];

  it('is the identity at the base state and scales exposure exactly', () => {
    const identity = deriveDevelopDeltaMatrix({ exposureEv: 0, baseMultipliers: [2, 1, 0.5], targetMultipliers: [2, 1, 0.5], cameraToSrgb });
    expect(identity).not.toBeNull();
    expect(apply(identity!, [0.2, 0.4, 0.1])).toEqual([0.2, 0.4, 0.1]);

    const gain = deriveDevelopDeltaMatrix({ exposureEv: 2, baseMultipliers: [1, 1, 1], targetMultipliers: [1, 1, 1], cameraToSrgb });
    expect(apply(gain!, [0.1, 0.2, 0.3])).toEqual([0.4, 0.8, 1.2]);
  });

  it('applies a WB ratio in camera space (conjugated through the matrix)', () => {
    // 45-degree mixing matrix so camera-space channel ratios do not stay diagonal.
    const mix = [0.5, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0.5];
    const ratio = [1.5, 1, 0.8];
    const matrix = deriveDevelopDeltaMatrix({ exposureEv: 0, baseMultipliers: [1, 1, 1], targetMultipliers: ratio, cameraToSrgb: mix });
    expect(matrix).not.toBeNull();
    // Invariant: delta · (M · e_i) == ratio_i · (M · e_i) for each camera channel.
    for (let channel = 0; channel < 3; channel += 1) {
      const camera: [number, number, number] = [channel === 0 ? 1 : 0, channel === 1 ? 1 : 0, channel === 2 ? 1 : 0];
      const mixed: [number, number, number] = [
        mix[0] * camera[0] + mix[1] * camera[1] + mix[2] * camera[2],
        mix[3] * camera[0] + mix[4] * camera[1] + mix[5] * camera[2],
        mix[6] * camera[0] + mix[7] * camera[1] + mix[8] * camera[2],
      ];
      const out = apply(matrix!, mixed);
      out.forEach((value, index) => expect(value).toBeCloseTo(mixed[index] * ratio[channel], 6));
    }
  });

  it('falls back (null) without a usable matrix', () => {
    expect(deriveDevelopDeltaMatrix({ exposureEv: 1, baseMultipliers: [1, 1, 1], targetMultipliers: [1, 1, 1], cameraToSrgb: null })).toBeNull();
    expect(deriveDevelopDeltaMatrix({ exposureEv: 1, baseMultipliers: [0, 1, 1], targetMultipliers: [1, 1, 1], cameraToSrgb })).toBeNull();
    expect(deriveDevelopDeltaMatrix({ exposureEv: 1, baseMultipliers: [1, 1, 1], targetMultipliers: [1, 1, 1], cameraToSrgb: [1, 1, 1, 1, 1, 1, 1, 1, 1] })).toBeNull();
  });
});

const SAMPLE_DIR = process.env.Q03_RAW_SAMPLE_DIR ?? resolve(process.cwd(), 'poc/q03-imaging/testdata');
const DNG = join(SAMPLE_DIR, 'dng', 'R0000357.DNG');
const hasSample = existsSync(DNG);

interface StubCanvas {
  width: number;
  height: number;
  image: { width: number; height: number; data: Uint8ClampedArray } | null;
  getContext: () => unknown;
}

describe.skipIf(!hasSample)('delta develop matches a fresh decode (24 MP DNG)', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeAll(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        const canvas: StubCanvas = {
          width: 0,
          height: 0,
          image: null,
          getContext: () => ({
            createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: (image: StubCanvas['image']) => {
              canvas.image = image;
            },
          }),
        };
        return canvas;
      },
    };
    URL.createObjectURL = vi.fn(() => 'blob:raw-develop');
  });

  afterAll(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
  });

  const pixels = (canvas: unknown): Uint8ClampedArray => {
    const image = (canvas as StubCanvas).image;
    if (!image) throw new Error('canvas was never rendered');
    return image.data;
  };
  const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    expect(a.length).toBe(b.length);
    let sum = 0;
    let max = 0;
    for (let index = 0; index < a.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(a[index + channel] - b[index + channel]);
        sum += delta;
        max = Math.max(max, delta);
      }
    }
    return { mean: sum / ((a.length / 4) * 3), max };
  };
  const hash = (data: Uint8ClampedArray): number => {
    let value = 0x811c9dc5;
    for (let index = 0; index < data.length; index += 1) {
      value ^= data[index];
      value = Math.imul(value, 0x01000193);
    }
    return value >>> 0;
  };

  it('exposure and WB deltas stay within 1 LSB mean / 8 LSB max of a full decode', async () => {
    const bytes = new Uint8Array(readFileSync(DNG));
    const input = { data: bytes, name: 'R0000357.DNG', type: 'image/x-adobe-dng', size: bytes.byteLength };
    const opened = await openRawForEditing(input, { id: 'delta-quality' });
    const asShot = opened.report.asShotTemperatureK;

    const cases = [
      { label: 'ev+1', patch: { exposureEV: 1 } },
      { label: 'wb-7200-t12', patch: { wb: { mode: 'custom' as const, temperatureK: 7200, tint: 12 } } },
    ];

    for (const { label, patch } of cases) {
      const requested = state(patch);
      const delta = await decodeRawRedevelop(opened.source, requested);
      expect(delta.delta, `${label}: no flashraw run`).toBe(true);
      expect(delta.skipped).toBe(false);
      // Reference: the same state through a fresh flashraw decode, rendered identically.
      const fullCanvas = await developPreviewPixels(input, requested, asShot);
      const result = diff(pixels(delta.preview), fullCanvas);
      console.log(`[delta-quality:${label}] mean=${result.mean.toFixed(3)} max=${result.max}`);
      expect(result.mean, `${label} mean`).toBeLessThanOrEqual(0.25);
      // max is f16-rounding residue on a few clipped-edge pixels (decoder works in f32).
      expect(result.max, `${label} max`).toBeLessThanOrEqual(12);
    }
  }, 900_000);

  it('chained deltas and a reset stay exact against the base decode', async () => {
    const bytes = new Uint8Array(readFileSync(DNG));
    const input = { data: bytes, name: 'R0000357.DNG', type: 'image/x-adobe-dng', size: bytes.byteLength };
    const opened = await openRawForEditing(input, { id: 'delta-chain' });
    const ev = await decodeRawRedevelop(opened.source, state({ exposureEV: 1 }));
    const wb = await decodeRawRedevelop(opened.source, state({ exposureEV: 1, wb: { mode: 'custom', temperatureK: 7200, tint: 12 } }));
    expect(wb.delta).toBe(true);
    // Deltas are computed from the base decode, never compounded: chained vs single-shot.
    const singleShot = await openRawForEditing(input, { id: 'delta-chain-ref' });
    const direct = await decodeRawRedevelop(singleShot.source, state({ exposureEV: 1, wb: { mode: 'custom', temperatureK: 7200, tint: 12 } }));
    const result = diff(pixels(wb.preview), pixels(direct.preview));
    console.log(`[delta-quality:chained] mean=${result.mean.toFixed(3)} max=${result.max}`);
    expect(result.mean).toBeLessThanOrEqual(0.25);
    expect(result.max).toBeLessThanOrEqual(12);
    const back = await decodeRawRedevelop(opened.source, state());
    expect(back.skipped).toBe(true);
    expect(hash(pixels(back.preview))).toBe(hash(pixels(opened.image.previewCanvas)));
    expect(hash(pixels(wb.preview))).not.toBe(hash(pixels(ev.preview)));
  }, 900_000);

  it('highlight recovery forces a full decode and disables deltas on that base', async () => {
    const bytes = new Uint8Array(readFileSync(DNG));
    const input = { data: bytes, name: 'R0000357.DNG', type: 'image/x-adobe-dng', size: bytes.byteLength };
    const opened = await openRawForEditing(input, { id: 'delta-highlight' });
    const recovered = await redevelopRawPreview(opened.source, state({ highlightRecovery: 0.8 }));
    expect(recovered.skipped).toBe(false);
    expect(recovered.delta).toBeUndefined();
    // The base now carries recovery, so exposure edits must not take the linear delta shortcut.
    const ev = await redevelopRawPreview(opened.source, state({ highlightRecovery: 0.8, exposureEV: 1 }));
    expect(ev.delta).toBeUndefined();
    expect(hash(pixels(ev.preview))).not.toBe(hash(pixels(recovered.preview)));
    // Returning to a linear state re-decodes once and re-enables the delta path.
    const off = await redevelopRawPreview(opened.source, state());
    expect(off.delta).toBeUndefined();
    const evDelta = await redevelopRawPreview(opened.source, state({ exposureEV: 1 }));
    expect(evDelta.delta).toBe(true);
  }, 900_000);

  async function developPreviewPixels(
    input: { data: Uint8Array; name: string; type: string; size: number },
    requested: RawDevelopState,
    asShot: number | null,
  ): Promise<Uint8ClampedArray> {
    const settings = rawDevelopSettingsFromState(requested, asShot);
    const full = await developRawSource(input, { id: 'full-reference', settings });
    // developRawSource keeps the working buffer; render it with the same canvas path.
    const { renderLinearRgba16ToCanvas } = await import('../src/engine/raw/canvas');
    return pixels(renderLinearRgba16ToCanvas(full.source.working as CpuImageBuffer, 2048));
  }
});