// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { assertDecodedSource, type CpuImageBuffer } from '../src/engine/contracts/imageBuffer';
import { decodeRawToSource, RawDecodeError } from '../src/engine/raw';

const sample = (relative: string): string => process.env.Q03_RAW_SAMPLE_DIR
  ? resolve(process.env.Q03_RAW_SAMPLE_DIR, relative)
  : resolve(process.cwd(), 'poc/q03-imaging/testdata', relative);

function readSample(relative: string) {
  const path = sample(relative);
  if (!existsSync(path)) return null;
  const data = readFileSync(path);
  return { path, input: { data, name: basename(path), size: data.byteLength } };
}

const cr3 = readSample('cr3/IMG_4243.CR3');
const jpeg = readSample('notraw.jpg');
const truncated = readSample('corrupt/truncated.CR3');

const budgetBytes = (width: number, height: number) => width * height * 8;

describe('RAW source decoder validation', () => {
  it.skipIf(!jpeg)('rejects a file that is not camera RAW before decoding', async () => {
    await expect(decodeRawToSource(jpeg!.input, { id: 'jpeg' })).rejects.toMatchObject({
      name: 'RawDecodeError',
      code: 'unsupported-format',
      details: { stage: 'validate' },
    });
  });

  it('rejects random bytes as unsupported or corrupt, never as a decoded source', async () => {
    const bytes = new Uint8Array(1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 37) & 0xff;
    await expect(decodeRawToSource({ data: bytes, name: 'random.cr3' })).rejects.toBeInstanceOf(RawDecodeError);
  });

  it('rejects inputs above the input byte limit before opening them', async () => {
    await expect(
      decodeRawToSource({ data: new Uint8Array(64), name: 'tiny.dng' }, { maxInputBytes: 16 }),
    ).rejects.toMatchObject({ code: 'budget-exceeded', details: { stage: 'validate' } });
  });

  it.skipIf(!cr3)('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(decodeRawToSource(cr3!.input, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe.skipIf(!cr3)('RAW source decoder with a local camera sample', () => {
  it('rejects the decode before allocation when the memory budget is too small', async () => {
    await expect(decodeRawToSource(cr3!.input, { maxWorkingBytes: 1024 })).rejects.toMatchObject({
      name: 'RawDecodeError',
      code: 'budget-exceeded',
      details: { stage: 'budget', width: 4320, height: 2880, maxBytes: 1024 },
    });
  });

  it('cancels an in-flight decode', async () => {
    const controller = new AbortController();
    const pending = decodeRawToSource(cr3!.input, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('produces a linear half-float DecodedSource for the Q01 source stage', async () => {
    const decoded = await decodeRawToSource(cr3!.input, { id: 'cr3-test' });
    assertDecodedSource(decoded);
    expect(decoded.source).toMatchObject({
      id: 'cr3-test',
      width: 4320,
      height: 2880,
      precision: 'hdr-linear16',
      hasAlpha: false,
      decoderId: 'flashraw@0.5.0',
    });
    expect(decoded.working.format).toBe('rgba16f');
    const working = decoded.working as CpuImageBuffer;
    expect(working.memoryBytes).toBe(budgetBytes(4320, 2880));
    const data = working.data as Uint16Array;
    expect(data.length).toBe(4320 * 2880 * 4);
    expect(data[3]).toBe(0x3c00);
    expect(data[data.length - 1]).toBe(0x3c00);
    let hasSignal = false;
    for (let index = 0; index < data.length; index += 4 * 997) {
      if (data[index] || data[index + 1] || data[index + 2]) {
        hasSignal = true;
        break;
      }
    }
    expect(hasSignal).toBe(true);
    expect(decoded.warnings.filter((warning) => /incomplete/i.test(warning))).toEqual([]);
  }, 120_000);

  it.skipIf(!truncated)('rejects a truncated camera file under the strict corruption policy', async () => {
    await expect(decodeRawToSource(truncated!.input, { corruptionPolicy: 'strict' })).rejects.toMatchObject({
      name: 'RawDecodeError',
      code: 'corrupt-file',
    });
  }, 120_000);
});
