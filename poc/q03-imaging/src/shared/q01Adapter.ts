import {
  assertDecodedSource,
  imageBufferByteLength,
  type DecodedSource,
  type ImageBufferFormat,
  type SourcePrecision,
} from './q01/imageBuffer.ts';

/**
 * Q03 internal scene-linear frame. Stays RGB 3-channel to keep RAW working buffers
 * compact; it is never handed to the Q01 pipeline directly.
 */
export interface SceneLinearFrame {
  width: number;
  height: number;
  channels: 3;
  colorSpace: 'linear-srgb' | 'camera-linear';
  sampleType: 'f16' | 'f32';
  /** f16 frames may carry half values (Float16Array) or raw half bits (Uint16Array, FlashRaw). */
  data: Float16Array | Uint16Array | Float32Array;
  sourceId: string;
}

/**
 * Final display/export frame (sRGB, 8-bit, alpha included). Output boundary only:
 * it must be converted through `sdrSrgb8ToQ01DecodedSource` before entering the
 * shared color pipeline, whose working buffers are float.
 */
export interface DisplaySrgb8Frame {
  width: number;
  height: number;
  channels: 4;
  colorSpace: 'srgb';
  data: Uint8Array | Uint8ClampedArray;
}

export interface Q01BridgeMeta {
  name: string;
  mimeType: string;
  decoderId: string;
  byteLength?: number;
  precision?: SourcePrecision;
  workingId?: string;
}

export interface SdrBridgeOptions extends Q01BridgeMeta {
  /** Stable identity for the decoded sRGB frame handed to the pipeline. */
  sourceId: string;
  /** Working buffer precision handed to Q01. Defaults to rgba16f. */
  workingSampleType?: 'f16' | 'f32';
}

const HALF_ONE = 0x3c00;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

function assertPositiveInt(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Invalid ${label}`);
  }
}

export function assertSceneLinearFrame(value: unknown): asserts value is SceneLinearFrame {
  if (!isObject(value)) throw new Error('Invalid scene-linear frame');
  assertPositiveInt(value.width, 'scene-linear width');
  assertPositiveInt(value.height, 'scene-linear height');
  if (value.channels !== 3) throw new Error('Scene-linear frame requires 3 channels');
  if (value.colorSpace !== 'linear-srgb' && value.colorSpace !== 'camera-linear') {
    throw new Error('Scene-linear frame requires a linear color space');
  }
  if (typeof value.sourceId !== 'string' || value.sourceId.length === 0) {
    throw new Error('Scene-linear frame requires a sourceId');
  }
  const width = value.width;
  const height = value.height;
  if (value.sampleType === 'f16') {
    const isValues = typeof Float16Array !== 'undefined' && value.data instanceof Float16Array;
    if (!isValues && !(value.data instanceof Uint16Array)) {
      throw new Error('Scene-linear f16 frame requires Float16Array or half-bit Uint16Array data');
    }
  } else if (value.sampleType === 'f32') {
    if (!(value.data instanceof Float32Array)) {
      throw new Error('Scene-linear f32 frame requires Float32Array data');
    }
  } else {
    throw new Error('Scene-linear frame requires sampleType f16 or f32');
  }
  const data = value.data as ArrayLike<number>;
  if (data.length !== width * height * 3) {
    throw new Error('Scene-linear data length must be width*height*3');
  }
  if (value.data instanceof Uint16Array) {
    for (const bits of value.data) {
      if ((bits & 0x7c00) === 0x7c00) throw new Error('Scene-linear frame contains non-finite pixels');
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) throw new Error('Scene-linear frame contains non-finite pixels');
    }
  }
}

export function assertDisplaySrgb8Frame(value: unknown): asserts value is DisplaySrgb8Frame {
  if (!isObject(value)) throw new Error('Invalid display frame');
  assertPositiveInt(value.width, 'display width');
  assertPositiveInt(value.height, 'display height');
  if (value.channels !== 4) throw new Error('Display frame requires 4 channels');
  if (value.colorSpace !== 'srgb') throw new Error('Display frame must be sRGB');
  const data = value.data;
  if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    throw new Error('Display frame requires 8-bit data');
  }
  if ((data as ArrayLike<number>).length !== (value.width as number) * (value.height as number) * 4) {
    throw new Error('Display frame data length must be width*height*4');
  }
}

/** Round-to-nearest-even float32 -> IEEE 754 half bits. */
export function floatToHalfBits(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('cannot encode non-finite value as f16');
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0];
  let bits = (x >>> 16) & 0x8000;
  let mantissa = (x >>> 12) & 0x07ff;
  const exponent = (x >>> 23) & 0xff;
  if (exponent < 103) return bits;
  if (exponent > 142) return bits | 0x7bff;
  if (exponent < 113) {
    mantissa |= 0x0800;
    bits |= (mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1);
    return bits;
  }
  bits |= ((exponent - 112) << 10) | (mantissa >> 1);
  bits += mantissa & 1;
  return bits;
}

/**
 * Q03 -> Q01 boundary adapter. Q01 rejects rgba8 working buffers, so the RGB
 * scene-linear frame is expanded to RGBA float with alpha = 1 and validated with
 * the real Q01 `assertDecodedSource` before it can enter the shared pipeline.
 */
export function sceneLinearToQ01DecodedSource(
  frame: SceneLinearFrame,
  meta: Q01BridgeMeta,
): DecodedSource {
  assertSceneLinearFrame(frame);
  if (frame.colorSpace !== 'linear-srgb') {
    throw new Error('Camera-space frames must go through the camera matrix before the Q01 boundary');
  }
  if (typeof meta.name !== 'string' || typeof meta.mimeType !== 'string' || typeof meta.decoderId !== 'string') {
    throw new Error('Q01 bridge metadata requires name, mimeType and decoderId');
  }
  const { width, height } = frame;
  const pixels = width * height;
  const format: ImageBufferFormat = frame.sampleType === 'f16' ? 'rgba16f' : 'rgba32f';
  let data: Uint16Array | Float32Array;
  if (frame.sampleType === 'f16') {
    const bits = frame.data instanceof Uint16Array
      ? frame.data
      : new Uint16Array((frame.data as Float16Array).buffer, (frame.data as Float16Array).byteOffset, (frame.data as Float16Array).length);
    const out = new Uint16Array(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      out[i * 4] = bits[i * 3];
      out[i * 4 + 1] = bits[i * 3 + 1];
      out[i * 4 + 2] = bits[i * 3 + 2];
      out[i * 4 + 3] = HALF_ONE;
    }
    data = out;
  } else {
    const rgb = frame.data as Float32Array;
    const out = new Float32Array(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      out[i * 4] = rgb[i * 3];
      out[i * 4 + 1] = rgb[i * 3 + 1];
      out[i * 4 + 2] = rgb[i * 3 + 2];
      out[i * 4 + 3] = 1;
    }
    data = out;
  }
  const sourceId = frame.sourceId;
  const decoded: DecodedSource = {
    source: {
      id: sourceId,
      name: meta.name,
      mimeType: meta.mimeType,
      width,
      height,
      precision: meta.precision ?? 'hdr-linear16',
      hasAlpha: false,
      decoderId: meta.decoderId,
      ...(meta.byteLength !== undefined ? { byteLength: meta.byteLength } : {}),
    },
    working: {
      id: meta.workingId ?? `${sourceId}:working`,
      sourceId,
      width,
      height,
      format,
      colorSpace: 'linear-srgb',
      memoryBytes: imageBufferByteLength(width, height, format),
      storage: 'cpu',
      data,
    },
    warnings: [],
  };
  assertDecodedSource(decoded);
  return decoded;
}

/**
 * SDR inputs are decoded/displayed as sRGB8, but the shared pipeline works in
 * linear float. This converts an 8-bit sRGB frame into a linear rgba16f working
 * buffer so no rgba8 buffer crosses the Q01 boundary.
 */
export function sdrSrgb8ToQ01DecodedSource(
  frame: DisplaySrgb8Frame,
  meta: SdrBridgeOptions,
): DecodedSource {
  assertDisplaySrgb8Frame(frame);
  if (typeof meta.sourceId !== 'string' || meta.sourceId.length === 0) {
    throw new Error('SDR bridge requires a sourceId');
  }
  const { width, height } = frame;
  const pixels = width * height;
  const format: ImageBufferFormat = (meta.workingSampleType ?? 'f16') === 'f32' ? 'rgba32f' : 'rgba16f';
  const src = frame.data;
  const working = format === 'rgba16f' ? new Uint16Array(pixels * 4) : new Float32Array(pixels * 4);
  const store = (index: number, value: number) => {
    if (working instanceof Uint16Array) {
      working[index] = floatToHalfBits(value);
    } else {
      working[index] = value;
    }
  };
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) {
      const srgb = src[i * 4 + c] / 255;
      const linear = srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
      store(i * 4 + c, linear);
    }
    store(i * 4 + 3, 1);
  }
  const decoded: DecodedSource = {
    source: {
      id: meta.sourceId,
      name: meta.name,
      mimeType: meta.mimeType,
      width,
      height,
      precision: 'sdr-srgb8',
      hasAlpha: false,
      decoderId: meta.decoderId,
      ...(meta.byteLength !== undefined ? { byteLength: meta.byteLength } : {}),
    },
    working: {
      id: meta.workingId ?? `${meta.sourceId}:working`,
      sourceId: meta.sourceId,
      width,
      height,
      format,
      colorSpace: 'linear-srgb',
      memoryBytes: imageBufferByteLength(width, height, format),
      storage: 'cpu',
      data: working,
    },
    warnings: [],
  };
  assertDecodedSource(decoded);
  return decoded;
}
