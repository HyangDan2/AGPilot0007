import { decodeImageFile, type DecodedImage } from '../../engine/image/decoder';
import { prepareExportImage } from '../../engine/export/imageExporter';
import { loadCubeLut, type ParsedLut3D } from '../../engine/color/lutLoader';
import { FILM_PROFILES } from '../../films/registry';
import type { ExportOptions, PreparedExport } from '../../types/export';
import type { WorkspaceEntry } from '../../engine/image/workspace';
import type { EditState } from './types';
import type { JobContext } from './batchQueue';

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

function abortError(): DOMException {
  return new DOMException('Export cancelled', 'AbortError');
}

/**
 * Batch adapter over the existing single-image pipeline. It calls the same
 * prepareExportImage used by ExportModal, so preview/export color math cannot
 * diverge. The adapter owns per-job decoded-image cleanup and a per-film LUT
 * cache; results are handed to the queue's onSettled sink and never retained.
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
      ctx.report(0.02, 'reading file');
      const file = await entry.getFile();
      if (ctx.signal.aborted) throw abortError();

      ctx.report(0.15, 'decoding image');
      image = await deps.decode(file, entry.name, ctx.signal);
      if (ctx.signal.aborted) throw abortError();

      ctx.report(0.25, 'loading film LUT');
      const profile = FILM_PROFILES[edit.activeFilmId] ?? FILM_PROFILES['FS-001'];
      const lut = await getLut(profile.lutFile);
      if (ctx.signal.aborted) throw abortError();

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

      if (ctx.signal.aborted) {
        URL.revokeObjectURL(prepared.objectUrl);
        prepared = null;
        throw abortError();
      }
      ctx.report(1, 'done');
      return prepared;
    } finally {
      // The queue delivers the blob; the decoded source URL and GPU surface are
      // released here so concurrency limits bound peak memory.
      if (image?.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(image.sourceUrl);
    }
  };

  return {
    processor,
    lutCacheSize: () => lutCache.size,
    clearLutCache: () => lutCache.clear(),
  };
}
