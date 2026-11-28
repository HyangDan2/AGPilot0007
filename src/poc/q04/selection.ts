export interface SelectionState {
  ids: string[];
  /**
   * Range origin for Shift selection. It can point at a deselected id after a
   * toggle-off, so it must not be used as the primary/active image.
   */
  anchor: string | null;
  /** The image UI actions (copy/apply) read from; always one of ids, or null. */
  active: string | null;
}

export interface ClickModifiers {
  shiftKey?: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  toggle?: boolean;
}

export function createSelection(ids: string[], anchor: string | null = ids.at(-1) ?? null, active: string | null = anchor): SelectionState {
  const unique = [...new Set(ids)];
  const resolvedAnchor = anchor && unique.includes(anchor) ? anchor : null;
  return { ids: unique, anchor: resolvedAnchor, active: active && unique.includes(active) ? active : unique.at(-1) ?? null };
}

/**
 * Explorer-style multi-selection:
 * - plain click selects one item,
 * - Ctrl/Cmd toggles one item,
 * - Shift selects the inclusive range from the anchor,
 * - Shift wins over Ctrl/Cmd when both are held.
 */
export function clickSelection(current: SelectionState, orderedIds: readonly string[], id: string, mods: ClickModifiers = {}): SelectionState {
  if (!orderedIds.includes(id)) return clampSelection(current, orderedIds);
  if (mods.shiftKey) {
    if (current.anchor && orderedIds.includes(current.anchor)) {
      return { ids: rangeBetween(orderedIds, current.anchor, id), anchor: current.anchor, active: id };
    }
    return { ids: [id], anchor: id, active: id };
  }
  if (mods.toggle) {
    const selected = new Set(current.ids);
    if (selected.has(id)) {
      selected.delete(id);
      return { ids: [...selected], anchor: id, active: nextActive(current, orderedIds, selected, id) };
    }
    selected.add(id);
    return { ids: [...selected], anchor: id, active: id };
  }
  return { ids: [id], anchor: id, active: id };
}

/** Keeps the active image selected; falls back to the nearest remaining item. */
function nextActive(current: SelectionState, orderedIds: readonly string[], selected: Set<string>, removedId: string): string | null {
  if (current.active !== removedId && current.active && selected.has(current.active)) return current.active;
  const index = orderedIds.indexOf(removedId);
  if (index >= 0) {
    for (let distance = 1; distance < orderedIds.length; distance++) {
      const before = orderedIds[index - distance];
      if (before && selected.has(before)) return before;
      const after = orderedIds[index + distance];
      if (after && selected.has(after)) return after;
    }
  }
  return selected.values().next().value ?? null;
}

export function rangeBetween(orderedIds: readonly string[], from: string, to: string): string[] {
  const a = orderedIds.indexOf(from);
  const b = orderedIds.indexOf(to);
  if (a < 0 || b < 0) return b >= 0 ? [to] : [];
  const [start, end] = a <= b ? [a, b] : [b, a];
  return orderedIds.slice(start, end + 1);
}

/** Drops ids that no longer exist after a folder rescan or sort change. */
export function clampSelection(current: SelectionState, orderedIds: readonly string[]): SelectionState {
  const known = new Set(orderedIds);
  const ids = current.ids.filter((id) => known.has(id));
  const anchor = current.anchor && known.has(current.anchor) ? current.anchor : ids.at(-1) ?? null;
  const active = current.active && known.has(current.active) ? current.active : ids.at(-1) ?? null;
  return { ids, anchor, active };
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.ids.includes(id);
}

/** The image a copy/apply action should read from. Never a deselected anchor. */
export function primarySelection(state: SelectionState): string | null {
  if (state.active && state.ids.includes(state.active)) return state.active;
  return state.ids.at(-1) ?? null;
}
