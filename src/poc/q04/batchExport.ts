import { type DecodedImage } from '../../engine/image/decoder';
import { decodeEditorImage, type EditorImageLoad } from '../../stores/editorStore';
import { prepareExportImage } from '../../engine/export/imageExporter';
import type { ExportControl } from '../../engine/contracts/exportControl';
import { withRawDevelopGuard, type RenderSettings } from '../../engine/pipeline/renderSettings';
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

export type ExportDecoder = (file: File | Blob, name: string, signal?: AbortSignal) => Promise<DecodedImage | EditorImageLoad>;

export interface ExportDeps {
  decode: ExportDecoder;
  prepare: typeof prepareExportImage;
  loadLut: (path: string) => Promise<ParsedLut3D>;
}

/** RAW-aware: opens the half-size develop and keeps its full-resolution resolver. */
const decodeForExport: ExportDecoder = (file, _name, signal) => decodeEditorImage(file, signal);

export const defaultExportDeps: ExportDeps = {
  decode: decodeForExport,
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
 * after every await. Decoding is abortable (the RAW-aware decoder accepts the
 * signal); the export pipeline receives the same signal through Q01's
 * ExportControl (IF-01), so render/encode stage boundaries are aborted inside
 * prepareExportImage. If a cancel still races the call, the rendered blob is
 * disposed once it resolves.
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
 * Batch runs must not overwrite each other when two folders hold the same
 * file name; later jobs get a stable numeric suffix before the extension.
 */
export function uniqueFilename(filename: string, used: Set<string>): string {
  let candidate = filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let index = 2; used.has(candidate); index++) candidate = `${base}-${index}${extension}`;
  used.add(candidate);
  return candidate;
}

/**
 * Clones a prepared export under a new name so `filename` and `file.name` always
 * agree for the save/share sink. The blob and object URL are shared, not
 * copied; the original prepared object is left untouched.
 */
export function renamePrepared(prepared: PreparedExport, filename: string): PreparedExport {
  if (prepared.filename === filename && prepared.file.name === filename) return prepared;
  return {
    ...prepared,
    filename,
    file: new File([prepared.file], filename, { type: prepared.file.type, lastModified: prepared.file.lastModified }),
  };
}

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
      const decoded = await deps.decode(file, entry.name, ctx.signal);
      const rawSource = 'image' in decoded ? decoded.rawSource : null;
      image = 'image' in decoded ? decoded.image : decoded;
      throwIfAborted(ctx.signal, 'decoding image');

      // The full-res original comes from the RAW resolver inside
      // prepareExportImage; the develop already baked WB/exposure, so mirror
      // ExportModal and keep those shader controls neutral.
      let settings: RenderSettings = {
        filmId: edit.activeFilmId,
        adjustments: edit.adjustments,
        curves: edit.curves,
        camera: edit.camera,
        colorMixer: edit.colorMixer,
        sharpening: edit.sharpening,
        geometry: edit.geometry,
        optical: edit.optical ?? undefined,
        localAdjustments: edit.localAdjustments,
      };
      if (rawSource) {
        const { getRawDevelopInfo } = await import('../../engine/raw');
        settings = withRawDevelopGuard(settings, getRawDevelopInfo(rawSource));
      }

      ctx.report(0.25, 'loading film LUT');
      const profile = FILM_PROFILES[edit.activeFilmId] ?? FILM_PROFILES['FS-001'];
      const lut = await getLut(profile.lutFile);
      throwIfAborted(ctx.signal, 'loading film LUT');

      let fraction = 0;
      const control: ExportControl = {
        signal: ctx.signal,
        onStage: (stage) => ctx.report(0.3 + fraction * 0.68, stage),
      };
      prepared = await deps.prepare(
        image,
        lut,
        settings,
        options.exportOptions,
        (progress, stage) => {
          fraction = Math.min(100, Math.max(0, progress)) / 100;
          ctx.report(0.3 + fraction * 0.68, stage);
        },
        control,
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
