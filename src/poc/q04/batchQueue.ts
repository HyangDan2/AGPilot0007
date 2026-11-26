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
}

export interface BatchCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
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
  | { status: 'failed' | 'cancelled'; error: string };

export interface BatchQueueOptions<Meta, Result> {
  processor: (input: BatchJobInput<Meta>, ctx: JobContext) => Promise<Result>;
  concurrency?: number;
  /** Attempts allowed per job; retry() refuses past this limit. Default 3. */
  retryLimit?: number;
  /**
   * Result sink. The queue never retains results, so consumers own blobs and
   * must revoke object URLs after use.
   */
  onSettled?: (job: BatchJobView<Meta>, outcome: SettleOutcome<Result>) => void;
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
  private readonly retryLimit: number;
  private readonly onSettled: BatchQueueOptions<Meta, Result>['onSettled'];
  private concurrencyValue: number;
  private running = 0;
  /** Queued + running jobs; keeps drain/idle checks O(1). */
  private outstanding = 0;
  private destroyed = false;

  constructor(options: BatchQueueOptions<Meta, Result>) {
    this.processor = options.processor;
    this.retryLimit = Math.max(1, Math.floor(options.retryLimit ?? 3));
    this.onSettled = options.onSettled;
    this.concurrencyValue = Math.max(1, Math.floor(options.concurrency ?? 2));
  }

  get concurrency(): number {
    return this.concurrencyValue;
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
  setConcurrency(value: number): void {
    const next = Math.max(1, Math.floor(value));
    if (next === this.concurrencyValue) return;
    this.concurrencyValue = next;
    this.emit();
    this.pump();
  }

  retry(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || this.destroyed) return false;
    if (job.status !== 'failed' && job.status !== 'cancelled') return false;
    if (job.attempts >= this.retryLimit) return false;
    job.status = 'queued';
    job.progress = 0;
    job.note = '';
    job.error = '';
    job.cancelRequested = false;
    job.startedAt = null;
    job.finishedAt = null;
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
    const counts: BatchCounts = { total: jobs.length, queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
    let weighted = 0;
    for (const job of jobs) {
      counts[job.status]++;
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
      if (controller.signal.aborted || this.destroyed) {
        job.status = 'cancelled';
        job.error = 'cancelled';
        outcome = { status: 'cancelled', error: 'cancelled' };
      } else {
        job.status = 'succeeded';
        job.progress = 1;
        outcome = { status: 'succeeded', result };
      }
    } catch (error) {
      const aborted = controller.signal.aborted || this.destroyed;
      const message = aborted ? 'cancelled' : error instanceof Error ? error.message : String(error);
      job.status = aborted ? 'cancelled' : 'failed';
      job.error = message;
      outcome = aborted ? { status: 'cancelled', error: message } : { status: 'failed', error: message };
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
    };
  }
}
