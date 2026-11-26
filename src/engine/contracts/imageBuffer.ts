export type WorkingColorSpace = 'linear-srgb';
export type SourcePrecision = 'sdr-srgb8' | 'hdr-linear16';
export type ImageBufferFormat = 'rgba8' | 'rgba16f' | 'rgba32f';

export const WORKING_COLOR_SPACE: WorkingColorSpace = 'linear-srgb';

export const IMAGE_BUFFER_BYTES_PER_PIXEL: Readonly<Record<ImageBufferFormat, number>> = Object.freeze({
  rgba8: 4,
  rgba16f: 8,
  rgba32f: 16,
});

export const IMAGE_BUFFER_FORMATS: readonly ImageBufferFormat[] = ['rgba8', 'rgba16f', 'rgba32f'];

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
  resourceOwner: string;
  disposable: boolean;
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

const isHalfNonFinite = (value: number): boolean => (value & 0x7c00) === 0x7c00;

function hasNonFinitePixels(data: Uint16Array | Float32Array): boolean {
  if (data instanceof Float32Array) {
    for (const value of data) {
      if (!Number.isFinite(value)) return true;
    }
    return false;
  }
  for (const value of data) {
    if (isHalfNonFinite(value)) return true;
  }
  return false;
}

export function imageBufferByteLength(width: number, height: number, format: ImageBufferFormat): number {
  return width * height * IMAGE_BUFFER_BYTES_PER_PIXEL[format];
}

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
  }
  validateImageBuffer(working, { id: source.id });
  if (value.preview !== undefined) {
    if (!isObject(value.preview)) throw new Error('Invalid decoded preview buffer');
    validateImageBuffer(value.preview, { id: source.id });
  }
}

/**
 * Validates a CPU or GPU image buffer at a module boundary. Float buffers are
 * scanned for NaN/Infinity; GPU buffers must declare an owner and whether the
 * scope is responsible for calling deleteTexture/deleteBuffer.
 */
export function validateImageBuffer(
  value: unknown,
  source?: Pick<ImageSourceDescriptor, 'id'>,
): asserts value is ImageBuffer {
  if (!isObject(value)) throw new Error('Invalid image buffer');
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error('Invalid image buffer identity');
  if (typeof value.sourceId !== 'string' || value.sourceId.length === 0) {
    throw new Error('Invalid image buffer sourceId');
  }
  if (source && value.sourceId !== source.id) throw new Error('Image buffer sourceId mismatch');
  if (
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    (value.width as number) <= 0 ||
    (value.height as number) <= 0
  ) {
    throw new Error('Invalid image buffer dimensions');
  }
  if (!IMAGE_BUFFER_FORMATS.includes(value.format as ImageBufferFormat)) {
    throw new Error('Invalid image buffer format');
  }
  if (value.colorSpace !== WORKING_COLOR_SPACE) throw new Error('Image buffer must be linear-srgb');

  const format = value.format as ImageBufferFormat;
  const expectedBytes = imageBufferByteLength(value.width as number, value.height as number, format);
  if (!Number.isSafeInteger(expectedBytes)) throw new Error('Invalid image buffer dimensions');
  if (value.memoryBytes !== expectedBytes) throw new Error('Image buffer memoryBytes mismatch');

  if (value.storage === 'cpu') {
    const data = value.data;
    if (format === 'rgba8' && !(data instanceof Uint8Array)) throw new Error('Image buffer data type mismatch');
    if (format === 'rgba16f' && !(data instanceof Uint16Array)) throw new Error('Image buffer data type mismatch');
    if (format === 'rgba32f' && !(data instanceof Float32Array)) throw new Error('Image buffer data type mismatch');
    if ((data as ArrayLike<number>).length !== (value.width as number) * (value.height as number) * 4) {
      throw new Error('Image buffer data length mismatch');
    }
    if (format !== 'rgba8' && hasNonFinitePixels(data as Uint16Array | Float32Array)) {
      throw new Error('Image buffer contains non-finite pixels');
    }
    return;
  }

  if (value.storage === 'gpu') {
    if (!value.texture) throw new Error('GPU image buffer requires a texture');
    if (typeof value.resourceOwner !== 'string' || value.resourceOwner.length === 0) {
      throw new Error('GPU image buffer requires resourceOwner');
    }
    if (typeof value.disposable !== 'boolean') {
      throw new Error('GPU image buffer requires disposable flag');
    }
    return;
  }

  throw new Error('Image buffer requires cpu or gpu storage');
}
