import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeDevelop, RAW_NEUTRAL_DEVELOP } from '../src/engine/contracts/develop';

type FakeOptions = {
  onCommit?: (decoded: unknown) => void;
  onError?: (error: unknown) => void;
};
type FakeInstance = {
  source: unknown;
  options: FakeOptions;
  requests: unknown[];
  flushCalls: number;
  disposeCalls: number;
};

const instances = vi.hoisted(() => [] as FakeInstance[]);

vi.mock('../src/engine/raw', () => ({
  createRawRedeveloper: (source: unknown, options: FakeOptions) => {
    const instance: FakeInstance = { source, options, requests: [], flushCalls: 0, disposeCalls: 0 };
    instances.push(instance);
    return {
      request: (develop: unknown) => instance.requests.push(develop),
      flush: async () => {
        instance.flushCalls += 1;
        return null;
      },
      cancel: () => undefined,
      dispose: () => {
        instance.disposeCalls += 1;
      },
    };
  },
}));

import { useEditorStore as store } from '../src/stores/editorStore';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeImage() {
  return {
    sourceUrl: 'blob:fake',
    name: 'fake.dng',
    originalWidth: 20,
    originalHeight: 10,
    previewCanvas: document.createElement('canvas'),
    previewWidth: 10,
    previewHeight: 5,
    originalElement: document.createElement('img'),
  };
}

const rawSourceA = { id: 'raw-a' } as never;
const rawSourceB = { id: 'raw-b' } as never;

const fakeInfo = {
  settings: { exposureEv: 0, temperatureK: 5000, tint: 0, highlightRecovery: 'off' as const },
  report: { asShotTemperatureK: 5000 },
  identity: true,
  width: 20,
  height: 10,
};

const latest = () => instances[instances.length - 1];

describe('CP4-07 develop UI wiring', () => {
  beforeEach(() => {
    instances.length = 0;
    store.setState(store.getInitialState(), true);
  });

  it('attaches a redeveloper to a RAW source and feeds setDevelop changes', async () => {
    store.getState().setImage(fakeImage() as never, rawSourceA);
    await tick();
    expect(instances).toHaveLength(1);
    expect(instances[0].source).toBe(rawSourceA);

    const develop = normalizeDevelop({ wb: { mode: 'as-shot' }, exposureEV: 1, highlightRecovery: 0.6 });
    store.getState().setDevelop(develop);
    await tick();
    // Attach queues the neutral state first (skipped decode); the edit is last.
    expect(latest().requests.at(-1)).toEqual(develop);
  });

  it('commits a decoded preview by swapping image pixels for a new identity', async () => {
    store.getState().setImage(fakeImage() as never, rawSourceA);
    await tick();
    const before = store.getState().image!;
    const preview = document.createElement('canvas');

    latest().options.onCommit?.({
      settings: fakeInfo.settings,
      report: fakeInfo.report,
      working: { width: 10, height: 5 } as never,
      preview,
      previewWidth: 12,
      previewHeight: 6,
      width: 20,
      height: 10,
      skipped: false,
    });
    const after = store.getState().image!;
    expect(after).not.toBe(before);
    expect(after.previewCanvas).toBe(preview);
    expect(after.previewWidth).toBe(12);
    expect(after.previewHeight).toBe(6);
    expect(after.originalElement).toBe(preview);
    expect(after.originalWidth).toBe(20);
  });

  it('ignores a commit from a superseded source and disposes on source change', async () => {
    const imageA = fakeImage();
    store.getState().setImage(imageA as never, rawSourceA);
    await tick();
    const old = latest();

    store.getState().setImage(fakeImage() as never, rawSourceB);
    await tick();
    expect(old.disposeCalls).toBe(1);
    expect(instances).toHaveLength(2);
    expect(store.getState().rawSource).toBe(rawSourceB);

    const preview = document.createElement('canvas');
    old.options.onCommit?.({
      settings: fakeInfo.settings,
      report: fakeInfo.report,
      working: { width: 10, height: 5 } as never,
      preview,
      previewWidth: 12,
      previewHeight: 6,
      width: 20,
      height: 10,
      skipped: false,
    });
    expect(store.getState().image!.previewCanvas).not.toBe(preview);
  });

  it('skips the redeveloper for non-RAW images', async () => {
    store.getState().setImage(fakeImage() as never);
    await tick();
    expect(instances).toHaveLength(0);
  });

  it('flushes the pending decode before export reads the asset', async () => {
    store.getState().setImage(fakeImage() as never, rawSourceA);
    await tick();
    store.getState().setDevelop(normalizeDevelop({ exposureEV: 0.5 }));
    await tick();
    await store.getState().flushDevelop();
    expect(latest().flushCalls).toBe(1);
    await store.getState().flushDevelop();
    expect(latest().flushCalls).toBe(2);
  });

  it('feeds develop from an applied v10 recipe into the redeveloper', async () => {
    store.setState({
      image: fakeImage() as never,
      rawSource: rawSourceB,
      rawDevelop: fakeInfo as never,
      develop: RAW_NEUTRAL_DEVELOP,
    });
    await tick();
    const develop = normalizeDevelop({ wb: { mode: 'custom', temperatureK: 7000, tint: 8 }, exposureEV: 0.8 });
    store.getState().applyRecipe({
      id: 'rcp-v10',
      name: 'V10',
      baseFilmId: 'FS-001',
      profileVersion: '1.0.0',
      adjustments: {},
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: 10,
      develop,
    } as never);
    await tick();
    expect(store.getState().develop).toEqual(develop);
    expect(latest().requests.at(-1)).toEqual(develop);
  });
});
