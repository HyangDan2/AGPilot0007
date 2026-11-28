import { virtualRange } from '../../engine/image/workspace';

export interface VirtualWindowInput {
  count: number;
  viewportWidth: number;
  scrollLeft: number;
  itemWidth?: number;
  overscan?: number;
}

export interface VirtualWindow {
  start: number;
  end: number;
  offset: number;
  totalWidth: number;
  itemWidth: number;
  overscan: number;
}

export const DEFAULT_ITEM_WIDTH = 116;
export const DEFAULT_OVERSCAN = 3;

/**
 * Clamped horizontal window for large folders. Reuses the existing
 * engine/image/workspace.virtualRange math instead of duplicating it; the PoC
 * only adds scroll clamping, overflow handling and jump-to-index helpers.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const itemWidth = Math.max(1, input.itemWidth ?? DEFAULT_ITEM_WIDTH);
  const overscan = Math.max(0, Math.floor(input.overscan ?? DEFAULT_OVERSCAN));
  const count = Math.max(0, Math.floor(input.count));
  const viewportWidth = Math.max(0, input.viewportWidth);
  const totalWidth = count * itemWidth;
  if (count === 0) return { start: 0, end: 0, offset: 0, totalWidth: 0, itemWidth, overscan };

  const maxScroll = Math.max(0, totalWidth - viewportWidth);
  const scroll = Math.min(maxScroll, Math.max(0, input.scrollLeft));
  const range = virtualRange(count, scroll, viewportWidth, itemWidth, overscan);
  return { start: range.start, end: range.end, offset: scroll, totalWidth, itemWidth, overscan };
}

/** Scroll offset that centers the index, clamped to the scrollable range. */
export function scrollOffsetForIndex(index: number, count: number, viewportWidth: number, itemWidth = DEFAULT_ITEM_WIDTH): number {
  if (count <= 0) return 0;
  const clampedIndex = Math.min(count - 1, Math.max(0, Math.floor(index)));
  const maxScroll = Math.max(0, count * itemWidth - viewportWidth);
  return Math.min(maxScroll, Math.max(0, clampedIndex * itemWidth - viewportWidth / 2 + itemWidth / 2));
}

export function indexAtOffset(offset: number, count: number, itemWidth = DEFAULT_ITEM_WIDTH): number | null {
  if (count <= 0 || !Number.isFinite(offset)) return null;
  const index = Math.floor(offset / itemWidth);
  return Math.min(count - 1, Math.max(0, index));
}
