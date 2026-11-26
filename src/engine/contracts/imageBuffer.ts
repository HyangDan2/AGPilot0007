export type WorkingColorSpace = 'linear-srgb';
export type SourcePrecision = 'sdr-srgb8' | 'hdr-linear16';
export type ImageBufferFormat = 'rgba8' | 'rgba16f' | 'rgba32f';

export const WORKING_COLOR_SPACE: WorkingColorSpace = 'linear-srgb';

export interface ImageSourceDescriptor {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  precision: SourcePrecision;
  hasAlpha: boolean;
  decoderId: string;
  byteLength?: number;
}

interface ImageBufferBase {
  id: string;
  sourceId: string;
  width: number;
  height: number;
  format: ImageBufferFormat;
  colorSpace: WorkingColorSpace;
  memoryBytes: number;
}

export interface CpuImageBuffer extends ImageBufferBase {
  storage: 'cpu';
  data: Uint8Array | Uint16Array | Float32Array;
}

export interface GpuImageBuffer extends ImageBufferBase {
  storage: 'gpu';
  texture: WebGLTexture;
}

export type ImageBuffer = CpuImageBuffer | GpuImageBuffer;

export interface DecodedSource {
  source: ImageSourceDescriptor;
  working: ImageBuffer;
  preview?: ImageBuffer;
  warnings: readonly string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

/**
 * Source modules (Q03) must hand the pipeline a linear working buffer. SDR
 * inputs are decoded through the sRGB EOTF; RAW inputs stay scene-linear and
 * keep float storage so the shared color pipeline never quantizes to 8-bit.
 */
export function assertDecodedSource(value: unknown): asserts value is DecodedSource {
  if (!isObject(value)) throw new Error('Invalid decoded source');
  const source = value.source;
  const working = value.working;
  if (!isObject(source) || typeof source.id !== 'string' || typeof source.decoderId !== 'string') {
    throw new Error('Invalid decoded source');
  }
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || (source.width as number) <= 0 || (source.height as number) <= 0) {
    throw new Error('Invalid decoded source dimensions');
  }
  if (source.precision !== 'sdr-srgb8' && source.precision !== 'hdr-linear16') {
    throw new Error('Invalid decoded source precision');
  }
  if (!isObject(working)) throw new Error('Decoded source must provide a working buffer');
  if (working.colorSpace !== WORKING_COLOR_SPACE) throw new Error('Working buffer must be linear-srgb');
  if (working.format !== 'rgba16f' && working.format !== 'rgba32f') {
    throw new Error('Working buffer requires 16-bit or 32-bit float storage');
  }
  if (working.width !== source.width || working.height !== source.height) {
    throw new Error('Working buffer dimensions must match the source');
  }
  if (working.storage === 'cpu') {
    if (!(working.data instanceof Uint16Array) && !(working.data instanceof Float32Array)) {
      throw new Error('CPU working buffer requires 16-bit or 32-bit float data');
    }
  } else if (working.storage === 'gpu') {
    if (!working.texture) throw new Error('GPU working buffer requires a texture');
  } else {
    throw new Error('Working buffer requires cpu or gpu storage');
  }
}
