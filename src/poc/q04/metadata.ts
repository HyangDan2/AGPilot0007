import { parseCaptureDate } from '../../engine/image/captureDate';
import type { WorkspaceEntry } from '../../engine/image/workspace';

export interface ImageMetadata {
  id: string;
  name: string;
  path: string;
  captureDate?: string;
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
  width?: number;
  height?: number;
  /** File size/lastModified at index time; a change triggers re-indexing. */
  fileSize?: number;
  fileModified?: number;
  indexedAt: number;
  error?: string;
}

export type ParsedMetadata = Omit<ImageMetadata, 'id' | 'name' | 'path' | 'indexedAt'>;
export type MetadataParser = (file: File, signal?: AbortSignal) => Promise<ParsedMetadata>;

export interface MetadataQuery {
  text?: string;
  dateFrom?: string;
  dateTo?: string;
  isoMin?: number;
  isoMax?: number;
  models?: string[];
  lens?: string[];
  sort?: 'name' | 'date-asc' | 'date-desc' | 'iso-asc' | 'iso-desc';
  limit?: number;
}

export interface IndexProgress {
  indexed: number;
  failed: number;
  total: number;
  active: number;
}

export interface IndexOptions {
  signal?: AbortSignal;
  concurrency?: number;
  force?: boolean;
  /** Re-attempt entries whose previous parse failed. Default false. */
  retryFailed?: boolean;
  onProgress?: (progress: IndexProgress) => void;
}

export interface IndexReport {
  indexed: number;
  skipped: number;
  failed: number;
  total: number;
  aborted: boolean;
}

const EXIF_FIELDS = [
  'DateTimeOriginal',
  'Make',
  'Model',
  'LensModel',
  'ISO',
  'FNumber',
  'ExposureTime',
  'FocalLength',
  'ExifImageWidth',
  'ExifImageHeight',
  'ImageWidth',
  'ImageHeight',
] as const;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined;

const number = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Header-only EXIF parse; never decodes pixels or holds an ImageBitmap. */
export const parseExifMetadata: MetadataParser = async (file, signal) => {
  if (signal?.aborted) throw new DOMException('Indexing cancelled', 'AbortError');
  const { parse } = await import('exifr');
  const data = await parse(file, { pick: [...EXIF_FIELDS], reviveValues: false });
  if (!data) return {};
  return {
    captureDate: parseCaptureDate(data.DateTimeOriginal),
    cameraMake: text(data.Make),
    cameraModel: text(data.Model),
    lens: text(data.LensModel),
    iso: number(data.ISO),
    fNumber: number(data.FNumber),
    exposureTime: number(data.ExposureTime),
    focalLength: number(data.FocalLength),
    width: number(data.ExifImageWidth) ?? number(data.ImageWidth),
    height: number(data.ExifImageHeight) ?? number(data.ImageHeight),
  };
};

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a: ImageMetadata, b: ImageMetadata): number =>
  nameCollator.compare(a.name, b.name) || nameCollator.compare(a.path, b.path);

const haystackCache = new WeakMap<ImageMetadata, string>();
function haystackFor(record: ImageMetadata): string {
  let cached = haystackCache.get(record);
  if (cached === undefined) {
    cached = [record.name, record.path, record.cameraMake, record.cameraModel, record.lens, record.captureDate]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    haystackCache.set(record, cached);
  }
  return cached;
}

function compareOptionalNumber(a: number | undefined, b: number | undefined, direction: 1 | -1): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return (a - b) * direction;
}

function compareOptionalDate(a: string | undefined, b: string | undefined, direction: 1 | -1): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return (a < b ? -1 : a > b ? 1 : 0) * direction;
}

export function searchMetadata(records: readonly ImageMetadata[], query: MetadataQuery = {}): ImageMetadata[] {
  const needle = query.text?.trim().toLowerCase();
  const models = query.models?.map((model) => model.toLowerCase()).filter(Boolean);
  const lenses = query.lens?.map((lens) => lens.toLowerCase()).filter(Boolean);
  const filtered = records.filter((record) => {
    if (needle && !haystackFor(record).includes(needle)) return false;
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      if (!record.captureDate) return false;
      if (query.dateFrom !== undefined && record.captureDate < query.dateFrom) return false;
      if (query.dateTo !== undefined && record.captureDate > query.dateTo) return false;
    }
    if (query.isoMin !== undefined || query.isoMax !== undefined) {
      if (typeof record.iso !== 'number') return false;
      if (query.isoMin !== undefined && record.iso < query.isoMin) return false;
      if (query.isoMax !== undefined && record.iso > query.isoMax) return false;
    }
    if (models?.length) {
      const model = record.cameraModel?.toLowerCase() ?? '';
      if (!models.some((candidate) => model.includes(candidate))) return false;
    }
    if (lenses?.length) {
      const lens = record.lens?.toLowerCase() ?? '';
      if (!lenses.some((candidate) => lens.includes(candidate))) return false;
    }
    return true;
  });

  const sort = query.sort ?? 'name';
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'date-asc':
        return compareOptionalDate(a.captureDate, b.captureDate, 1) || byName(a, b);
      case 'date-desc':
        return compareOptionalDate(a.captureDate, b.captureDate, -1) || byName(a, b);
      case 'iso-asc':
        return compareOptionalNumber(a.iso, b.iso, 1) || byName(a, b);
      case 'iso-desc':
        return compareOptionalNumber(a.iso, b.iso, -1) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
  if (typeof query.limit === 'number') return sorted.slice(0, Math.max(0, Math.floor(query.limit)));
  return sorted;
}

/**
 * In-memory EXIF index for CP1. Incremental, abortable and deduplicated by
 * workspace entry id; persistence is intentionally left to a later checkpoint.
 */
export class MetadataIndex {
  private records = new Map<string, ImageMetadata>();

  constructor(private readonly parser: MetadataParser = parseExifMetadata) {}

  get size(): number {
    return this.records.size;
  }

  get(id: string): ImageMetadata | undefined {
    return this.records.get(id);
  }

  all(): ImageMetadata[] {
    return [...this.records.values()];
  }

  clear(): void {
    this.records.clear();
  }

  async index(entries: readonly WorkspaceEntry[], options: IndexOptions = {}): Promise<IndexReport> {
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
    // Healthy entries stay in the queue so the worker can compare the file
    // signature; failed entries only re-enter when retryFailed is set.
    const queue = options.force
      ? [...entries]
      : entries.filter((entry) => {
          const existing = this.records.get(entry.id);
          return !existing || !existing.error || options.retryFailed === true;
        });
    let cursor = 0;
    let indexed = 0;
    let skipped = entries.length - queue.length;
    let failed = 0;
    let active = 0;
    let aborted = false;
    const report = () => options.onProgress?.({ indexed, failed, total: entries.length, active });

    const worker = async () => {
      for (;;) {
        if (options.signal?.aborted) {
          aborted = true;
          return;
        }
        const position = cursor++;
        if (position >= queue.length) return;
        const entry = queue[position];
        active++;
        report();
        let file: File | null = null;
        try {
          file = await entry.getFile();
          if (options.signal?.aborted) {
            aborted = true;
            return;
          }
          const existing = this.records.get(entry.id);
          const unchanged =
            existing &&
            !existing.error &&
            existing.fileSize === file.size &&
            existing.fileModified === file.lastModified;
          if (unchanged && !options.force) {
            skipped++;
            continue;
          }
          const parsed = await this.parser(file, options.signal);
          if (options.signal?.aborted) {
            aborted = true;
            return;
          }
          this.records.set(entry.id, {
            id: entry.id,
            name: entry.name,
            path: entry.path,
            indexedAt: Date.now(),
            fileSize: file.size,
            fileModified: file.lastModified,
            ...parsed,
          });
          indexed++;
        } catch (error) {
          if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            aborted = true;
            return;
          }
          failed++;
          this.records.set(entry.id, {
            id: entry.id,
            name: entry.name,
            path: entry.path,
            indexedAt: Date.now(),
            fileSize: file?.size,
            fileModified: file?.lastModified,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          active--;
          report();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    return { indexed, skipped, failed, total: entries.length, aborted };
  }

  /** Convenience wrapper for partial-failure recovery. */
  retryFailed(entries: readonly WorkspaceEntry[], options: Omit<IndexOptions, 'retryFailed'> = {}): Promise<IndexReport> {
    return this.index(entries, { ...options, retryFailed: true });
  }

  search(query: MetadataQuery = {}): ImageMetadata[] {
    return searchMetadata(this.all(), query);
  }
}
