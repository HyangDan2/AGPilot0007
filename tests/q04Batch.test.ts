import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchQueue, MAX_CONCURRENCY } from '../src/poc/q04/batchQueue';
import { recommendedConcurrency } from '../src/poc/q04/resources';
import { createDeliverySink, createExportProcessor, disposePrepared } from '../src/poc/q04/batchExport';
import { createEditState } from '../src/poc/q04/editState';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import { FILM_PROFILES } from '../src/films/registry';
import type { WorkspaceEntry } from '../src/engine/image/workspace';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Q04 batch queue concurrency, progress and cancellation', () => {
  it('respects the concurrency limit, keeps FIFO order and aggregates progress', async () => {
    const resolvers = new Map<string, (value: string) => void>();
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;
    const queue = new BatchQueue<string, string>({
      concurrency: 2,
      processor: (input, ctx) => {
        started.push(input.id);
        active++;
        maxActive = Math.max(maxActive, active);
        ctx.report(0.5, 'half');
        return new Promise<string>((resolve) => {
          resolvers.set(input.id, (value) => {
            active--;
            resolve(value);
          });
        });
      },
    });

    queue.add([1, 2, 3, 4, 5].map((n) => ({ id: String(n), meta: `m${n}` })));
    let snapshot = queue.getSnapshot();
    expect(snapshot.counts.running).toBe(2);
    expect(snapshot.overallProgress).toBeCloseTo(0.2);
    expect(started).toEqual(['1', '2']);

    resolvers.get('1')!('r1');
    await flush();
    snapshot = queue.getSnapshot();
    expect(snapshot.counts.succeeded).toBe(1);
    expect(started).toEqual(['1', '2', '3']);
    expect(maxActive).toBe(2);

    for (const id of ['2', '3', '4', '5']) {
      resolvers.get(id)!('r');
      await flush();
    }
    const done = await queue.drain();
    expect(done.counts.succeeded).toBe(5);
    expect(done.overallProgress).toBe(1);
    expect(done.jobs.map((job) => job.id)).toEqual(['1', '2', '3', '4', '5']);
    queue.destroy();
  });

  it('cancels queued jobs immediately and running jobs through their AbortSignal', async () => {
    const aborted: string[] = [];
    const queue = new BatchQueue<string, void>({
      concurrency: 1,
      processor: (input, ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            aborted.push(input.id);
            reject(new DOMException('cancelled', 'AbortError'));
          });
        }),
    });
    queue.add([
      { id: 'a', meta: 'a' },
      { id: 'b', meta: 'b' },
    ]);
    expect(queue.cancel('b')).toBe(true);
    expect(queue.get('b')!.status).toBe('cancelled');
    expect(queue.cancel('a')).toBe(true);
    expect(queue.get('a')!.cancelRequested).toBe(true);
    await flush();
    const snapshot = queue.getSnapshot();
    expect(snapshot.counts.cancelled).toBe(2);
    expect(aborted).toEqual(['a']);
    queue.cancelAll();
    expect(queue.getSnapshot().counts.cancelled).toBe(2);
    queue.destroy();
  });

  it('retries only failed jobs and preserves successful results', async () => {
    const attempts = new Map<string, number>();
    const queue = new BatchQueue<string, string>({
      concurrency: 2,
      processor: async (input) => {
        attempts.set(input.id, (attempts.get(input.id) ?? 0) + 1);
        if (input.id === 'a' && attempts.get('a') === 1) throw new Error('boom');
        return input.id;
      },
    });
    queue.add([
      { id: 'a', meta: 'a' },
      { id: 'b', meta: 'b' },
    ]);
    const first = await queue.drain();
    expect(first.counts.failed).toBe(1);
    expect(first.counts.succeeded).toBe(1);
    expect(queue.retryFailed()).toBe(1);
    const second = await queue.drain();
    expect(second.counts.succeeded).toBe(2);
    expect(attempts.get('a')).toBe(2);
    expect(attempts.get('b')).toBe(1);
    queue.destroy();
  });

  it('enforces the retry limit and does not rerun healthy jobs', async () => {
    const calls = new Map<string, number>();
    const queue = new BatchQueue<string, string>({
      concurrency: 3,
      retryLimit: 1,
      processor: async (input) => {
        calls.set(input.id, (calls.get(input.id) ?? 0) + 1);
        if (input.meta === 'bad') throw new Error('always');
        return input.id;
      },
    });
    queue.add([
      { id: 'a', meta: 'good' },
      { id: 'b', meta: 'bad' },
      { id: 'c', meta: 'good' },
    ]);
    await queue.drain();
    expect(queue.retry('b')).toBe(false);
    expect(calls.get('b')).toBe(1);
    queue.destroy();
  });

  it('applies partial-failure recovery to failures only', async () => {
    const calls = new Map<string, number>();
    const queue = new BatchQueue<string, string>({
      concurrency: 3,
      retryLimit: 3,
      processor: async (input) => {
        calls.set(input.id, (calls.get(input.id) ?? 0) + 1);
        if (input.meta === 'bad') throw new Error('still bad');
        return input.id;
      },
    });
    queue.add([
      { id: 'a', meta: 'good' },
      { id: 'b', meta: 'bad' },
      { id: 'c', meta: 'good' },
    ]);
    await queue.drain();
    expect(queue.retryFailed()).toBe(1);
    await queue.drain();
    expect(calls.get('a')).toBe(1);
    expect(calls.get('c')).toBe(1);
    expect(calls.get('b')).toBe(2);
    queue.destroy();
  });

  it('adjusts concurrency live for device pressure', async () => {
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const queue = new BatchQueue<string, void>({
      concurrency: 1,
      processor: () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          resolvers.push(() => {
            active--;
            resolve();
          });
        }),
    });
    queue.add([1, 2, 3].map((n) => ({ id: String(n), meta: String(n) })));
    expect(queue.getSnapshot().counts.running).toBe(1);
    queue.setConcurrency(3);
    expect(queue.getSnapshot().counts.running).toBe(3);
    expect(maxActive).toBe(3);
    for (const resolve of resolvers) resolve();
    await queue.drain();
    queue.destroy();
  });

  it('destroy aborts running work and resolves drain', async () => {
    const queue = new BatchQueue<string, void>({
      concurrency: 2,
      processor: (_input, ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
        }),
    });
    queue.add([
      { id: 'a', meta: 'a' },
      { id: 'b', meta: 'b' },
    ]);
    const draining = queue.drain();
    queue.destroy();
    const snapshot = await draining;
    expect(snapshot.counts.cancelled).toBe(2);
    expect(queue.isDestroyed).toBe(true);
  });

  it('normalizes non-finite concurrency and retry limits into safe ranges', () => {
    const queue = new BatchQueue<string, void>({ concurrency: Number.NaN, processor: async () => {} });
    expect(queue.concurrency).toBe(2);
    queue.setConcurrency(Number.POSITIVE_INFINITY);
    expect(queue.concurrency).toBe(2);
    queue.setConcurrency(Number.NEGATIVE_INFINITY);
    expect(queue.concurrency).toBe(2);
    queue.setConcurrency(-4);
    expect(queue.concurrency).toBe(1);
    queue.setConcurrency(2.9);
    expect(queue.concurrency).toBe(2);
    queue.setConcurrency(999);
    expect(queue.concurrency).toBe(MAX_CONCURRENCY);
    queue.setConcurrency(Number.NaN);
    expect(queue.concurrency).toBe(MAX_CONCURRENCY);
    queue.destroy();

    expect(new BatchQueue({ concurrency: Number.POSITIVE_INFINITY, processor: async () => {} }).concurrency).toBe(2);
    expect(new BatchQueue({ retryLimit: Number.NaN, processor: async () => {} }).retryLimit).toBe(3);
    expect(new BatchQueue({ retryLimit: -1, processor: async () => {} }).retryLimit).toBe(1);
    expect(new BatchQueue({ retryLimit: 999, processor: async () => {} }).retryLimit).toBe(10);
    expect(new BatchQueue({ retryLimit: 2.7, processor: async () => {} }).retryLimit).toBe(2);
  });

  it('separates render success from consumer delivery failure', async () => {
    const settled: string[] = [];
    const queue = new BatchQueue<string, string>({
      concurrency: 2,
      processor: async (input) => `render-${input.id}`,
      deliver: async (job) => {
        if (job.id === 'bad') throw new Error('disk full');
      },
      onSettled: (job, outcome) =>
        settled.push(`${job.id}:${outcome.status}:${outcome.status === 'succeeded' ? true : outcome.renderSucceeded ?? false}`),
    });
    queue.add([
      { id: 'ok', meta: 'ok' },
      { id: 'bad', meta: 'bad' },
    ]);
    const snapshot = await queue.drain();

    const bad = snapshot.jobs.find((job) => job.id === 'bad')!;
    expect(bad.status).toBe('failed');
    expect(bad.renderSucceeded).toBe(true);
    expect(bad.deliveryError).toContain('disk full');
    expect(snapshot.counts.rendered).toBe(2);
    expect(snapshot.counts.deliveryFailed).toBe(1);
    expect(snapshot.counts.succeeded).toBe(1);
    expect(snapshot.jobs.find((job) => job.id === 'ok')!.status).toBe('succeeded');
    expect(settled).toContain('bad:failed:true');
    queue.destroy();
  });

  it('retries delivery failures with a fresh render', async () => {
    let deliveries = 0;
    const queue = new BatchQueue<string, string>({
      concurrency: 1,
      retryLimit: 2,
      processor: async (input) => input.id,
      deliver: async () => {
        deliveries++;
        if (deliveries === 1) throw new Error('share sheet closed');
      },
    });
    queue.add([{ id: 'a', meta: 'a' }]);
    let snapshot = await queue.drain();
    expect(snapshot.counts.deliveryFailed).toBe(1);
    expect(snapshot.counts.rendered).toBe(1);
    expect(queue.retryFailed()).toBe(1);
    snapshot = await queue.drain();
    expect(snapshot.counts.succeeded).toBe(1);
    expect(snapshot.counts.rendered).toBe(1);
    expect(snapshot.counts.deliveryFailed).toBe(0);
    expect(snapshot.jobs[0].deliveryError).toBe('');
    queue.destroy();
  });

  it('settles a cancel/retry race without double-running a job', async () => {
    const attempts = new Map<string, number>();
    const queue = new BatchQueue<string, string>({
      concurrency: 1,
      processor: (input, ctx) => {
        attempts.set(input.id, (attempts.get(input.id) ?? 0) + 1);
        if (attempts.get(input.id) === 1) {
          return new Promise<string>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
          });
        }
        return Promise.resolve('second');
      },
    });
    queue.add([{ id: 'a', meta: 'a' }]);
    await flush();
    expect(queue.cancel('a')).toBe(true);
    expect(queue.retry('a')).toBe(false);
    const first = await queue.drain();
    expect(first.counts.cancelled).toBe(1);
    expect(queue.get('a')!.renderSucceeded).toBe(false);

    expect(queue.retry('a')).toBe(true);
    const second = await queue.drain();
    expect(second.counts.succeeded).toBe(1);
    expect(second.counts.cancelled).toBe(0);
    expect(attempts.get('a')).toBe(2);
    queue.destroy();
  });

  it('handles 100 mixed jobs with bounded concurrency, failures, retries and delivery errors', async () => {
    const maxAttempts = new Map<string, number>();
    let active = 0;
    let maxActive = 0;
    const queue = new BatchQueue<string, string>({
      concurrency: 3,
      retryLimit: 2,
      processor: async (input) => {
        maxAttempts.set(input.id, (maxAttempts.get(input.id) ?? 0) + 1);
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        if (Number(input.id) % 11 === 0 && maxAttempts.get(input.id) === 1) throw new Error('transient render');
        return `img-${input.id}`;
      },
      deliver: async (job) => {
        if (Number(job.id) % 17 === 0 && job.attempts === 1) throw new Error('save failed');
      },
    });

    const jobs = Array.from({ length: 100 }, (_, i) => ({ id: String(i), meta: String(i) }));
    queue.add(jobs);
    for (const id of ['1', '2', '3', '4', '5']) expect(queue.cancel(id)).toBe(true);

    let snapshot = await queue.drain();
    expect(snapshot.counts.total).toBe(100);
    expect(snapshot.counts.running).toBe(0);
    expect(snapshot.counts.queued).toBe(0);
    expect(snapshot.counts.cancelled).toBe(5);
    expect(snapshot.counts.failed).toBe(15);
    expect(snapshot.counts.succeeded).toBe(80);
    expect(snapshot.counts.rendered).toBe(85);
    expect(snapshot.counts.deliveryFailed).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(3);

    const failedIds = snapshot.jobs.filter((job) => job.status === 'failed').map((job) => job.id);
    expect(failedIds).toHaveLength(15);
    for (const id of failedIds) expect(queue.retry(id)).toBe(true);
    snapshot = await queue.drain();
    expect(snapshot.counts.succeeded).toBe(95);
    expect(snapshot.counts.cancelled).toBe(5);
    expect(snapshot.counts.failed).toBe(0);
    expect(snapshot.counts.rendered).toBe(95);
    expect(snapshot.counts.deliveryFailed).toBe(0);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(new Set(snapshot.jobs.map((job) => job.id)).size).toBe(100);
    for (const job of snapshot.jobs) {
      expect(['succeeded', 'cancelled']).toContain(job.status);
      expect(maxAttempts.get(job.id) ?? 0).toBeLessThanOrEqual(2);
    }
    queue.destroy();
  });
});

describe('Q04 device-aware concurrency', () => {
  it('derives a bounded limit from memory, cores and mobile constraints', () => {
    expect(recommendedConcurrency({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(3);
    expect(recommendedConcurrency({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(2);
    expect(recommendedConcurrency({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(1);
    expect(recommendedConcurrency({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe(1);
    expect(recommendedConcurrency({ hardwareConcurrency: 16, deviceMemory: 8, mobile: true })).toBe(2);
    expect(recommendedConcurrency({ hardwareConcurrency: 1 })).toBe(1);
    expect(recommendedConcurrency({})).toBe(2);
  });
});

describe('Q04 batch export adapter', () => {
  const exportOptions = { format: 'image/jpeg' as const, quality: 0.9, scale: 0.5 };
  const edit = createEditState({ activeFilmId: 'FS-006', adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 1 } });
  const entry: WorkspaceEntry = { id: 'p', name: 'p.jpg', path: 'p.jpg', getFile: async () => new File(['img'], 'p.jpg') };
  const preparedBlob = new Blob(['x']);

  function prepared(filename: string) {
    return {
      blob: preparedBlob,
      file: new File(['x'], filename, { type: 'image/jpeg' }),
      objectUrl: `blob:prepared-${filename}`,
      filename,
      format: 'image/jpeg' as const,
      quality: 0.9,
      width: 100,
      height: 80,
      fileSize: 1,
      formattedSize: '1 B',
      createdAt: 1,
    };
  }

  function makeDeps(overrides: Record<string, unknown> = {}) {
    const decode = vi.fn(async (_file: File, name: string) => ({
      sourceUrl: `blob:decoded-${name}`,
      name,
      originalWidth: 4000,
      originalHeight: 3000,
      previewWidth: 2048,
      previewHeight: 1536,
      previewCanvas: document.createElement('canvas'),
      originalElement: new Image(),
    }));
    const prepare = vi.fn(async () => prepared('out.jpg'));
    const loadLut = vi.fn(async () => ({
      size: 2,
      domainMin: [0, 0, 0] as [number, number, number],
      domainMax: [1, 1, 1] as [number, number, number],
      floatData: new Float32Array(24),
      rgbaData: new Uint8Array(32),
    }));
    return { decode, prepare, loadLut, ...overrides };
  }

  it('passes the per-image edit state and export options to the shared pipeline', async () => {
    const deps = makeDeps();
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const handle = createExportProcessor({ exportOptions, deps: deps as any });
    const ctx = { id: 'p', signal: new AbortController().signal, report: vi.fn() };
    const result = await handle.processor({ id: 'p', meta: { entry, edit } }, ctx);

    expect(result.objectUrl).toBe('blob:prepared-out.jpg');
    expect(deps.decode).toHaveBeenCalledWith(expect.any(File), 'p.jpg', ctx.signal);
    expect(deps.loadLut).toHaveBeenCalledWith(FILM_PROFILES['FS-006'].lutFile);
    const args = deps.prepare.mock.calls[0] as unknown[];
    expect(args[2]).toBe(edit.adjustments);
    expect(args[3]).toEqual(exportOptions);
    expect(args[5]).toBe(edit.camera);
    expect(args[6]).toBe('FS-006');
    expect(args[7]).toBe(edit.curves);
    expect(args[8]).toBe(edit.colorMixer);
    expect(args[9]).toBe(edit.sharpening);
    expect(revoke).toHaveBeenCalledWith('blob:decoded-p.jpg');

    const second: WorkspaceEntry = { ...entry, id: 'q', name: 'q.jpg', getFile: async () => new File(['img'], 'q.jpg') };
    expect(handle.lutCacheSize()).toBe(1);
    await handle.processor({ id: 'q', meta: { entry: second, edit } }, { ...ctx, id: 'q' });
    expect(deps.loadLut).toHaveBeenCalledTimes(1);
    handle.clearLutCache();
    expect(handle.lutCacheSize()).toBe(0);
  });

  it('discards and revokes a result rendered after cancellation', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      prepare: vi.fn(async () => {
        controller.abort();
        return prepared('abort.jpg');
      }),
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const handle = createExportProcessor({ exportOptions, deps: deps as any });
    await expect(
      handle.processor({ id: 'p', meta: { entry, edit } }, { id: 'p', signal: controller.signal, report: vi.fn() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(revoke).toHaveBeenCalledWith('blob:prepared-abort.jpg');
    expect(revoke).toHaveBeenCalledWith('blob:decoded-p.jpg');
  });

  it('releases the decoded URL and propagates pipeline errors', async () => {
    const deps = makeDeps({ prepare: vi.fn(async () => { throw new Error('GPU allocation failed'); }) });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const handle = createExportProcessor({ exportOptions, deps: deps as any });
    await expect(
      handle.processor({ id: 'p', meta: { entry, edit } }, { id: 'p', signal: new AbortController().signal, report: vi.fn() }),
    ).rejects.toThrow('GPU allocation failed');
    expect(revoke).toHaveBeenCalledWith('blob:decoded-p.jpg');
  });

  it('honours an abort signal before any file work starts', async () => {
    const deps = makeDeps();
    const getFile = vi.fn(entry.getFile);
    const controller = new AbortController();
    controller.abort();
    const handle = createExportProcessor({ exportOptions, deps: deps as any });
    await expect(
      handle.processor({ id: 'p', meta: { entry: { ...entry, getFile }, edit } }, { id: 'p', signal: controller.signal, report: vi.fn() }),
    ).rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('reading file') });
    expect(getFile).not.toHaveBeenCalled();
    expect(deps.decode).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it('drops a file read that completes after cancellation without decoding', async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    let resolveFile: (file: File) => void = () => {};
    const pending = new Promise<File>((resolve) => {
      resolveFile = resolve;
    });
    const handle = createExportProcessor({ exportOptions, deps: deps as any });
    const running = handle.processor(
      { id: 'p', meta: { entry: { ...entry, getFile: () => pending }, edit } },
      { id: 'p', signal: controller.signal, report: vi.fn() },
    );
    controller.abort();
    resolveFile(new File(['img'], 'p.jpg'));
    await expect(running).rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('reading file') });
    expect(deps.decode).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it('labels the stage where a mid-render cancellation was observed', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      prepare: vi.fn(async () => {
        controller.abort();
        return prepared('late.jpg');
      }),
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const handle = createExportProcessor({ exportOptions, deps: deps as any });
    await expect(
      handle.processor({ id: 'p', meta: { entry, edit } }, { id: 'p', signal: controller.signal, report: vi.fn() }),
    ).rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('encoding') });
  });

  it('delivers results through a sink and always releases the object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const saved: string[] = [];
    const sink = createDeliverySink((result, job) => {
      saved.push(`${job.id}:${result.filename}`);
    });
    const job = { id: 'job-1' } as any;
    const result = prepared('shot.jpg');
    await sink(job, result);
    expect(saved).toEqual(['job-1:shot.jpg']);
    expect(revoke).toHaveBeenCalledWith('blob:prepared-shot.jpg');
    disposePrepared(result);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('propagates save failures after releasing the object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const sink = createDeliverySink(async () => {
      throw new Error('storage quota exceeded');
    });
    await expect(sink({ id: 'job-1' } as any, prepared('lost.jpg'))).rejects.toThrow('storage quota exceeded');
    expect(revoke).toHaveBeenCalledWith('blob:prepared-lost.jpg');
    const success = createDeliverySink(() => {});
    await success({ id: 'job-2' } as any, prepared('kept.jpg'));
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
