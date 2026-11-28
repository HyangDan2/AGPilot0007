// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DecodedImage } from '../src/engine/image/decoder';
import {
  RAW_OPEN_MEMORY_LIMIT_BYTES,
  accountRawOpenMemory,
  getRawDevelopInfo,
  hasRawAsset,
  openRawForEditing,
} from '../src/engine/raw/rawPreview';

const SAMPLE_DIR = process.env.Q03_RAW_SAMPLE_DIR ?? resolve(process.cwd(), 'poc/q03-imaging/testdata');
const DNG = join(SAMPLE_DIR, 'dng', 'R0000357.DNG');
const hasSample = existsSync(DNG);

/**
 * Retained-memory accounting method (CP3-03 §3):
 *   file/Blob bytes (needed for the lazy export develop)
 * + half-size rgba16f working buffer
 * + preview RGBA8 canvas.
 * Transient decoder frames and the export-only full-resolution canvas are not
 * retained after open and are therefore excluded; the regression asserts the
 * 24 MP budget of 128 MiB and that the retained "original" is the preview.
 */
describe.skipIf(!hasSample)('RAW open memory accounting (24 MP DNG)', () => {
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

  it('retains no full-size canvas and stays within 128 MiB for a 24 MP RAW', async () => {
    const bytes = new Uint8Array(readFileSync(DNG));
    const result = await openRawForEditing({ data: bytes, name: 'R0000357.DNG', type: 'image/x-adobe-dng', size: bytes.byteLength }, { id: 'mem-dng' });

    expect(result.width).toBe(6000);
    expect(result.height).toBe(4000);
    expect(Math.abs(result.source.source.width * 2 - 6000)).toBeLessThanOrEqual(2);
    expect(Math.abs(result.source.source.height * 2 - 4000)).toBeLessThanOrEqual(2);
    expect(result.source.source.decoderId).toBe('flashraw-develop@0.5.0');

    const image = result.image as DecodedImage;
    expect(image.originalWidth).toBe(6000);
    expect(image.originalHeight).toBe(4000);
    expect(image.originalElement).toBe(image.previewCanvas);
    expect(typeof image.resolveOriginal).toBe('function');

    expect(result.memory.fileBytes).toBe(bytes.byteLength);
    expect(result.memory.workingBytes).toBe(result.source.working.memoryBytes);
    expect(result.memory.totalBytes).toBe(result.memory.fileBytes + result.memory.workingBytes + result.memory.previewBytes);
    expect(result.memory.totalBytes).toBeLessThanOrEqual(RAW_OPEN_MEMORY_LIMIT_BYTES);
    expect(result.memory.withinOpenLimit).toBe(true);
    // The half-size buffer is at most ~1/4 of a full-size rgba16f frame.
    expect(result.memory.workingBytes).toBeLessThan(60 * 1024 * 1024);

    expect(hasRawAsset(result.source)).toBe(true);
    const info = getRawDevelopInfo(result.source);
    expect(info?.identity).toBe(true);
    expect(info?.width).toBe(6000);
    expect(info?.height).toBe(4000);
  });

  it('accounts exactly file + half-size buffer + preview canvas', () => {
    const account = accountRawOpenMemory({ fileBytes: 33_374_940, workingBytes: 48_000_000, previewWidth: 2048, previewHeight: 1365 });
    expect(account.previewBytes).toBe(2048 * 1365 * 4);
    expect(account.totalBytes).toBe(33_374_940 + 48_000_000 + 2048 * 1365 * 4);
    expect(account.withinOpenLimit).toBe(true);
    const oversized = accountRawOpenMemory({ fileBytes: 120 * 1024 * 1024, workingBytes: 60 * 1024 * 1024, previewWidth: 2048, previewHeight: 1365 });
    expect(oversized.withinOpenLimit).toBe(false);
  });
});
