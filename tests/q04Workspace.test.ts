import { describe, expect, it } from 'vitest';
import { clickSelection, clampSelection, createSelection, primarySelection, rangeBetween } from '../src/poc/q04/selection';
import { EditStateRegistry, cloneEditState, createEditState, editStateFromRecipe, recipeFromEditState } from '../src/poc/q04/editState';
import { computeVirtualWindow, indexAtOffset, scrollOffsetForIndex } from '../src/poc/q04/virtualization';
import { virtualRange } from '../src/engine/image/workspace';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import { DEFAULT_CAMERA } from '../src/types/camera';
import { defaultCurves } from '../src/types/curves';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('Q04 multi-selection (Shift/Ctrl)', () => {
  it('plain click replaces the selection and moves the anchor', () => {
    const state = clickSelection({ ids: ['a', 'b'], anchor: 'a', active: 'b' }, ids, 'c');
    expect(state).toEqual({ ids: ['c'], anchor: 'c', active: 'c' });
  });

  it('shift click selects the inclusive range from the anchor in both directions', () => {
    let state = clickSelection(createSelection([]), ids, 'b');
    state = clickSelection(state, ids, 'd', { shiftKey: true });
    expect(state.ids).toEqual(['b', 'c', 'd']);
    expect(state.anchor).toBe('b');
    expect(state.active).toBe('d');
    state = clickSelection(state, ids, 'a', { shiftKey: true });
    expect(state.ids).toEqual(['a', 'b']);
    expect(state.anchor).toBe('b');
    expect(state.active).toBe('a');
  });

  it('ctrl/cmd toggles a single id and anchors on it', () => {
    let state = clickSelection(createSelection([]), ids, 'b');
    state = clickSelection(state, ids, 'd', { toggle: true });
    expect(state).toEqual({ ids: ['b', 'd'], anchor: 'd', active: 'd' });
    state = clickSelection(state, ids, 'b', { toggle: true });
    expect(state).toEqual({ ids: ['d'], anchor: 'b', active: 'd' });
  });

  it('shift wins over ctrl and falls back to a single selection without a valid anchor', () => {
    const toggled = clickSelection(createSelection([]), ids, 'e');
    const ranged = clickSelection(toggled, ids, 'c', { shiftKey: true, toggle: true });
    expect(ranged.ids).toEqual(['c', 'd', 'e']);
    const orphan = clickSelection({ ids: ['c'], anchor: 'zzz', active: 'c' }, ids, 'd', { shiftKey: true });
    expect(orphan).toEqual({ ids: ['d'], anchor: 'd', active: 'd' });
  });

  it('clamps ids and anchors after a folder rescan and exposes the primary id', () => {
    const clamped = clampSelection({ ids: ['a', 'removed', 'c'], anchor: 'removed', active: 'removed' }, ids);
    expect(clamped.ids).toEqual(['a', 'c']);
    expect(clamped.anchor).toBe('c');
    expect(clamped.active).toBe('c');
    expect(primarySelection(clamped)).toBe('c');
    expect(rangeBetween(ids, 'zzz', 'c')).toEqual(['c']);
  });

  it('never keeps a deselected id as the primary selection', () => {
    let state = clickSelection(createSelection([]), ids, 'a');
    state = clickSelection(state, ids, 'c', { shiftKey: true });
    expect(primarySelection(state)).toBe('c');

    state = clickSelection(state, ids, 'c', { toggle: true });
    expect(state.ids).toEqual(['a', 'b']);
    expect(state.anchor).toBe('c');
    // The removed id was active, so the primary falls back to its nearest neighbour, never the deselected anchor.
    expect(primarySelection(state)).toBe('b');

    const legacy = { ids: ['a', 'b'], anchor: 'b', active: 'b' };
    const toggled = clickSelection(legacy, ids, 'b', { toggle: true });
    expect(primarySelection(toggled)).toBe('a');
    expect(toggled.ids).toContain(primarySelection(toggled));
    expect(primarySelection(toggled)).not.toBe('b');
  });
});

describe('Q04 per-image edit state and selective copy/paste', () => {
  function sourceState() {
    return createEditState({
      activeFilmId: 'FS-003',
      activePresetId: 'margarine-1',
      adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 2, temperature: 25, grain: 40, vignette: 20, filmStrength: 80 },
      curves: { ...defaultCurves(), red: [[0, 0], [1, 0.5]] },
      camera: { ...DEFAULT_CAMERA, dateStamp: { ...DEFAULT_CAMERA.dateStamp, enabled: true, date: '2020-05-05' }, optics: { ...DEFAULT_CAMERA.optics, glow: 20 } },
    });
  }

  it('keeps edit states independent per image', () => {
    const registry = new EditStateRegistry();
    registry.ensure('a');
    registry.ensure('b');
    registry.updateAdjustment('a', 'exposure', 1.5);
    registry.updateAdjustment('b', 'exposure', -0.5);
    expect(registry.get('a')!.adjustments.exposure).toBe(1.5);
    expect(registry.get('b')!.adjustments.exposure).toBe(-0.5);
    registry.updateAdjustment('a', 'exposure', 99);
    expect(registry.get('a')!.adjustments.exposure).toBe(3);
    expect(registry.size).toBe(2);
  });

  it('copies and pastes only the selected parameter groups', () => {
    const registry = new EditStateRegistry();
    const source = sourceState();
    registry.set('a', source);
    registry.set('b', createEditState({ activeFilmId: 'FS-009', adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: -1, grain: 5 } }));

    const clip = registry.copyFrom('a', ['film', 'curves', 'camera'])!;
    expect(clip.groups).toEqual(['film', 'curves', 'camera']);
    registry.pasteTo('b', clip);

    const target = registry.get('b')!;
    expect(target.activeFilmId).toBe('FS-003');
    expect(target.curves).toEqual(source.curves);
    expect(target.camera.dateStamp.enabled).toBe(true);
    expect(target.adjustments.exposure).toBe(-1);
    expect(target.adjustments.grain).toBe(5);
    expect(target.curves).not.toBe(source.curves);

    registry.pasteTo('b', registry.copyFrom('a', ['tone'])!);
    expect(registry.get('b')!.adjustments.exposure).toBe(2);
    expect(registry.get('b')!.adjustments.temperature).toBe(25);
    expect(registry.get('b')!.adjustments.grain).toBe(5);
    expect(registry.get('b')!.activeFilmId).toBe('FS-003');
  });

  it('batch-applies a snapshot without sharing references', () => {
    const registry = new EditStateRegistry();
    const source = sourceState();
    expect(registry.applyToMany(['x', 'y', 'z'], source)).toBe(3);
    registry.updateAdjustment('x', 'exposure', 0);
    expect(registry.get('x')!.adjustments.exposure).toBe(0);
    expect(registry.get('y')!.adjustments.exposure).toBe(2);
    expect(registry.get('y')!.curves).not.toBe(registry.get('z')!.curves);
    expect(cloneEditState(source)).not.toBe(source);

    source.adjustments.exposure = -2;
    expect(registry.get('y')!.adjustments.exposure).toBe(2);
  });

  it('returns frozen snapshots and rejects in-place mutation', () => {
    const registry = new EditStateRegistry();
    const snapshot = registry.ensure('a');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.adjustments)).toBe(true);
    expect(Object.isFrozen(snapshot.curves.white)).toBe(true);
    expect(() => {
      snapshot.adjustments.exposure = 2;
    }).toThrow(TypeError);
    expect(registry.get('a')!.adjustments.exposure).toBe(0);

    const before = registry.get('a');
    const updated = registry.updateAdjustment('a', 'exposure', 1);
    expect(updated).not.toBe(before);
    expect(before!.adjustments.exposure).toBe(0);
    expect(updated.adjustments.exposure).toBe(1);
  });

  it('notifies subscribers of create, set, delete and clear changes', () => {
    const registry = new EditStateRegistry();
    const events: string[] = [];
    const unsubscribe = registry.subscribe((change) => events.push(`${change.kind}:${change.id}`));
    registry.ensure('a');
    registry.updateAdjustment('a', 'exposure', 1);
    registry.pasteTo('b', registry.copyFrom('a', ['tone'])!);
    registry.delete('a');
    registry.clear();
    unsubscribe();
    registry.ensure('c');
    expect(events).toEqual(['create:a', 'set:a', 'create:b', 'set:b', 'delete:a', 'clear:']);
  });

  it('keeps multi-image paste isolated from the clip and the source image', () => {
    const registry = new EditStateRegistry();
    registry.set('src', sourceState());
    registry.ensure('x');
    registry.ensure('y');
    const clip = registry.copyFrom('src', ['tone', 'curves'])!;
    registry.pasteToMany(['x', 'y'], clip);
    expect(registry.get('x')!.adjustments.exposure).toBe(2);
    expect(registry.get('y')!.adjustments.exposure).toBe(2);
    expect(registry.get('x')!.curves).not.toBe(registry.get('y')!.curves);
    expect(registry.get('x')!.curves).not.toBe(clip.curves);
    registry.updateAdjustment('x', 'exposure', -1);
    expect(registry.get('y')!.adjustments.exposure).toBe(2);
    expect(registry.get('src')!.adjustments.exposure).toBe(2);
  });

  it('round-trips a Recipe v7 snapshot without touching stores', () => {
    const source = sourceState();
    const recipe = recipeFromEditState(source, { id: 'rcp-1', name: 'Warm' });
    expect(recipe.schemaVersion).toBe(7);
    expect(recipe.baseFilmId).toBe('FS-003');
    expect(recipe.adjustments.grain).toBe(40);
    const restored = editStateFromRecipe(recipe);
    expect(restored.activeFilmId).toBe('FS-003');
    expect(restored.curves).toEqual(source.curves);
    expect(restored.camera.dateStamp.date).toBe('2020-05-05');
  });
});

describe('Q04 thumbnail virtualization', () => {
  it('matches the existing virtualRange math and clamps scroll positions', () => {
    const window = computeVirtualWindow({ count: 1000, viewportWidth: 500, scrollLeft: 2320 });
    const expected = virtualRange(1000, 2320, 500, 116, 3);
    expect(window.start).toBe(expected.start);
    expect(window.end).toBe(expected.end);
    expect(window.totalWidth).toBe(116000);

    expect(computeVirtualWindow({ count: 1000, viewportWidth: 500, scrollLeft: -50 }).offset).toBe(0);
    const end = computeVirtualWindow({ count: 1000, viewportWidth: 500, scrollLeft: 1e9 });
    expect(end.offset).toBe(116000 - 500);
    expect(end.end).toBe(1000);
  });

  it('handles empty folders and keeps 100k-entry windows small', () => {
    expect(computeVirtualWindow({ count: 0, viewportWidth: 800, scrollLeft: 0 })).toMatchObject({ start: 0, end: 0, totalWidth: 0 });
    const large = computeVirtualWindow({ count: 100000, viewportWidth: 1200, scrollLeft: 116 * 50000 });
    expect(large.end - large.start).toBeLessThan(40);
    expect(computeVirtualWindow({ count: 0, viewportWidth: 0, scrollLeft: 0 }).end).toBe(0);
  });

  it('centers and clamps scroll jumps', () => {
    expect(scrollOffsetForIndex(0, 1000, 500)).toBe(0);
    expect(scrollOffsetForIndex(500, 1000, 500)).toBe(116 * 500 - 250 + 58);
    expect(scrollOffsetForIndex(999, 1000, 500)).toBe(116000 - 500);
    expect(indexAtOffset(0, 1000)).toBe(0);
    expect(indexAtOffset(1e9, 1000)).toBe(999);
    expect(indexAtOffset(0, 0)).toBeNull();
  });
});
