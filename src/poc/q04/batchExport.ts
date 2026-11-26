import { decodeImageFile, type DecodedImage } from '../../engine/image/decoder';
import { prepareExportImage } from '../../engine/export/imageExporter';
import { loadCubeLut, type ParsedLut3D } from '../../engine/color/lutLoader';
import { FILM_PROFILES } from '../../films/registry';
import type { ExportOptions, PreparedExport } from '../../types/export';
import type { WorkspaceEntry } from '../../engine/image/workspace';
import type { EditState } from './types';
import type { BatchJobView, JobContext } from './batchQueue';

export interface ExportJobMeta {
  entry: WorkspaceEntry;
  edit: EditState;
}

export interface ExportDeps {
  decode: typeof decodeImageFile;
  prepare: typeof prepareExportImage;
  loadLut: (path: string) => Promise<ParsedLut3D>;
}

export const defaultExportDeps: ExportDeps = {
  decode: decodeImageFile,
  prepare: prepareExportImage,
  loadLut: loadCubeLut,
};

export interface ExportProcessorOptions {
  exportOptions: ExportOptions;
  /** Injectable for tests; production uses the shared export pipeline. */
  deps?: Partial<ExportDeps>;
}

export type ExportProcessor = (input: { id: string; meta: ExportJobMeta }, ctx: JobContext) => Promise<PreparedExport>;

export interface ExportProcessorHandle {
  processor: ExportProcessor;
  lutCacheSize: () => number;
  clearLutCache: () => void;
}

/**
 * Abort contract: the adapter checks the signal before every pipeline stage and
 * after every await. Decoding is abortable (decodeImageFile accepts the signal);
 * the GPU render/encode call is not, so a cancel that arrives while
 * prepareExportImage is running is honoured once it resolves and the rendered
 * blob is disposed. Making the renderer itself abortable is a Q01 interface
 * requirement (see docs/phase1/CP1_1_INTERFACE_REQUIREMENTS.md).
 */
function abortError(stage: string): DOMException {
  return new DOMException(`Export cancelled during ${stage}`, 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined, stage: string): void {
  if (signal?.aborted) throw abortError(stage);
}

const disposed = new WeakSet<PreparedExport>();

/** Revokes a prepared object URL exactly once. Safe to call from finally blocks. */
export function disposePrepared(prepared: PreparedExport | null | undefined): void {
  if (!prepared?.objectUrl || disposed.has(prepared)) return;
  disposed.add(prepared);
  URL.revokeObjectURL(prepared.objectUrl);
}

export type ExportDelivery = (prepared: PreparedExport, job: { id: string; filename: string }) => Promise<void> | void;

/**
 * Consumer delivery step for BatchQueue: hands the result to a save/share sink
 * and always releases its object URL. A sink failure propagates, so the queue
 * reports renderSucceeded=true with a delivery error instead of silently
 * treating a lost save as done.
 */
export function createDeliverySink(save: ExportDelivery) {
  return async (job: BatchJobView<ExportJobMeta>, prepared: PreparedExport): Promise<void> => {
    try {
      await save(prepared, { id: job.id, filename: prepared.filename });
    } finally {
      disposePrepared(prepared);
    }
  };
}

/**
 * Batch adapter over the existing single-image pipeline. It calls the same
 * prepareExportImage used by ExportModal, so preview/export color math cannot
 * diverge. The adapter owns per-job decoded-image cleanup and a per-film LUT
 * cache; results are handed to the queue's delivery/drain sink and never
 * retained here.
 */
export function createExportProcessor(options: ExportProcessorOptions): ExportProcessorHandle {
  const deps: ExportDeps = { ...defaultExportDeps, ...options.deps };
  const lutCache = new Map<string, Promise<ParsedLut3D>>();

  const getLut = (path: string): Promise<ParsedLut3D> => {
    let pending = lutCache.get(path);
    if (!pending) {
      pending = deps.loadLut(path).catch((error) => {
        lutCache.delete(path);
        throw error;
      });
      lutCache.set(path, pending);
    }
    return pending;
  };

  const processor: ExportProcessor = async ({ meta }, ctx) => {
    const { entry, edit } = meta;
    let image: DecodedImage | null = null;
    let prepared: PreparedExport | null = null;
    try {
      throwIfAborted(ctx.signal, 'reading file');
      ctx.report(0.02, 'reading file');
      const file = await entry.getFile();
      throwIfAborted(ctx.signal, 'reading file');

      ctx.report(0.15, 'decoding image');
      image = await deps.decode(file, entry.name, ctx.signal);
      throwIfAborted(ctx.signal, 'decoding image');

      ctx.report(0.25, 'loading film LUT');
      const profile = FILM_PROFILES[edit.activeFilmId] ?? FILM_PROFILES['FS-001'];
      const lut = await getLut(profile.lutFile);
      throwIfAborted(ctx.signal, 'loading film LUT');

      prepared = await deps.prepare(
        image,
        lut,
        edit.adjustments,
        options.exportOptions,
        (progress, stage) => {
          const fraction = Math.min(100, Math.max(0, progress)) / 100;
          ctx.report(0.3 + fraction * 0.68, stage);
        },
        edit.camera,
        edit.activeFilmId,
        edit.curves,
        edit.colorMixer,
        edit.sharpening,
      );

      throwIfAborted(ctx.signal, 'encoding');
      ctx.report(1, 'done');
      return prepared;
    } catch (error) {
      // The queue will not hand a cancelled result to consumers, so released
      // here; disposePrepared is idempotent.
      if (error instanceof DOMException && error.name === 'AbortError') disposePrepared(prepared);
      throw error;
    } finally {
      // The decoded source URL and GPU surface are released here so
      // concurrency limits bound peak memory.
      if (image?.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(image.sourceUrl);
    }
  };

  return {
    processor,
    lutCacheSize: () => lutCache.size,
    clearLutCache: () => lutCache.clear(),
  };
}
