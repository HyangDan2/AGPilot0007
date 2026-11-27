import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMaskBridge, useEditorStore } from '../src/stores/editorStore';
import { useMaskUiStore } from '../src/stores/maskUiStore';

/**
 * Mask UI edits must reach editorStore history in one step per gesture:
 * discrete actions commit immediately, slider-style edits commit on idle.
 */
describe('mask bridge history policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMaskUiStore.setState({ local: { enabled: false, groups: [] }, selectedGroupId: null, selectedMaskId: null, notice: null });
    const editor = useEditorStore.getState();
    editor.resetLocalAdjustments();
    startMaskBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits a discrete group action immediately', () => {
    useMaskUiStore.getState().addGroup();
    const local = useMaskUiStore.getState().local;
    expect(local.groups).toHaveLength(1);

    const editor = useEditorStore.getState();
    expect(editor.localAdjustments.groups).toHaveLength(1);
    expect(editor.history[editor.historyIndex].localAdjustments.groups).toHaveLength(1);
  });

  it('defers slider edits to a single idle commit', () => {
    useMaskUiStore.getState().addGroup();
    const groupId = useMaskUiStore.getState().local.groups[0].id;
    const editor = useEditorStore.getState();
    const commitsBefore = editor.history.length;

    useMaskUiStore.getState().setGroupAdjustment(groupId, 'exposure', 1.25);
    expect(useEditorStore.getState().localAdjustments.groups[0].adjustment.exposure).toBe(1.25);
    expect(useEditorStore.getState().history.length).toBe(commitsBefore);

    vi.advanceTimersByTime(400);
    const committed = useEditorStore.getState();
    expect(committed.history[committed.historyIndex].localAdjustments.groups[0].adjustment.exposure).toBe(1.25);
  });

  it('mirrors editor changes such as undo back into the mask UI without looping', () => {
    useMaskUiStore.getState().addGroup();
    useEditorStore.getState().resetLocalAdjustments();
    expect(useMaskUiStore.getState().local.groups).toHaveLength(0);
    expect(useEditorStore.getState().localAdjustments.groups).toHaveLength(0);
  });
});