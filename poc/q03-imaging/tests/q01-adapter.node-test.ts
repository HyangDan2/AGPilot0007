import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDecodedSource, imageBufferByteLength, type CpuImageBuffer, type DecodedSource } from '../src/shared/q01/imageBuffer.ts';
import {
  assertDisplaySrgb8Frame,
  floatToHalfBits,
  sceneLinearToQ01DecodedSource,
  sdrSrgb8ToQ01DecodedSource,
  type DisplaySrgb8Frame,
  type SceneLinearFrame,
} from '../src/shared/q01Adapter.ts';

const meta = { name: 'sample.cr3', mimeType: 'image/x-canon-cr3', decoderId: 'flashraw-0.5.0', byteLength: 1234 };

const hasFloat16 = typeof Float16Array !== 'undefined';

function sceneLinearF32(width: number, height: number): SceneLinearFrame {
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = i / data.length;
  data[0] = 0.25;
  data[1] = 0.5;
  data[2] = 2.5;
  return { width, height, channels: 3, colorSpace: 'linear-srgb', sampleType: 'f32', data, sourceId: 'raw:test' };
}

test('f32 scene-linear RGB expands to rgba32f with alpha = 1 and passes assertDecodedSource', () => {
  const frame = sceneLinearF32(4, 3);
  const decoded = sceneLinearToQ01DecodedSource(frame, meta);
  assert.doesNotThrow(() => assertDecodedSource(decoded));
  assert.equal(decoded.working.format, 'rgba32f');
  assert.equal(decoded.working.colorSpace, 'linear-srgb');
  assert.equal(decoded.working.sourceId, 'raw:test');
  assert.equal(decoded.source.id, 'raw:test');
  assert.equal(decoded.source.precision, 'hdr-linear16');
  assert.equal(decoded.working.memoryBytes, imageBufferByteLength(4, 3, 'rgba32f'));
  const data = (decoded.working as CpuImageBuffer).data as Float32Array;
  assert.equal(data.length, 4 * 3 * 4);
  assert.deepEqual([...data.slice(0, 8)], [0.25, 0.5, 2.5, 1, frame.data[3], frame.data[4], frame.data[5], 1]);
});

test('f16 scene-linear RGB expands to rgba16f, preserves half bits and sets alpha to 1.0', { skip: !hasFloat16 }, () => {
  const width = 2;
  const height = 2;
  const rgb = new Float16Array([0, 0.25, 0.5, 0.75, 1, 2, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  const frame: SceneLinearFrame = { width, height, channels: 3, colorSpace: 'linear-srgb', sampleType: 'f16', data: rgb, sourceId: 'raw:f16' };
  const decoded = sceneLinearToQ01DecodedSource(frame, meta);
  assert.doesNotThrow(() => assertDecodedSource(decoded));
  assert.equal(decoded.working.format, 'rgba16f');
  assert.equal(decoded.working.memoryBytes, imageBufferByteLength(width, height, 'rgba16f'));
  const out = (decoded.working as CpuImageBuffer).data as Uint16Array;
  const bits = new Uint16Array(rgb.buffer, rgb.byteOffset, rgb.length);
  for (let i = 0; i < width * height; i++) {
    assert.equal(out[i * 4], bits[i * 3]);
    assert.equal(out[i * 4 + 1], bits[i * 3 + 1]);
    assert.equal(out[i * 4 + 2], bits[i * 3 + 2]);
    assert.equal(out[i * 4 + 3], 0x3c00);
  }
});

test('f16 half-bit Uint16Array data (FlashRaw storage) is accepted and copied verbatim', () => {
  const values = [0, 0.25, 0.5, 0.75, 1, 2];
  const bits = new Uint16Array(values.map((v) => floatToHalfBits(v)));
  const frame: SceneLinearFrame = { width: 2, height: 1, channels: 3, colorSpace: 'linear-srgb', sampleType: 'f16', data: bits, sourceId: 'raw:bits' };
  const decoded = sceneLinearToQ01DecodedSource(frame, meta);
  assert.doesNotThrow(() => assertDecodedSource(decoded));
  assert.equal(decoded.working.format, 'rgba16f');
  const out = (decoded.working as CpuImageBuffer).data as Uint16Array;
  for (let i = 0; i < 2; i++) {
    assert.deepEqual([...out.slice(i * 4, i * 4 + 3)], [...bits.slice(i * 3, i * 3 + 3)]);
    assert.equal(out[i * 4 + 3], 0x3c00);
  }
});

test('NaN half bits in f16 storage are rejected', () => {
  const bits = new Uint16Array([0x3c00, 0x7e00, 0x3c00]);
  const frame: SceneLinearFrame = { width: 1, height: 1, channels: 3, colorSpace: 'linear-srgb', sampleType: 'f16', data: bits, sourceId: 'raw:nan' };
  assert.throws(() => sceneLinearToQ01DecodedSource(frame, meta), /non-finite/);
});

test('camera-space frames are rejected before the Q01 boundary', () => {
  const frame = { ...sceneLinearF32(1, 1), colorSpace: 'camera-linear' as const };
  assert.throws(() => sceneLinearToQ01DecodedSource(frame, meta), /camera matrix|linear-srgb|Invalid scene-linear/);
});

test('non-finite and mis-sized scene-linear frames are rejected', () => {
  const bad = sceneLinearF32(2, 1);
  (bad.data as Float32Array)[1] = Number.NaN;
  assert.throws(() => sceneLinearToQ01DecodedSource(bad, meta), /non-finite/);
  const inf = sceneLinearF32(2, 1);
  (inf.data as Float32Array)[2] = Number.POSITIVE_INFINITY;
  assert.throws(() => sceneLinearToQ01DecodedSource(inf, meta), /non-finite/);
  const short: SceneLinearFrame = { ...sceneLinearF32(2, 1), data: new Float32Array(3) };
  assert.throws(() => sceneLinearToQ01DecodedSource(short, meta), /length/);
});

test('Q01 contract rejects an rgba8 working buffer (the old SDR shortcut)', () => {
  const pixels = 2 * 2;
  const rgba8Working = {
    id: 'sdr:working',
    sourceId: 'sdr',
    width: 2,
    height: 2,
    format: 'rgba8',
    colorSpace: 'linear-srgb',
    memoryBytes: imageBufferByteLength(2, 2, 'rgba8'),
    storage: 'cpu',
    data: new Uint8Array(pixels * 4),
  };
  const decoded = {
    source: { id: 'sdr', name: 'x.png', mimeType: 'image/png', width: 2, height: 2, precision: 'sdr-srgb8', hasAlpha: true, decoderId: 'png' },
    working: rgba8Working,
    warnings: [],
  } as unknown as DecodedSource;
  assert.throws(() => assertDecodedSource(decoded), /16-bit or 32-bit float/);
});

test('SDR sRGB8 frame becomes a linear rgba16f working buffer', () => {
  const frame: DisplaySrgb8Frame = {
    width: 2,
    height: 1,
    channels: 4,
    colorSpace: 'srgb',
    data: new Uint8Array([0, 128, 255, 255, 64, 64, 64, 255]),
  };
  assert.doesNotThrow(() => assertDisplaySrgb8Frame(frame));
  const decoded = sdrSrgb8ToQ01DecodedSource(frame, { ...meta, sourceId: 'sdr:test', workingSampleType: 'f32' });
  assert.doesNotThrow(() => assertDecodedSource(decoded));
  assert.equal(decoded.source.precision, 'sdr-srgb8');
  assert.equal(decoded.working.format, 'rgba32f');
  const out = (decoded.working as CpuImageBuffer).data as Float32Array;
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[1] - 0.2158605) < 1e-6, `linear(128) was ${out[1]}`);
  assert.ok(Math.abs(out[2] - 1) < 1e-6);
  assert.equal(out[3], 1);
  const grey = out[4];
  assert.ok(grey > 0 && grey < 1);
});

test('SDR f16 working buffer is linear and finite (default precision)', () => {
  const frame: DisplaySrgb8Frame = { width: 1, height: 1, channels: 4, colorSpace: 'srgb', data: new Uint8Array([255, 0, 128, 255]) };
  const decoded = sdrSrgb8ToQ01DecodedSource(frame, { ...meta, sourceId: 'sdr:f16' });
  assert.equal(decoded.working.format, 'rgba16f');
  assert.doesNotThrow(() => assertDecodedSource(decoded));
  const out = (decoded.working as CpuImageBuffer).data as Uint16Array;
  assert.equal(out[0], 0x3c00);
  assert.equal(out[1], 0);
  assert.equal(out[3], 0x3c00);
});

test('a display frame is not a DecodedSource and never enters the pipeline directly', () => {
  const frame: DisplaySrgb8Frame = { width: 1, height: 1, channels: 4, colorSpace: 'srgb', data: new Uint8Array(4) };
  assert.throws(() => assertDecodedSource(frame as unknown), /Invalid decoded source/);
});

test('adapter output cannot be tampered to break sourceId or memoryBytes consistency', () => {
  const decoded = sceneLinearToQ01DecodedSource(sceneLinearF32(2, 2), meta);
  const badSource = structuredClone(decoded) as DecodedSource;
  (badSource.working as { sourceId: string }).sourceId = 'other';
  assert.throws(() => assertDecodedSource(badSource), /sourceId mismatch/);
  const badMemory = structuredClone(decoded) as DecodedSource;
  (badMemory.working as { memoryBytes: number }).memoryBytes += 8;
  assert.throws(() => assertDecodedSource(badMemory), /memoryBytes mismatch/);
});

test('floatToHalfBits matches native DataView.setFloat16 when available', { skip: typeof (DataView.prototype as any).setFloat16 !== 'function' }, () => {
  const view = new DataView(new ArrayBuffer(2));
  for (const value of [0, 1e-4, 0.04045, 0.2158605, 0.5, 0.9, 1]) {
    view.setFloat16(0, value);
    assert.equal(floatToHalfBits(value), view.getUint16(0), `half bits for ${value}`);
  }
});
