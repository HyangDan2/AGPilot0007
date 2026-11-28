import { FlashRaw, detectFormat, supportsFile, type RawFormatName, type RawMetadata } from 'flashraw';
import { assertDecodedSource, imageBufferByteLength, type CpuImageBuffer, type DecodedSource } from '../contracts/imageBuffer';
import { budgetForDevice, detectDeviceCapabilities } from '../contracts/resourceBudget';
import type { DecodedImage } from '../image/decoder';
import { readCaptureDate } from '../image/captureDate';
import type { RawDevelopSettings } from '../../types/rawDevelop';
import { rawDevelopIsIdentity } from '../../types/rawDevelop';
import type { RawDevelopState } from '../contracts/develop';
import {
  createLatestTaskRunner,
  rawDevelopSettingsEqual,
  rawDevelopSettingsFromState,
  type LatestTaskRunner,
} from './rawRedevelop';
import {
  DEFAULT_MAX_INPUT_BYTES,
  RawDecodeError,
  ensureRawEngine,
  inputName,
  inputSize,
  inputType,
  isAbortError,
  mapDecodeError,
  raceAbort,
  throwIfAborted,
  type RawDecodeOptions,
  type RawSourceInput,
} from './rawSourceDecoder';
import {
  cameraToLinearSrgb,
  createRawDevelopReport,
  deriveDevelopDeltaMatrix,
  rawDevelopDecodeOptions,
  rawWhiteBalanceMultipliers,
  readWhiteBalanceInfo,
  resolveRawDevelopSettings,
  type RawDevelopReport,
  type RawWhiteBalanceInfo,
  type RawWhiteBalanceResult,
} from './rawDevelop';
import { canvasToPngBlob, renderLinearRgb16ToCanvas, renderLinearRgba16ToCanvas, renderLinearRgba16ToCanvasDelta } from './canvas';

/**
 * RAW develop seam (CP3-03 §2–3).
 *
 * Opening a RAW develops a HALF-SIZE linear source (flashraw `demosaic:
 * 'half-size'`, `linear-rgb`, `f16`) that feeds the normal preview pipeline.
 * The original file/Blob and the develop settings are kept in a WeakMap keyed
 * by the frozen `DecodedSource`; the full-resolution develop exists only inside
 * `resolveRawOriginal`, which exporters call lazily. No full-size canvas is
 * retained after open.
 *
 * Retained-memory method (`accountRawOpenMemory`): file/Blob bytes needed for the
 * lazy export develop + half-size rgba16f working buffer + preview RGBA8 canvas.
 * Transient decoder frames and the export-time full-resolution canvas are not
 * retained and therefore not counted.
 */

export const RAW_DEVELOP_DECODER_ID = 'flashraw-develop@0.5.0';
export const RAW_PREVIEW_MAX_EDGE = 2048;
export const RAW_OPEN_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const HALF_ONE = 0x3c00;

export type RawDevelopMode = 'preview' | 'export';

export interface RawDevelopOptions extends Omit<RawDecodeOptions, 'id'> {
  id?: string;
  settings?: Partial<RawDevelopSettings>;
  previewMaxEdge?: number;
  /** Defaults to 'preview' (half-size). 'export' is for parity/measurement only. */
  mode?: RawDevelopMode;
}

export interface RawMemoryAccount {
  fileBytes: number;
  workingBytes: number;
  previewBytes: number;
  totalBytes: number;
  withinOpenLimit: boolean;
}

export interface DevelopedRawSource {
  source: DecodedSource;
  report: RawDevelopReport;
  /** True frame width/height after the default crop (not the half-size working size). */
  width: number;
  height: number;
}

export interface OpenRawResult extends DevelopedRawSource {
  image: DecodedImage;
  memory: RawMemoryAccount;
}

interface RawAssetEntry {
  data: Blob | ArrayBuffer | ArrayBufferView;
  byteLength: number;
  settings: RawDevelopSettings;
  report: RawDevelopReport;
  width: number;
  height: number;
  previewCanvas: HTMLCanvasElement;
  previewMaxEdge: number;
  /** Latest full decode: the delta-develop base for later exposure/WB edits. */
  metadata: RawMetadata;
  info: RawWhiteBalanceInfo;
  base: {
    working: CpuImageBuffer;
    settings: RawDevelopSettings;
    multipliers: [number, number, number];
    previewCanvas: HTMLCanvasElement;
  };
}

const rawAssets = new WeakMap<DecodedSource, RawAssetEntry>();
let developSourceCounter = 0;

export function accountRawOpenMemory(input: {
  fileBytes: number;
  workingBytes: number;
  previewWidth: number;
  previewHeight: number;
}): RawMemoryAccount {
  const previewBytes = input.previewWidth * input.previewHeight * 4;
  const totalBytes = input.fileBytes + input.workingBytes + previewBytes;
  return {
    fileBytes: input.fileBytes,
    workingBytes: input.workingBytes,
    previewBytes,
    totalBytes,
    withinOpenLimit: totalBytes <= RAW_OPEN_MEMORY_LIMIT_BYTES,
  };
}

interface DevelopedDecode {
  format: RawFormatName;
  metadata: RawMetadata;
  info: RawWhiteBalanceInfo;
  whiteBalance: RawWhiteBalanceResult;
  settings: RawDevelopSettings;
  report: RawDevelopReport;
  rgb: Uint16Array;
  /** Decoded (half-size for preview) frame size. */
  width: number;
  height: number;
  /** True sensor/default-crop size. */
  fullWidth: number;
  fullHeight: number;
}

async function decodeDeveloped(
  input: RawSourceInput,
  options: {
    settings?: Partial<RawDevelopSettings>;
    mode: RawDevelopMode;
    signal?: AbortSignal;
    maxWorkingBytes?: number;
    corruptionPolicy?: 'strict' | 'recover';
  },
): Promise<DevelopedDecode> {
  throwIfAborted(options.signal);
  try {
    await ensureRawEngine();
  } catch (error) {
    return mapDecodeError(error, 'open');
  }
  throwIfAborted(options.signal);

  const size = inputSize(input);
  if (size !== undefined && size > DEFAULT_MAX_INPUT_BYTES) {
    throw new RawDecodeError(
      'budget-exceeded',
      `RAW input is ${(size / (1024 * 1024)).toFixed(1)} MB, above the ${(DEFAULT_MAX_INPUT_BYTES / (1024 * 1024)).toFixed(0)} MB input limit`,
      { stage: 'validate', estimatedBytes: size, maxBytes: DEFAULT_MAX_INPUT_BYTES },
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
    throw new RawDecodeError('unsupported-format', 'File is not a supported camera RAW format', { stage: 'validate' });
  }

  const openPromise = FlashRaw.open(input.data);
  let raw: FlashRaw;
  try {
    raw = await raceAbort(openPromise, options.signal, (late) => late.close());
  } catch (error) {
    return mapDecodeError(error, 'open');
  }

  const metadata = raw.metadata;
  const info = readWhiteBalanceInfo(metadata);
  const settings = resolveRawDevelopSettings(options.settings, info);
  const whiteBalance = rawWhiteBalanceMultipliers(settings, info);
  const report = createRawDevelopReport(settings, info, whiteBalance, metadata);
  const maxWorkingBytes = options.maxWorkingBytes ?? budgetForDevice(detectDeviceCapabilities()).maxCpuBytes;
  const estimatedWidth = options.mode === 'preview' ? Math.ceil(metadata.width / 2) : metadata.width;
  const estimatedHeight = options.mode === 'preview' ? Math.ceil(metadata.height / 2) : metadata.height;
  const estimatedBytes = imageBufferByteLength(estimatedWidth, estimatedHeight, 'rgba16f');
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > maxWorkingBytes) {
    raw.close();
    throw new RawDecodeError(
      'budget-exceeded',
      `Estimated ${options.mode} working buffer ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB exceeds the ${(maxWorkingBytes / (1024 * 1024)).toFixed(0)} MB memory budget for ${metadata.width}x${metadata.height}`,
      { stage: 'budget', width: metadata.width, height: metadata.height, estimatedBytes, maxBytes: maxWorkingBytes },
    );
  }

  let frame: Awaited<ReturnType<FlashRaw['decode']>> | null = null;
  let deferredClose = false;
  try {
    throwIfAborted(options.signal);
    const decodeOptions = {
      ...rawDevelopDecodeOptions(settings, whiteBalance, options.mode),
      corruptionPolicy: options.corruptionPolicy ?? 'strict',
    };
    const decodePromise = raw.decode(decodeOptions);
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

    const width = frame.width;
    const height = frame.height;
    if (frame.channels !== 3 || !(frame.data instanceof Uint16Array)) {
      throw new RawDecodeError('decode-failed', 'RAW decoder did not return 3-channel half-float samples', {
        stage: 'decode',
        width,
        height,
      });
    }
    const workingBytes = imageBufferByteLength(width, height, 'rgba16f');
    if (workingBytes > maxWorkingBytes) {
      throw new RawDecodeError(
        'budget-exceeded',
        `Decoded working buffer ${(workingBytes / (1024 * 1024)).toFixed(1)} MB exceeds the ${(maxWorkingBytes / (1024 * 1024)).toFixed(0)} MB memory budget`,
        { stage: 'decode', width, height, estimatedBytes: workingBytes, maxBytes: maxWorkingBytes },
      );
    }
    if (frame.data.length < width * height * 3) {
      throw new RawDecodeError('decode-failed', 'RAW decoder returned a truncated sample buffer', {
        stage: 'decode',
        width,
        height,
      });
    }
    const decoderWarnings = (frame.warnings ?? []).map((warning) => warning.message);
    if (frame.incomplete) decoderWarnings.push('RAW decoder reported incomplete sensor data');
    report.warnings.push(...decoderWarnings);

    // Copy out of WASM-owned memory so the RAW handle can be released before returning.
    const rgb = frame.data.slice();
    return { format, metadata, info, whiteBalance, settings, report, rgb, width, height, fullWidth: metadata.width, fullHeight: metadata.height };
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

function buildSource(
  decoded: DevelopedDecode,
  input: RawSourceInput,
  id: string,
): DecodedSource {
  const { width, height } = decoded;
  const pixels = width * height;
  const rgba = new Uint16Array(pixels * 4);
  const rgb = decoded.rgb;
  for (let index = 0; index < pixels; index += 1) {
    const target = index * 4;
    const source = index * 3;
    rgba[target] = rgb[source];
    rgba[target + 1] = rgb[source + 1];
    rgba[target + 2] = rgb[source + 2];
    rgba[target + 3] = HALF_ONE;
  }
  const working: CpuImageBuffer = {
    id: `${id}:working`,
    sourceId: id,
    width,
    height,
    format: 'rgba16f',
    colorSpace: 'linear-srgb',
    memoryBytes: imageBufferByteLength(width, height, 'rgba16f'),
    storage: 'cpu',
    data: rgba,
  };
  const source: DecodedSource = {
    source: {
      id,
      name: inputName(input),
      mimeType: inputType(input, decoded.format),
      width,
      height,
      precision: 'hdr-linear16',
      hasAlpha: false,
      decoderId: RAW_DEVELOP_DECODER_ID,
      byteLength: inputSize(input),
    },
    working,
    warnings: [...decoded.report.warnings],
  };
  assertDecodedSource(source);
  return source;
}

/** Develops a RAW into a half-size linear `DecodedSource` (no DOM side effects). */
export async function developRawSource(
  input: RawSourceInput,
  options: RawDevelopOptions = {},
): Promise<DevelopedRawSource> {
  const decoded = await decodeDeveloped(input, {
    settings: options.settings,
    mode: options.mode ?? 'preview',
    signal: options.signal,
    maxWorkingBytes: options.maxWorkingBytes,
    corruptionPolicy: options.corruptionPolicy,
  });
  const id = options.id ?? `raw-develop-${++developSourceCounter}`;
  return {
    source: buildSource(decoded, input, id),
    report: decoded.report,
    width: decoded.fullWidth,
    height: decoded.fullHeight,
  };
}

function toBlob(data: Blob | ArrayBuffer | ArrayBufferView): Blob {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data]);
  const view = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  return new Blob([view as unknown as BlobPart]);
}

/**
 * Opens a RAW for editing: half-size develop + preview canvas + a lazy
 * full-resolution resolver. No full-size canvas or buffer survives this call.
 */
export async function openRawForEditing(
  input: RawSourceInput,
  options: RawDevelopOptions = {},
): Promise<OpenRawResult> {
  const decoded = await decodeDeveloped(input, {
    settings: options.settings,
    mode: 'preview',
    signal: options.signal,
    maxWorkingBytes: options.maxWorkingBytes,
    corruptionPolicy: options.corruptionPolicy,
  });
  const id = options.id ?? `raw-develop-${++developSourceCounter}`;
  const source = buildSource(decoded, input, id);
  const working = source.working as CpuImageBuffer;
  const preview = renderLinearRgba16ToCanvas(working, options.previewMaxEdge ?? RAW_PREVIEW_MAX_EDGE);

  rawAssets.set(source, {
    data: input.data,
    byteLength: inputSize(input) ?? 0,
    settings: decoded.settings,
    report: decoded.report,
    width: decoded.fullWidth,
    height: decoded.fullHeight,
    previewCanvas: preview,
    previewMaxEdge: options.previewMaxEdge ?? RAW_PREVIEW_MAX_EDGE,
    metadata: decoded.metadata,
    info: decoded.info,
    base: {
      working,
      settings: decoded.settings,
      multipliers: decoded.whiteBalance.multipliers,
      previewCanvas: preview,
    },
  });

  const blob = toBlob(input.data);
  const capture = await readCaptureDate(blob);
  const memory = accountRawOpenMemory({
    fileBytes: inputSize(input) ?? 0,
    workingBytes: working.memoryBytes,
    previewWidth: preview.width,
    previewHeight: preview.height,
  });
  if (!memory.withinOpenLimit) {
    decoded.report.warnings.push(
      `RAW working set ${(memory.totalBytes / (1024 * 1024)).toFixed(1)} MB exceeds the ${(RAW_OPEN_MEMORY_LIMIT_BYTES / (1024 * 1024)).toFixed(0)} MB open budget`,
    );
  }

  const image: DecodedImage = {
    ...capture,
    sourceUrl: URL.createObjectURL(blob),
    name: inputName(input),
    originalWidth: decoded.fullWidth,
    originalHeight: decoded.fullHeight,
    previewCanvas: preview,
    previewWidth: preview.width,
    previewHeight: preview.height,
    // The preview canvas stands in for the original; exporters call resolveOriginal.
    originalElement: preview as unknown as HTMLImageElement,
    resolveOriginal: () => resolveRawOriginal(source, options.signal),
  };
  return { source, image, report: decoded.report, width: decoded.fullWidth, height: decoded.fullHeight, memory };
}

/**
 * Develops and demosaics the full-resolution original on demand (export only).
 * Encodes a lossless PNG and decodes it into an HTMLImageElement so the normal
 * export pipeline can draw it; nothing full-size is retained afterwards.
 */
export async function resolveRawOriginal(source: DecodedSource, signal?: AbortSignal): Promise<HTMLImageElement> {
  const entry = rawAssets.get(source);
  if (!entry) {
    throw new RawDecodeError('decode-failed', 'RAW source is not registered for export resolution', { stage: 'decode' });
  }
  const decoded = await decodeDeveloped({ data: entry.data }, {
    settings: entry.settings,
    mode: 'export',
    signal,
    maxWorkingBytes: undefined,
  });
  if (decoded.width !== entry.width || decoded.height !== entry.height) {
    throw new RawDecodeError(
      'decode-failed',
      `Full-resolution develop size ${decoded.width}x${decoded.height} does not match the opened size ${entry.width}x${entry.height}`,
      { stage: 'decode', width: decoded.width, height: decoded.height },
    );
  }
  const canvas = renderLinearRgb16ToCanvas(decoded.rgb, decoded.width, decoded.height);
  const blob = await canvasToPngBlob(canvas);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface RawRedevelopDecoded {
  settings: RawDevelopSettings;
  report: RawDevelopReport;
  /** New half-size linear working buffer. */
  working: CpuImageBuffer;
  preview: HTMLCanvasElement;
  previewWidth: number;
  previewHeight: number;
  /** Full sensor/default-crop dimensions (develop never changes them). */
  width: number;
  height: number;
  /** True when the requested state already matches the decode (nothing ran). */
  skipped: boolean;
  /** True when the preview was derived from the existing decode (no flashraw run). */
  delta?: boolean;
}

export interface RawRedevelopOptions {
  signal?: AbortSignal;
  previewMaxEdge?: number;
}

/**
 * Decodes the half-size preview for a develop state without touching the asset.
 * A state equal to the current decode returns `skipped: true` (neutral fast path
 * when the asset is still at its open-time settings).
 */
export async function decodeRawRedevelop(
  source: DecodedSource,
  develop: RawDevelopState,
  options: RawRedevelopOptions = {},
): Promise<RawRedevelopDecoded> {
  const entry = rawAssets.get(source);
  if (!entry) {
    throw new RawDecodeError('decode-failed', 'RAW source is not registered for re-develop', { stage: 'decode' });
  }
  const settings = rawDevelopSettingsFromState(develop, entry.report.asShotTemperatureK);
  if (rawDevelopSettingsEqual(settings, entry.settings)) {
    return {
      settings: entry.settings,
      report: entry.report,
      working: source.working as CpuImageBuffer,
      preview: entry.previewCanvas,
      previewWidth: entry.previewCanvas.width,
      previewHeight: entry.previewCanvas.height,
      width: entry.width,
      height: entry.height,
      skipped: true,
    };
  }
  const delta = decodeDevelopDelta(entry, settings, options);
  if (delta) return delta;
  const decoded = await decodeDeveloped({ data: entry.data }, {
    settings,
    mode: 'preview',
    signal: options.signal,
    maxWorkingBytes: undefined,
  });
  const rebuilt = buildSource(decoded, { data: entry.data }, source.source.id);
  const working = rebuilt.working as CpuImageBuffer;
  const preview = renderLinearRgba16ToCanvas(working, options.previewMaxEdge ?? entry.previewMaxEdge);
  // This decode replaces the delta base, so later exposure/WB edits stay exact.
  entry.metadata = decoded.metadata;
  entry.info = decoded.info;
  entry.base = {
    working,
    settings: decoded.settings,
    multipliers: decoded.whiteBalance.multipliers,
    previewCanvas: preview,
  };
  return {
    settings: decoded.settings,
    report: decoded.report,
    working,
    preview,
    previewWidth: preview.width,
    previewHeight: preview.height,
    width: entry.width,
    height: entry.height,
    skipped: false,
  };
}

/**
 * CP5-02 fast path: exposure/WB edits reuse the open-time (or last full)
 * decode. The decoder balances camera RGB and applies exposure on linear
 * values, so a 3x3 delta in linear sRGB reproduces a fresh decode up to f16
 * rounding — no flashraw run, no new 48 MB working buffer. Highlight recovery
 * changes the decode algorithm itself, so those still re-decode, and a base
 * decoded with recovery baked in is not linear, so deltas on it would drift.
 */
function decodeDevelopDelta(
  entry: RawAssetEntry,
  settings: RawDevelopSettings,
  options: RawRedevelopOptions,
): RawRedevelopDecoded | null {
  if (entry.base.settings.highlightRecovery !== 'off' || settings.highlightRecovery !== 'off') return null;
  const targetWhiteBalance = rawWhiteBalanceMultipliers(settings, entry.info);
  const report = createRawDevelopReport(settings, entry.info, targetWhiteBalance, entry.metadata);
  const atBase = rawDevelopSettingsEqual(settings, entry.base.settings);
  if (!atBase) {
    const matrix = deriveDevelopDeltaMatrix({
      exposureEv: settings.exposureEv - entry.base.settings.exposureEv,
      baseMultipliers: entry.base.multipliers,
      targetMultipliers: targetWhiteBalance.multipliers,
      cameraToSrgb: cameraToLinearSrgb(entry.info.forwardMatrix),
    });
    if (!matrix) return null;
    throwIfAborted(options.signal);
    const preview = renderLinearRgba16ToCanvasDelta(entry.base.working, matrix, options.previewMaxEdge ?? entry.previewMaxEdge);
    return {
      settings,
      report,
      working: entry.base.working,
      preview,
      previewWidth: preview.width,
      previewHeight: preview.height,
      width: entry.width,
      height: entry.height,
      skipped: false,
      delta: true,
    };
  }
  const preview = entry.base.previewCanvas;
  return {
    settings: entry.base.settings,
    report,
    working: entry.base.working,
    preview,
    previewWidth: preview.width,
    previewHeight: preview.height,
    width: entry.width,
    height: entry.height,
    skipped: false,
    delta: true,
  };
}

/**
 * Applies a decoded re-develop to the registered asset. The `DecodedSource`
 * identity is preserved; only its working buffer/warnings and the asset's
 * settings/report/preview reference change. Callers must drop stale decodes
 * before calling (the debounced redeveloper does this for them).
 */
export function applyRawRedevelop(source: DecodedSource, decoded: RawRedevelopDecoded): void {
  if (decoded.skipped) return;
  const entry = rawAssets.get(source);
  if (!entry) return;
  entry.settings = decoded.settings;
  entry.report = decoded.report;
  entry.previewCanvas = decoded.preview;
  if (!Object.isFrozen(source)) {
    source.working = decoded.working;
    source.warnings = [...decoded.report.warnings];
  }
}

/** Single-shot re-develop (decode + apply). UI paths should use the redeveloper. */
export async function redevelopRawPreview(
  source: DecodedSource,
  develop: RawDevelopState,
  options: RawRedevelopOptions = {},
): Promise<RawRedevelopDecoded> {
  const decoded = await decodeRawRedevelop(source, develop, options);
  applyRawRedevelop(source, decoded);
  return decoded;
}

export interface RawRedeveloper {
  /** Debounced (trailing) request; a newer state always wins. */
  request(develop: RawDevelopState): void;
  flush(): Promise<RawRedevelopDecoded | null>;
  cancel(): void;
  dispose(): void;
}

export interface RawRedeveloperOptions {
  debounceMs?: number;
  previewMaxEdge?: number;
  onCommit?: (decoded: RawRedevelopDecoded) => void;
  onError?: (error: unknown) => void;
}

export const RAW_REDEVELOP_DEBOUNCE_MS = 200;

/**
 * Debounced latest-wins re-developer for one RAW asset. Returns null for
 * non-RAW sources (no registered asset), so callers never route SDR into it.
 * `onCommit` fires after the asset has been updated; replace
 * `image.previewCanvas`/`originalElement` with `decoded.preview` there.
 */
export function createRawRedeveloper(
  source: DecodedSource,
  options: RawRedeveloperOptions = {},
): RawRedeveloper | null {
  if (!rawAssets.has(source)) return null;
  const runner: LatestTaskRunner<RawRedevelopDecoded> = createLatestTaskRunner({
    delayMs: options.debounceMs ?? RAW_REDEVELOP_DEBOUNCE_MS,
    onCommit: (decoded) => {
      applyRawRedevelop(source, decoded);
      options.onCommit?.(decoded);
    },
    onError: (error) => options.onError?.(error),
  });
  return {
    request: (develop) =>
      runner.request((signal) =>
        decodeRawRedevelop(source, develop, { signal, previewMaxEdge: options.previewMaxEdge }),
      ),
    flush: () => runner.flush(),
    cancel: () => runner.cancel(),
    dispose: () => runner.dispose(),
  };
}

/** Q01 helper: develop settings + identity predicate for shader double-application. */
export interface RawDevelopInfo {
  settings: RawDevelopSettings;
  report: RawDevelopReport;
  identity: boolean;
  width: number;
  height: number;
}
export function getRawDevelopInfo(source: DecodedSource): RawDevelopInfo | null {
  const entry = rawAssets.get(source);
  if (!entry) return null;
  return {
    settings: entry.settings,
    report: entry.report,
    identity: rawDevelopIsIdentity(entry.settings, entry.report.asShotTemperatureK),
    width: entry.width,
    height: entry.height,
  };
}

export function hasRawAsset(source: DecodedSource): boolean {
  return rawAssets.has(source);
}

