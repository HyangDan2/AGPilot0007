/// <reference types="vite/client" />
import { FlashRaw, detectFormat, init, supportsFile, type RawFormatName } from 'flashraw';
import flashRawSimdUrl from 'flashraw/wasm/simd?url';
import flashRawSimdJxlUrl from 'flashraw/wasm/simd-jxl?url';
import {
  assertDecodedSource,
  imageBufferByteLength,
  type DecodedSource,
} from '../contracts/imageBuffer';
import { budgetForDevice, detectDeviceCapabilities } from '../contracts/resourceBudget';

export const RAW_DECODER_ID = 'flashraw@0.5.0';
export const RAW_WORKING_FORMAT = 'rgba16f' as const;
export const DEFAULT_MAX_INPUT_BYTES = 256 * 1024 * 1024;
const HALF_ONE = 0x3c00;

export type RawDecodeErrorCode =
  | 'unsupported-format'
  | 'corrupt-file'
  | 'budget-exceeded'
  | 'decode-failed';

export interface RawDecodeErrorDetails {
  stage: 'validate' | 'open' | 'budget' | 'decode';
  width?: number;
  height?: number;
  estimatedBytes?: number;
  maxBytes?: number;
  cause?: unknown;
}

export class RawDecodeError extends Error {
  readonly code: RawDecodeErrorCode;
  readonly details: RawDecodeErrorDetails;

  constructor(code: RawDecodeErrorCode, message: string, details: RawDecodeErrorDetails) {
    super(message);
    this.name = 'RawDecodeError';
    this.code = code;
    this.details = details;
  }
}

export interface RawSourceInput {
  readonly data: Blob | ArrayBuffer | ArrayBufferView;
  readonly name?: string;
  readonly type?: string;
  readonly size?: number;
}

export interface RawDecodeOptions {
  signal?: AbortSignal;
  id?: string;
  maxInputBytes?: number;
  maxWorkingBytes?: number;
  corruptionPolicy?: 'strict' | 'recover';
}

let sourceCounter = 0;
let flashRawInit: Promise<unknown> | null = null;

/** Browsers need the bundled WASM URLs; Node resolves its own entry at import time. */
export function ensureRawEngine(): Promise<unknown> | undefined {
  if (typeof window === 'undefined' && typeof self === 'undefined') return undefined;
  flashRawInit ??= init({ wasm: flashRawSimdUrl, jpegxlWasm: flashRawSimdJxlUrl, threads: false });
  return flashRawInit;
}

const abortError = (): DOMException => new DOMException('RAW decode cancelled', 'AbortError');

export const isAbortError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

export async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, onLate?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.then(onLate).catch(() => {});
    throw abortError();
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } catch (error) {
    if (isAbortError(error)) promise.then(onLate).catch(() => {});
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export function inputSize(input: RawSourceInput): number | undefined {
  if (typeof input.size === 'number') return input.size;
  if (input.data instanceof Blob) return input.data.size;
  if (input.data instanceof ArrayBuffer) return input.data.byteLength;
  return input.data.byteLength;
}

export function inputName(input: RawSourceInput): string {
  if (input.name) return input.name;
  const candidate = input.data as { name?: unknown };
  return typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : 'RAW image';
}

export function inputType(input: RawSourceInput, format: RawFormatName): string {
  if (input.type) return input.type;
  const candidate = input.data as { type?: unknown };
  if (typeof candidate.type === 'string' && candidate.type.length > 0) return candidate.type;
  return `image/x-${format.toLowerCase()}`;
}

export function mapDecodeError(error: unknown, stage: RawDecodeErrorDetails['stage']): never {
  if (error instanceof RawDecodeError) throw error;
  if (isAbortError(error)) throw error;
  const kind = (error as { kind?: string } | null)?.kind;
  const message = error instanceof Error ? error.message : String(error);
  if (kind === 'UnsupportedFormat' || kind === 'UnsupportedCompression' || kind === 'CameraUnsupported') {
    throw new RawDecodeError('unsupported-format', message, { stage, cause: error });
  }
  if (kind === 'CorruptFile' || kind === 'InvalidMetadata') {
    throw new RawDecodeError('corrupt-file', message, { stage, cause: error });
  }
  if (kind === 'OutOfMemory' || kind === 'LimitExceeded') {
    throw new RawDecodeError('budget-exceeded', message, { stage, cause: error });
  }
  if (kind === 'Cancelled') throw abortError();
  throw new RawDecodeError('decode-failed', message, { stage, cause: error });
}

/**
 * Decodes a RAW file into a scene-linear DecodedSource. The working buffer is
 * half-float RGBA (RGB samples with alpha 1) in linear sRGB, ready for the
 * source stage of the shared pipeline. LibRaw is intentionally not used.
 */
export async function decodeRawToSource(input: RawSourceInput, options: RawDecodeOptions = {}): Promise<DecodedSource> {
  throwIfAborted(options.signal);
  try {
    await ensureRawEngine();
  } catch (error) {
    return mapDecodeError(error, 'open');
  }
  throwIfAborted(options.signal);

  const size = inputSize(input);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (size !== undefined && size > maxInputBytes) {
    throw new RawDecodeError(
      'budget-exceeded',
      `RAW input is ${(size / (1024 * 1024)).toFixed(1)} MB, above the ${(maxInputBytes / (1024 * 1024)).toFixed(0)} MB input limit`,
      { stage: 'validate', estimatedBytes: size, maxBytes: maxInputBytes },
    );
  }

  let format: RawFormatName | null;
  let supported: boolean;
  try {
    format = await raceAbort(detectFormat(input.data), options.signal);
    throwIfAborted(options.signal);
    supported = await raceAbort(supportsFile(input.data), options.signal);
  } catch (error) {
    return mapDecodeError(error, 'validate');
  }
  if (!format || !supported) {
    throw new RawDecodeError('unsupported-format', 'File is not a supported camera RAW format', {
      stage: 'validate',
    });
  }

  const openPromise = FlashRaw.open(input.data);
  let raw: FlashRaw;
  try {
    raw = await raceAbort(openPromise, options.signal, (late) => late.close());
  } catch (error) {
    return mapDecodeError(error, 'open');
  }

  const width = raw.metadata.width;
  const height = raw.metadata.height;
  const maxWorkingBytes = options.maxWorkingBytes ?? budgetForDevice(detectDeviceCapabilities()).maxCpuBytes;
  const estimatedBytes = imageBufferByteLength(width, height, RAW_WORKING_FORMAT);
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > maxWorkingBytes) {
    raw.close();
    throw new RawDecodeError(
      'budget-exceeded',
      `Estimated working buffer ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB exceeds the ${(maxWorkingBytes / (1024 * 1024)).toFixed(0)} MB memory budget for ${width}x${height}`,
      { stage: 'budget', width, height, estimatedBytes, maxBytes: maxWorkingBytes },
    );
  }

  let frame: Awaited<ReturnType<FlashRaw['decode']>> | null = null;
  let deferredClose = false;
  try {
    throwIfAborted(options.signal);
    const decodePromise = raw.decode({
      output: 'linear-rgb',
      sampleType: 'f16',
      corruptionPolicy: options.corruptionPolicy ?? 'strict',
    });
    try {
      frame = await raceAbort(decodePromise, options.signal);
    } catch (error) {
      if (isAbortError(error)) {
        deferredClose = true;
        decodePromise
          .then((late) => late?.free?.())
          .catch(() => {})
          .finally(() => raw.close());
      }
      throw error;
    }
    throwIfAborted(options.signal);

    const decodedWidth = frame.width;
    const decodedHeight = frame.height;
    if (frame.channels !== 3 || !(frame.data instanceof Uint16Array)) {
      throw new RawDecodeError('decode-failed', 'RAW decoder did not return 3-channel half-float samples', {
        stage: 'decode',
        width: decodedWidth,
        height: decodedHeight,
      });
    }
    const sourceBytes = imageBufferByteLength(decodedWidth, decodedHeight, RAW_WORKING_FORMAT);
    if (sourceBytes > maxWorkingBytes) {
      throw new RawDecodeError(
        'budget-exceeded',
        `Decoded working buffer ${(sourceBytes / (1024 * 1024)).toFixed(1)} MB exceeds the ${(maxWorkingBytes / (1024 * 1024)).toFixed(0)} MB memory budget`,
        { stage: 'decode', width: decodedWidth, height: decodedHeight, estimatedBytes: sourceBytes, maxBytes: maxWorkingBytes },
      );
    }

    const pixels = decodedWidth * decodedHeight;
    const rgb = frame.data;
    if (rgb.length < pixels * 3) {
      throw new RawDecodeError('decode-failed', 'RAW decoder returned a truncated sample buffer', {
        stage: 'decode',
        width: decodedWidth,
        height: decodedHeight,
      });
    }
    const rgba = new Uint16Array(pixels * 4);
    for (let index = 0; index < pixels; index += 1) {
      const target = index * 4;
      const source = index * 3;
      rgba[target] = rgb[source];
      rgba[target + 1] = rgb[source + 1];
      rgba[target + 2] = rgb[source + 2];
      rgba[target + 3] = HALF_ONE;
    }

    const id = options.id ?? `raw-source-${++sourceCounter}`;
    const warnings = (frame.warnings ?? []).map((warning) => warning.message);
    if (frame.incomplete) warnings.push('RAW decoder reported incomplete sensor data');
    const decoded: DecodedSource = {
      source: {
        id,
        name: inputName(input),
        mimeType: inputType(input, format),
        width: decodedWidth,
        height: decodedHeight,
        precision: 'hdr-linear16',
        hasAlpha: false,
        decoderId: RAW_DECODER_ID,
        byteLength: size,
      },
      working: {
        id: `${id}:working`,
        sourceId: id,
        width: decodedWidth,
        height: decodedHeight,
        format: RAW_WORKING_FORMAT,
        colorSpace: 'linear-srgb',
        memoryBytes: sourceBytes,
        storage: 'cpu',
        data: rgba,
      },
      warnings,
    };
    assertDecodedSource(decoded);
    return decoded;
  } catch (error) {
    return mapDecodeError(error, 'decode');
  } finally {
    try {
      frame?.free?.();
    } finally {
      if (!deferredClose) raw.close();
    }
  }
}
