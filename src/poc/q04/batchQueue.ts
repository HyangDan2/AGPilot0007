export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobContext {
  id: string;
  signal: AbortSignal;
  /** 0..1 within this job; ignored after the job settles. */
  report(progress: number, note?: string): void;
}

export interface BatchJobInput<Meta> {
  id: string;
  meta: Meta;
}

export interface BatchJobView<Meta> {
  id: string;
  meta: Meta;
  status: JobStatus;
  attempts: number;
  progress: number;
  note: string;
  error: string;
  cancelRequested: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  /** Processor produced a result, even if delivering it later failed. */
  renderSucceeded: boolean;
  /** Set when the consumer delivery step failed; job status is failed. */
  deliveryError: string;
}

export interface BatchCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** Jobs whose render step succeeded (includes delivery failures). */
  rendered: number;
  /** Jobs that rendered but failed to save/share. */
  deliveryFailed: number;
}

export interface BatchSnapshot<Meta> {
  jobs: BatchJobView<Meta>[];
  counts: BatchCounts;
  /** Settled jobs count as 1, running jobs contribute their reported progress. */
  overallProgress: number;
  concurrency: number;
}

export type SettleOutcome<Result> =
  | { status: 'succeeded'; result: Result }
  | { status: 'failed' | 'cancelled'; error: string; renderSucceeded?: boolean };

export interface BatchQueueOptions<Meta, Result> {
  processor: (input: BatchJobInput<Meta>, ctx: JobContext) => Promise<Result>;
  /**
   * Consumer delivery step (save/share). Runs after a successful render. A
   * throw marks the job failed with deliveryError while renderSucceeded stays
   * true, so callers can distinguish a render failure from a save failure.
   */
  deliver?: (job: BatchJobView<Meta>, result: Result) => Promise<void> | void;
  concurrency?: number;
  /** Attempts allowed per job; retry() refuses past this limit. Default 3, max 10. */
  retryLimit?: number;
  /**
   * Result sink. The queue never retains results, so consumers own blobs and
   * must revoke object URLs after use.
   */
  onSettled?: (job: BatchJobView<Meta>, outcome: SettleOutcome<Result>) => void;
}

/** Queue-wide safety caps; device-specific limits live in resources.ts. */
export const MAX_CONCURRENCY = 8;
export const MAX_RETRY_LIMIT = 10;

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

interface InternalJob<Meta> extends BatchJobView<Meta> {
  controller: AbortController | null;
}

type Listener<Meta> = (snapshot: BatchSnapshot<Meta>) => void;

export class BatchQueue<Meta, Result> {
  private readonly jobs = new Map<string, InternalJob<Meta>>();
  private readonly pending: string[] = [];
  private readonly listeners = new Set<Listener<Meta>>();
  private readonly drainWaiters: Array<(snapshot: BatchSnapshot<Meta>) => void> = [];
  private readonly processor: BatchQueueOptions<Meta, Result>['processor'];
  private readonly deliver: BatchQueueOptions<Meta, Result>['deliver'];
  private readonly retryLimitValue: number;
  private readonly onSettled: BatchQueueOptions<Meta, Result>['onSettled'];
  private concurrencyValue: number;
  private running = 0;
  /** Queued + running jobs; keeps drain/idle checks O(1). */
  private outstanding = 0;
  private destroyed = false;

  constructor(options: BatchQueueOptions<Meta, Result>) {
    this.processor = options.processor;
    this.deliver = options.deliver;
    this.retryLimitValue = normalizeInteger(options.retryLimit, 3, 1, MAX_RETRY_LIMIT);
    this.onSettled = options.onSettled;
    this.concurrencyValue = normalizeInteger(options.concurrency, 2, 1, MAX_CONCURRENCY);
  }

  get concurrency(): number {
    return this.concurrencyValue;
  }

  get retryLimit(): number {
    return this.retryLimitValue;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  add(inputs: readonly BatchJobInput<Meta>[]): void {
    if (this.destroyed) throw new Error('BatchQueue is destroyed');
    let added = 0;
    for (const input of inputs) {
      if (this.jobs.has(input.id)) continue;
      this.jobs.set(input.id, {
        id: input.id,
        meta: input.meta,
        status: 'queued',
        attempts: 0,
        progress: 0,
        note: '',
        error: '',
        cancelRequested: false,
        startedAt: null,
        finishedAt: null,
        renderSucceeded: false,
        deliveryError: '',
        controller: null,
      });
      this.pending.push(input.id);
      this.outstanding++;
      added++;
    }
    if (added) {
      this.emit();
      this.pump();
    }
  }

  /** Device profile changes (tab focus, memory pressure) can adjust the limit live. */
  setConcurrency(value: unknown): void {
    const next = normalizeInteger(value, this.concurrencyValue, 1, MAX_CONCURRENCY);
    if (next === this.concurrencyValue) return;
    this.concurrencyValue = next;
    this.emit();
    this.pump();
  }

  retry(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || this.destroyed) return false;
    if (job.status !== 'failed' && job.status !== 'cancelled') return false;
    if (job.attempts >= this.retryLimitValue) return false;
    job.status = 'queued';
    job.progress = 0;
    job.note = '';
    job.error = '';
    job.cancelRequested = false;
    job.startedAt = null;
    job.finishedAt = null;
    job.renderSucceeded = false;
    job.deliveryError = '';
    this.pending.push(id);
    this.outstanding++;
    this.emit();
    this.pump();
    return true;
  }

  /** Partial-failure recovery: only failed/cancelled jobs run again. */
  retryFailed(): number {
    let retried = 0;
    for (const job of this.jobs.values()) {
      if ((job.status === 'failed' || job.status === 'cancelled') && this.retry(job.id)) retried++;
    }
    return retried;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.error = 'cancelled';
      job.finishedAt = Date.now();
      this.outstanding--;
      this.emit();
      this.checkDrain();
      return true;
    }
    if (job.status === 'running' && !job.cancelRequested) {
      job.cancelRequested = true;
      job.controller?.abort();
      this.emit();
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const id of [...this.jobs.keys()]) this.cancel(id);
  }

  get(id: string): BatchJobView<Meta> | undefined {
    const job = this.jobs.get(id);
    return job ? this.view(job) : undefined;
  }

  getSnapshot(): BatchSnapshot<Meta> {
    const jobs = [...this.jobs.values()].map((job) => this.view(job));
    const counts: BatchCounts = {
      total: jobs.length,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      rendered: 0,
      deliveryFailed: 0,
    };
    let weighted = 0;
    for (const job of jobs) {
      counts[job.status]++;
      if (job.renderSucceeded) counts.rendered++;
      if (job.deliveryError) counts.deliveryFailed++;
      weighted += job.status === 'running' ? job.progress : job.status === 'queued' ? 0 : 1;
    }
    return { jobs, counts, overallProgress: counts.total ? weighted / counts.total : 0, concurrency: this.concurrencyValue };
  }

  subscribe(listener: Listener<Meta>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves after every queued/running job settles; failures do not reject. */
  drain(): Promise<BatchSnapshot<Meta>> {
    if (this.isIdle()) return Promise.resolve(this.getSnapshot());
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  /** Aborts running jobs, cancels queued jobs and drops listeners. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelAll();
    this.listeners.clear();
    this.checkDrain();
  }

  private isIdle(): boolean {
    return this.outstanding === 0;
  }

  private nextQueuedId(): string | null {
    while (this.pending.length) {
      const id = this.pending.shift()!;
      if (this.jobs.get(id)?.status === 'queued') return id;
    }
    return null;
  }

  private pump(): void {
    if (!this.destroyed) {
      while (this.running < this.concurrencyValue) {
        const id = this.nextQueuedId();
        if (!id) break;
        void this.run(id);
      }
    }
    this.checkDrain();
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.get(id)!;
    const controller = new AbortController();
    job.status = 'running';
    job.attempts++;
    job.progress = 0;
    job.note = '';
    job.error = '';
    job.cancelRequested = false;
    job.startedAt = Date.now();
    job.finishedAt = null;
    job.renderSucceeded = false;
    job.deliveryError = '';
    job.controller = controller;
    this.running++;
    this.emit();

    const ctx: JobContext = {
      id,
      signal: controller.signal,
      report: (progress, note) => {
        if (job.status !== 'running') return;
        if (Number.isFinite(progress)) job.progress = Math.min(1, Math.max(0, progress));
        if (note !== undefined) job.note = note;
        this.emit();
      },
    };

    let outcome: SettleOutcome<Result> = { status: 'cancelled', error: 'cancelled' };
    try {
      const result = await this.processor({ id, meta: job.meta }, ctx);
      const aborted = controller.signal.aborted || this.destroyed;
      if (!aborted) {
        job.renderSucceeded = true;
        job.progress = 0.98;
        this.emit();
      }
      if (!aborted && this.deliver) {
        try {
          await this.deliver(this.view(job), result);
        } catch (error) {
          job.status = 'failed';
          job.error = `delivery failed: ${error instanceof Error ? error.message : String(error)}`;
          job.deliveryError = job.error;
          job.progress = 1;
          outcome = { status: 'failed', error: job.error, renderSucceeded: true };
        }
      }
      if (outcome.status !== 'failed') {
        const cancelled = controller.signal.aborted || this.destroyed;
        if (cancelled) {
          job.status = 'cancelled';
          job.error = 'cancelled';
          outcome = { status: 'cancelled', error: 'cancelled', renderSucceeded: job.renderSucceeded };
        } else {
          job.status = 'succeeded';
          job.progress = 1;
          outcome = { status: 'succeeded', result };
        }
      }
    } catch (error) {
      const aborted = controller.signal.aborted || this.destroyed;
      const message = aborted ? 'cancelled' : error instanceof Error ? error.message : String(error);
      job.status = aborted ? 'cancelled' : 'failed';
      job.error = message;
      outcome = aborted
        ? { status: 'cancelled', error: message, renderSucceeded: job.renderSucceeded }
        : { status: 'failed', error: message, renderSucceeded: job.renderSucceeded };
    } finally {
      job.controller = null;
      job.finishedAt = Date.now();
      this.running--;
      this.outstanding--;
      try {
        this.onSettled?.(this.view(job), outcome);
      } catch {
        // A consumer bug must not stall the queue.
      }
      this.emit();
      this.pump();
    }
  }

  private checkDrain(): void {
    if (!this.isIdle()) return;
    if (this.drainWaiters.length) {
      const snapshot = this.getSnapshot();
      for (const resolve of this.drainWaiters.splice(0)) resolve(snapshot);
    }
  }

  private emit(): void {
    if (!this.listeners.size) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Ignore listener errors; queue state stays authoritative.
      }
    }
  }

  private view(job: InternalJob<Meta>): BatchJobView<Meta> {
    return {
      id: job.id,
      meta: job.meta,
      status: job.status,
      attempts: job.attempts,
      progress: job.progress,
      note: job.note,
      error: job.error,
      cancelRequested: job.cancelRequested,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      renderSucceeded: job.renderSucceeded,
      deliveryError: job.deliveryError,
    };
  }
}
