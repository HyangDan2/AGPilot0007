// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CpuImageBuffer } from '../src/engine/contracts/imageBuffer';
import { developRawSource } from '../src/engine/raw/rawPreview';

const sample = (relative: string): string => process.env.Q03_RAW_SAMPLE_DIR
  ? resolve(process.env.Q03_RAW_SAMPLE_DIR, relative)
  : resolve(process.cwd(), 'poc/q03-imaging/testdata', relative);

const cr3 = sample('cr3/IMG_4243.CR3');
const hasSample = existsSync(cr3);

/**
 * Parity method (CP3-03 §6): the half-size preview develop and the full-size
 * export develop run with identical settings. The full frame is box-filtered
 * 2x2 to the preview grid and both are encoded with the same linear→sRGB LUT.
 * Documented tolerance on 8-bit sRGB values: mean absolute difference ≤ 3 and
 * p99 ≤ 12 (half-size 2x2 binning vs AHD full demosaic at sharp detail).
 */
const MEAN_TOLERANCE = 3;
const P99_TOLERANCE = 12;

const halfToFloat = (bits: number): number => {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
};

const toSrgbByte = (linear: number): number => {
  if (!(linear > 0)) return 0;
  if (linear >= 1) return 255;
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

describe.skipIf(!hasSample)('RAW preview/export parity', () => {
  it('half-size preview matches a 2x2-downsampled full-res develop within tolerance', async () => {
    const bytes = new Uint8Array(readFileSync(cr3));
    const input = { data: bytes, name: basename(cr3), size: bytes.byteLength };
    const preview = await developRawSource(input, { id: 'parity-preview' });
    const full = await developRawSource(input, { id: 'parity-full', mode: 'export' });

    const previewBuffer = preview.source.working as CpuImageBuffer;
    const fullBuffer = full.source.working as CpuImageBuffer;
    const pw = previewBuffer.width;
    const ph = previewBuffer.height;
    const fw = fullBuffer.width;
    const fh = fullBuffer.height;
    expect(fw).toBeGreaterThanOrEqual(pw * 2 - 2);
    expect(fh).toBeGreaterThanOrEqual(ph * 2 - 2);

    const p = previewBuffer.data as Uint16Array;
    const f = fullBuffer.data as Uint16Array;
    const diffs: number[] = [];
    let sum = 0;
    let count = 0;
    const stride = 4;
    for (let y = 0; y < ph; y += stride) {
      const fy0 = Math.min(fh - 1, y * 2);
      const fy1 = Math.min(fh - 1, fy0 + 1);
      for (let x = 0; x < pw; x += stride) {
        const fx0 = Math.min(fw - 1, x * 2);
        const fx1 = Math.min(fw - 1, fx0 + 1);
        for (let channel = 0; channel < 3; channel += 1) {
          const previewLinear = halfToFloat(p[(y * pw + x) * 4 + channel]);
          const fullLinear = (
            halfToFloat(f[(fy0 * fw + fx0) * 4 + channel])
            + halfToFloat(f[(fy0 * fw + fx1) * 4 + channel])
            + halfToFloat(f[(fy1 * fw + fx0) * 4 + channel])
            + halfToFloat(f[(fy1 * fw + fx1) * 4 + channel])
          ) / 4;
          const diff = Math.abs(toSrgbByte(previewLinear) - toSrgbByte(fullLinear));
          diffs.push(diff);
          sum += diff;
          count += 1;
        }
      }
    }
    diffs.sort((a, b) => a - b);
    const mean = sum / count;
    const p99 = diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * 0.99))];
    console.log(`[raw-parity] mean=${mean.toFixed(3)} p99=${p99} samples=${count} preview=${pw}x${ph} full=${fw}x${fh}`);
    expect(mean).toBeLessThanOrEqual(MEAN_TOLERANCE);
    expect(p99).toBeLessThanOrEqual(P99_TOLERANCE);
  }, 600_000);
});
