// Q03 imaging buffer contract, proposed for the Q01 engine freeze.
// Two paths are kept structurally separate: scene-linear RAW (unbounded float)
// and display-referred SDR (sRGB, 8 or 16 bit). Nothing in this file modifies src/engine.

export const IMAGING_CONTRACT_VERSION = 'q03-contract/1.0.0';

export type LinearDataType = 'f16' | 'f32';

/** Scene-linear camera image. Channels are RGB, never RGBA; alpha would be quantized data loss. */
export interface SceneLinearFrame {
  width: number;
  height: number;
  channels: 3;
  dataType: LinearDataType;
  layout: 'linear';
  transfer: 'linear';
  primaries: 'srgb' | 'display-p3' | string;
  source: 'sensor' | 'preview';
  data: Float32Array | Uint16Array;
}

/** Display-referred SDR image handed to the existing colour engine (which expects sRGB RGBA8). */
export interface DisplaySrgb8Frame {
  width: number;
  height: number;
  channels: 4;
  dataType: 'u8';
  transfer: 'srgb';
  primaries: 'srgb';
  colorSpace: 'srgb';
  data: Uint8ClampedArray;
}

export class ImagingContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImagingContractError';
    this.code = code;
  }
}

export function isSceneLinearFrame(frame: any): frame is SceneLinearFrame {
  return !!frame && frame.channels === 3 && (frame.dataType === 'f16' || frame.dataType === 'f32')
    && ArrayBuffer.isView(frame.data) && frame.transfer === 'linear';
}

export function assertSceneLinearFrame(frame: any): asserts frame is SceneLinearFrame {
  if (!frame) throw new ImagingContractError('not-linear', 'scene-linear frame is missing');
  if (frame.channels !== 3) throw new ImagingContractError('channels', `scene-linear input must be RGB (got ${frame.channels} channels)`);
  if (frame.dataType !== 'f16' && frame.dataType !== 'f32') {
    throw new ImagingContractError('datatype', `scene-linear input must be f16/f32 (got ${frame.dataType}); 8/16-bit integer input is display-referred`);
  }
  if (!(frame.data instanceof Float32Array) && !(frame.data instanceof Uint16Array)) {
    throw new ImagingContractError('buffer', `unexpected buffer ${frame.data?.constructor?.name ?? typeof frame.data}`);
  }
  if (frame.data.length !== frame.width * frame.height * 3) {
    throw new ImagingContractError('size', `buffer length ${frame.data.length} != ${frame.width}x${frame.height}x3`);
  }
  if (frame.transfer !== 'linear') throw new ImagingContractError('transfer', `scene-linear input must carry transfer=linear (got ${frame.transfer})`);
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * (f / 1024) * Math.pow(2, -14);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * Math.pow(2, e - 15);
}

export function linearValue(data: Float32Array | Uint16Array, dataType: LinearDataType, i: number): number {
  return dataType === 'f16' ? halfToFloat((data as Uint16Array)[i]) : (data as Float32Array)[i];
}

const SRGB_ENCODE_LUT = (() => {
  const lut = new Float32Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const v = i / 4096;
    lut[i] = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  return lut;
})();

export function srgbEncode(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v >= 1) return 1;
  const t = v * 4096;
  const i = t | 0;
  const f = t - i;
  return SRGB_ENCODE_LUT[i] * (1 - f) + SRGB_ENCODE_LUT[Math.min(4096, i + 1)] * f;
}

export function srgb8(v: number): number {
  return Math.round(srgbEncode(v) * 255);
}

export interface LinearStats {
  samples: number;
  max: number;
  p999: number;
  mean: number;
  over1Frac: number;
  over2Frac: number;
  /** Fraction of samples sitting exactly at 1.0: an early-clipping signature in a linear buffer. */
  atOneFrac: number;
  zeroFrac: number;
  nonFinite: number;
  /** f16 saturation sentinel (65504) seen in the buffer. */
  halfSaturated: number;
}

export function linearStats(frame: SceneLinearFrame, maxSamples = 300000): LinearStats {
  assertSceneLinearFrame(frame);
  const { data, dataType } = frame;
  const n = data.length;
  const stride = Math.max(1, Math.floor(n / 3 / maxSamples)) * 3;
  const vals: number[] = [];
  let max = -Infinity, sum = 0, over1 = 0, over2 = 0, atOne = 0, zero = 0, nonFinite = 0, halfSat = 0, count = 0;
  for (let i = 0; i < n; i += stride) {
    const v = linearValue(data, dataType, i);
    if (!Number.isFinite(v)) { nonFinite++; continue; }
    if (dataType === 'f16' && (data as Uint16Array)[i] === 0x7bff) halfSat++;
    vals.push(v);
    count++;
    sum += v;
    if (v > max) max = v;
    if (v > 1) over1++;
    if (v > 2) over2++;
    if (v === 1) atOne++;
    if (v === 0) zero++;
  }
  vals.sort((a, b) => a - b);
  const p999 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.999))] : 0;
  return {
    samples: count,
    max: Number(max.toFixed(5)),
    p999: Number(p999.toFixed(5)),
    mean: Number((sum / Math.max(1, count)).toFixed(5)),
    over1Frac: count ? over1 / count : 0,
    over2Frac: count ? over2 / count : 0,
    atOneFrac: count ? atOne / count : 0,
    zeroFrac: count ? zero / count : 0,
    nonFinite,
    halfSaturated: halfSat,
  };
}

/** Converts scene-linear RGB to display-referred sRGB RGBA8. No clipping/quantization happens before the final encode. */
export function sceneLinearToDisplaySrgb8(frame: SceneLinearFrame): DisplaySrgb8Frame {
  assertSceneLinearFrame(frame);
  const pixels = frame.width * frame.height;
  const out = new Uint8ClampedArray(pixels * 4);
  let over1 = 0;
  for (let px = 0; px < pixels; px++) {
    const o = px * 3;
    for (let c = 0; c < 3; c++) {
      const v = linearValue(frame.data, frame.dataType, o + c);
      if (v > 1) over1++;
      out[px * 4 + c] = srgb8(v);
    }
    out[px * 4 + 3] = 255;
  }
  return {
    width: frame.width,
    height: frame.height,
    channels: 4,
    dataType: 'u8',
    transfer: 'srgb',
    primaries: 'srgb',
    colorSpace: 'srgb',
    data: out,
  };
}

export interface Srgb8Compare {
  samples: number;
  differingFrac: number;
  meanAbsCode: number;
  p99Code: number;
  maxCode: number;
}

export function compareSrgb8(a: ArrayLike<number>, b: ArrayLike<number>): Srgb8Compare | null {
  if (a.length !== b.length) return null;
  let differing = 0, sum = 0, maxCode = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > 0) {
      differing++;
      sum += d;
      hist[Math.min(255, d)]++;
      if (d > maxCode) maxCode = d;
    }
  }
  let cum = 0, p99 = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= differing * 0.99) { p99 = i; break; }
  }
  return {
    samples: a.length,
    differingFrac: differing / a.length,
    meanAbsCode: differing ? sum / differing : 0,
    p99Code: p99,
    maxCode,
  };
}

/** Camera RGB -> working primaries 3x3 matrix from FlashRaw's metadata report. */
export function resolveCameraMatrix(colorMatrices: any): number[] | null {
  const values = colorMatrices?.color?.[0]?.values;
  if (Array.isArray(values) && values.length === 9 && values.every((v: any) => Number.isFinite(v))) return values;
  return null;
}

export function invert3x3(m: ArrayLike<number>): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = Array.from(m);
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function matMul3(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** Standard XYZ (D65) -> linear sRGB matrix, used only to test a DNG ColorMatrix interpretation. */
export const XYZ_D65_TO_LINEAR_SRGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
];

export function matVec3(m: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Resolution contract: RGB outputs are cropped to the default crop, so the decoded buffer is
 * (crop.width, crop.height) with origin (0,0). Raw outputs keep the sensor buffer, and the file's
 * activeArea/crop offsets are buffer coordinates. EXIF orientation is applied by the decoder for
 * display outputs (frame.orientation === 1), so width/height are already display-oriented.
 */
export interface ResolutionContract {
  fileWidth: number;
  fileHeight: number;
  activeArea: { x: number; y: number; width: number; height: number } | null;
  crop: { x: number; y: number; width: number; height: number } | null;
  displayWidth: number;
  displayHeight: number;
  orientationApplied: boolean;
  sensorBufferSize: { width: number; height: number } | null;
}

export function resolutionContract(frameInfo: any, frame: any): ResolutionContract {
  const active = frameInfo?.activeArea ?? null;
  const crop = frameInfo?.crop ?? null;
  const displayW = frame?.width ?? crop?.width ?? frameInfo?.width ?? 0;
  const displayH = frame?.height ?? crop?.height ?? frameInfo?.height ?? 0;
  return {
    fileWidth: frameInfo?.width ?? 0,
    fileHeight: frameInfo?.height ?? 0,
    activeArea: active,
    crop,
    displayWidth: displayW,
    displayHeight: displayH,
    orientationApplied: frame?.orientation === 1,
    sensorBufferSize: frame?.layout === 'raw' || frame?.cfa ? { width: frame?.width ?? 0, height: frame?.height ?? 0 } : null,
  };
}

export function orientationDisplaySize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

/** Upper bound for an encoded stream, used for the memory budget before any encoder runs. */
export function estimateEncodedBytes(bitrate: number, durationSeconds: number, audioBitrate = 0): number {
  return Math.ceil(((bitrate + audioBitrate) / 8) * durationSeconds * 1.25);
}
