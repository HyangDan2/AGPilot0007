export interface SelectionState {
  ids: string[];
  /** Range origin for Shift selection; always one of the clicked ids. */
  anchor: string | null;
}

export interface ClickModifiers {
  shiftKey?: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  toggle?: boolean;
}

export function createSelection(ids: string[], anchor: string | null = ids.at(-1) ?? null): SelectionState {
  return { ids: [...new Set(ids)], anchor: anchor && ids.includes(anchor) ? anchor : null };
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
      return { ids: rangeBetween(orderedIds, current.anchor, id), anchor: current.anchor };
    }
    return { ids: [id], anchor: id };
  }
  if (mods.toggle) {
    const selected = new Set(current.ids);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { ids: [...selected], anchor: id };
  }
  return { ids: [id], anchor: id };
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
  return { ids, anchor };
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.ids.includes(id);
}

/** The image a copy/apply action should read from: the last clicked anchor. */
export function primarySelection(state: SelectionState): string | null {
  return state.anchor ?? state.ids.at(-1) ?? null;
}
