import { triggerSafeDownload } from '../../../engine/export/imageExporter';
import type { WorkspaceEntry } from '../../../engine/image/workspace';
import type { ExportOptions, PreparedExport } from '../../../types/export';
import { BatchQueue, type BatchSnapshot } from '../batchQueue';
import {
  createDeliverySink,
  createExportProcessor,
  renamePrepared,
  uniqueFilename,
  type ExportDelivery,
  type ExportJobMeta,
  type ExportProcessorHandle,
} from '../batchExport';
import { recommendedConcurrency } from '../resources';
import type { EditState } from '../types';

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  rendered: number;
  deliveryFailed: number;
  /** selected = saved + failed + cancelled; a false here is a UI/queue bug. */
  reconciled: boolean;
}

export interface BatchExportView {
  snapshot: BatchSnapshot<ExportJobMeta> | null;
  summary: BatchSummary | null;
  running: boolean;
}

export interface BatchExportControllerOptions {
  concurrency?: number;
  exportOptions?: ExportOptions;
  /** Injectable for tests; production uses the shared batch adapter. */
  processor?: ExportProcessorHandle;
  /** Consumer save step; defaults to a browser download. */
  delivery?: ExportDelivery;
}

export const DEFAULT_BATCH_EXPORT_OPTIONS: ExportOptions = { format: 'image/jpeg', quality: 0.92, scale: 1 };

function summarize(snapshot: BatchSnapshot<ExportJobMeta>): BatchSummary {
  const { counts } = snapshot;
  return {
    total: counts.total,
    succeeded: counts.succeeded,
    failed: counts.failed,
    cancelled: counts.cancelled,
    rendered: counts.rendered,
    deliveryFailed: counts.deliveryFailed,
    reconciled: counts.total === counts.succeeded + counts.failed + counts.cancelled,
  };
}

/**
 * Product-facing controller around the CP1 BatchQueue. The caller passes the
 * workspace selection into start(); the controller never owns selection so the
 * strip and this surface read one source of truth. Edit states arrive through
 * an injected resolver, and delivery releases prepared object URLs via
 * createDeliverySink. Jobs keep their ids so retry/retryFailed address the same
 * queue entries.
 */
export class BatchExportController {
  private entries: WorkspaceEntry[] = [];
  private queue: BatchQueue<ExportJobMeta, PreparedExport> | null = null;
  private unsubscribeQueue: (() => void) | null = null;
  private snapshot: BatchSnapshot<ExportJobMeta> | null = null;
  private summary: BatchSummary | null = null;
  private queueRunning = false;
  private readonly listeners = new Set<(view: BatchExportView) => void>();

  constructor(private readonly options: BatchExportControllerOptions = {}) {}

  private getView(): BatchExportView {
    return { snapshot: this.snapshot, summary: this.summary, running: this.queueRunning };
  }

  subscribe(listener: (view: BatchExportView) => void): () => void {
    this.listeners.add(listener);
    listener(this.getView());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const view = this.getView();
    for (const listener of this.listeners) listener(view);
  }

  /** Job metadata is resolved from the live workspace entries passed here. */
  setEntries(entries: WorkspaceEntry[]): void {
    this.entries = entries;
  }

  /** Starts a run over the given photo ids; resolves false while another run is active or no id exists. */
  start(ids: readonly string[], editFor: (id: string) => EditState): boolean {
    if (this.queueRunning) return false;
    const wanted = new Set(ids);
    const entries = this.entries.filter((entry) => wanted.has(entry.id));
    if (!entries.length) return false;

    this.disposeQueue();
    const handle = this.options.processor ?? createExportProcessor({ exportOptions: this.options.exportOptions ?? DEFAULT_BATCH_EXPORT_OPTIONS });
    const save =
      this.options.delivery ??
      ((prepared: PreparedExport) => {
        triggerSafeDownload(prepared.blob, prepared.filename);
      });
    const usedNames = new Set<string>();
    const delivery: ExportDelivery = (prepared, job) => {
      const target = renamePrepared(prepared, uniqueFilename(prepared.filename, usedNames));
      return save(target, { id: job.id, filename: target.filename });
    };
    const queue = new BatchQueue<ExportJobMeta, PreparedExport>({
      concurrency: this.options.concurrency ?? recommendedConcurrency(),
      processor: handle.processor,
      deliver: createDeliverySink(delivery),
    });
    this.queue = queue;
    this.unsubscribeQueue = queue.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.emit();
    });
    this.summary = null;
    this.queueRunning = true;
    queue.add(entries.map((entry) => ({ id: entry.id, meta: { entry, edit: editFor(entry.id) } })));
    this.trackDrain();
    this.emit();
    return true;
  }

  private trackDrain(): void {
    const queue = this.queue;
    if (!queue) return;
    void queue.drain().then((snapshot) => {
      if (this.queue !== queue) return;
      this.snapshot = snapshot;
      this.summary = summarize(snapshot);
      this.queueRunning = false;
      this.emit();
    });
  }

  cancel(id: string): void {
    this.queue?.cancel(id);
  }

  cancelAll(): void {
    this.queue?.cancelAll();
  }

  retry(id: string): void {
    if (!this.queue?.retry(id)) return;
    this.queueRunning = true;
    this.trackDrain();
    this.emit();
  }

  retryFailed(): number {
    const retried = this.queue?.retryFailed() ?? 0;
    if (retried) {
      this.queueRunning = true;
      this.trackDrain();
      this.emit();
    }
    return retried;
  }

  private disposeQueue(): void {
    this.unsubscribeQueue?.();
    this.unsubscribeQueue = null;
    this.queue?.destroy();
    this.queue = null;
  }

  destroy(): void {
    this.disposeQueue();
    this.listeners.clear();
  }
}
