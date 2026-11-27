import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchExportController, type BatchExportView } from '../src/poc/q04/integration/batchController';
import { EditorEditStateBridge, type EditorSource, type WorkspaceSource } from '../src/poc/q04/integration/editStateBridge';
import type { ExportProcessorHandle } from '../src/poc/q04/batchExport';
import { createEditState } from '../src/poc/q04/editState';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import { DEFAULT_CAMERA } from '../src/types/camera';
import { defaultCurves } from '../src/types/curves';
import { defaultColorMixer } from '../src/types/colorMixer';
import { DEFAULT_SHARPENING } from '../src/types/sharpening';
import type { PreparedExport } from '../src/types/export';
import type { WorkspaceEntry } from '../src/engine/image/workspace';

afterEach(() => {
  vi.restoreAllMocks();
});

class FakeSource<S> {
  private listeners = new Set<(next: S, previous: S) => void>();
  constructor(public state: S) {}
  getState(): S {
    return this.state;
  }
  subscribe(listener: (next: S, previous: S) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(patch: Partial<S>): void {
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener(this.state, previous);
  }
}

type EditorSnapshot = ReturnType<EditorSource['getState']>;

function editorState(imageId: string | null, overrides: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return {
    activeFilmId: 'FS-001',
    activePresetId: null,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    curves: defaultCurves(),
    camera: DEFAULT_CAMERA,
    colorMixer: defaultColorMixer(),
    sharpening: { ...DEFAULT_SHARPENING },
    image: imageId ? { workspaceKey: imageId } : null,
    ...overrides,
  };
}

describe('CP2-05 editor EditState bridge', () => {
  it('captures the outgoing photo edits and serves live, mirrored and fresh states', () => {
    const editor = new FakeSource(editorState('a', { activeFilmId: 'FS-003', adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 1.2, grain: 30 } }));
    const workspace = new FakeSource({ entries: [{ id: 'a' }, { id: 'b' }], name: 'trip' });
    const bridge = new EditorEditStateBridge(editor as unknown as EditorSource, workspace as unknown as WorkspaceSource);

    editor.set({ image: { workspaceKey: 'b' }, adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: -0.5 } });
    expect(bridge.editFor('a').adjustments.exposure).toBe(1.2);
    expect(bridge.editFor('a').activeFilmId).toBe('FS-003');
    expect(bridge.editFor('a').adjustments.grain).toBe(30);

    expect(bridge.editFor('b').adjustments.exposure).toBe(-0.5);
    editor.set({ adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.7 } });
    expect(bridge.editFor('b').adjustments.exposure).toBe(0.7);
    expect(bridge.editFor('c').adjustments.exposure).toBe(0);

    bridge.dispose();
  });

  it('prunes removed photos and clears on a new workspace', () => {
    const editor = new FakeSource(editorState('a', { adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 1 } }));
    const workspace = new FakeSource({ entries: [{ id: 'a' }, { id: 'b' }], name: 'trip' });
    const bridge = new EditorEditStateBridge(editor as unknown as EditorSource, workspace as unknown as WorkspaceSource);

    editor.set({ image: { workspaceKey: 'b' } });
    expect(bridge.editFor('a').adjustments.exposure).toBe(1);

    workspace.set({ entries: [{ id: 'b' }] });
    expect(bridge.editFor('a').adjustments.exposure).toBe(0);

    editor.set({ image: { workspaceKey: 'a' }, adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.3 } });
    editor.set({ image: { workspaceKey: 'b' } });
    workspace.set({ name: 'other', entries: [{ id: 'a' }] });
    expect(bridge.editFor('a').adjustments.exposure).toBe(0);

    bridge.dispose();
  });
});

function prepared(filename: string): PreparedExport {
  return {
    blob: new Blob(['x']),
    file: new File(['x'], filename, { type: 'image/jpeg' }),
    objectUrl: `blob:prepared-${filename}`,
    filename,
    format: 'image/jpeg',
    quality: 0.92,
    width: 10,
    height: 10,
    fileSize: 1,
    formattedSize: '1 B',
    createdAt: 1,
  };
}

function entry(id: string): WorkspaceEntry {
  return { id, name: `${id}.jpg`, path: `trip/${id}.jpg`, getFile: async () => new File(['x'], `${id}.jpg`) };
}

function processorOf(process: (id: string, call: number, ctx: { signal: AbortSignal }) => Promise<PreparedExport>): ExportProcessorHandle {
  const calls = new Map<string, number>();
  return {
    processor: (input, ctx) => {
      const call = (calls.get(input.id) ?? 0) + 1;
      calls.set(input.id, call);
      return process(input.id, call, ctx);
    },
    lutCacheSize: () => 0,
    clearLutCache: () => {},
  };
}

function waitForSummary(controller: BatchExportController, predicate: (view: BatchExportView) => boolean): Promise<BatchExportView> {
  return new Promise((resolve) => {
    const unsubscribe = controller.subscribe((view) => {
      if (predicate(view)) {
        unsubscribe();
        resolve(view);
      }
    });
  });
}

describe('CP2-05 batch export controller', () => {
  it('runs the selection, settles partial delivery failures and releases every object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const delivered: string[] = [];
    const controller = new BatchExportController({
      concurrency: 2,
      processor: processorOf(async (id) => prepared(`${id}.jpg`)),
      delivery: (result) => {
        if (result.filename === 'b.jpg') throw new Error('save failed');
        delivered.push(result.filename);
      },
    });
    controller.setEntries([entry('a'), entry('b'), entry('c')]);
    const done = waitForSummary(controller, (view) => view.summary !== null && !view.running);
    expect(controller.start(['a', 'b', 'c'], () => createEditState())).toBe(true);
    const view = await done;

    expect(view.summary).toMatchObject({ total: 3, succeeded: 2, failed: 1, rendered: 3, deliveryFailed: 1, reconciled: true });
    expect(delivered.sort()).toEqual(['a.jpg', 'c.jpg']);
    expect(revoke).toHaveBeenCalledWith('blob:prepared-a.jpg');
    expect(revoke).toHaveBeenCalledWith('blob:prepared-b.jpg');
    expect(revoke).toHaveBeenCalledWith('blob:prepared-c.jpg');
    controller.destroy();
  });

  it('cancels running jobs through the shared signal and settles them as cancelled', async () => {
    const delivered = vi.fn();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controller = new BatchExportController({
      concurrency: 1,
      processor: processorOf(async (id, _call, ctx) => {
        started();
        await gate;
        if (ctx.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        return prepared(`${id}.jpg`);
      }),
      delivery: delivered,
    });
    controller.setEntries([entry('a'), entry('b')]);
    const done = waitForSummary(controller, (view) => view.summary !== null && !view.running);
    expect(controller.start(['a', 'b'], () => createEditState())).toBe(true);
    await running;
    controller.cancel('a');
    controller.cancel('b');
    release();
    const view = await done;

    expect(view.summary).toMatchObject({ total: 2, succeeded: 0, cancelled: 2, reconciled: true });
    expect(delivered).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('retries failed jobs in place and keeps the successful ones settled', async () => {
    const controller = new BatchExportController({
      concurrency: 1,
      processor: processorOf(async (id, call) => {
        if (id === 'b' && call === 1) throw new Error('render failed');
        return prepared(`${id}.jpg`);
      }),
      delivery: () => {},
    });
    controller.setEntries([entry('a'), entry('b')]);
    const first = waitForSummary(controller, (view) => view.summary !== null && !view.running);
    controller.start(['a', 'b'], () => createEditState());
    expect((await first).summary).toMatchObject({ succeeded: 1, failed: 1 });

    const retried = waitForSummary(controller, (view) => view.summary !== null && view.summary.failed === 0 && !view.running);
    expect(controller.retryFailed()).toBe(1);
    const view = await retried;
    expect(view.summary).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    controller.destroy();
  });

  it('gives duplicate output names unique filenames before delivering', async () => {
    const delivered: string[] = [];
    const controller = new BatchExportController({
      concurrency: 1,
      processor: processorOf(async () => prepared('same.png')),
      delivery: (result) => {
        delivered.push(result.filename);
      },
    });
    controller.setEntries([entry('a'), entry('b')]);
    const done = waitForSummary(controller, (view) => view.summary !== null && !view.running);
    expect(controller.start(['a', 'b'], () => createEditState())).toBe(true);
    const view = await done;
    expect(delivered).toEqual(['same.png', 'same-2.png']);
    expect(view.summary).toMatchObject({ total: 2, succeeded: 2, reconciled: true });
    controller.destroy();
  });

  it('starts only ids that still exist in the workspace entries', () => {
    const started = vi.fn((): ReturnType<typeof createEditState> => createEditState());
    const controller = new BatchExportController({ processor: processorOf(async (id) => prepared(`${id}.jpg`)), delivery: () => {} });
    controller.setEntries([entry('a'), entry('b')]);
    expect(controller.start([], started)).toBe(false);
    expect(controller.start(['gone'], started)).toBe(false);
    expect(controller.start(['a', 'gone'], started)).toBe(true);
    expect(started).toHaveBeenCalledTimes(1);
    controller.cancelAll();
    controller.destroy();
  });
});
