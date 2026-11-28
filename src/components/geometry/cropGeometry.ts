import { MIN_CROP_EDGE, type CropRect } from '../../engine/contracts/geometry';

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

export type CropResizeHandle = Exclude<CropHandle, 'move'>;

export const CROP_HANDLES: readonly CropResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

export const CROP_KEYBOARD_STEP = 0.005;

export function fullFrameCrop(): CropRect {
  return { x: 0, y: 0, width: 1, height: 1 };
}

export function isFullFrameCrop(crop: CropRect): boolean {
  return crop.x <= 0 && crop.y <= 0 && crop.width >= 1 && crop.height >= 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Applies a handle drag in frame NIS. Edges are clamped to the frame and to
 * MIN_CROP_EDGE so a crop never collapses or inverts.
 */
export function resizeCrop(
  crop: CropRect,
  handle: CropHandle,
  deltaX: number,
  deltaY: number,
): CropRect {
  if (handle === 'move') {
    const x = clamp01(Math.min(crop.x + deltaX, 1 - crop.width));
    const y = clamp01(Math.min(crop.y + deltaY, 1 - crop.height));
    return { x, y, width: crop.width, height: crop.height };
  }

  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;

  if (handle.includes('w')) left = Math.min(clamp01(left + deltaX), right - MIN_CROP_EDGE);
  if (handle.includes('e')) right = Math.max(clamp01(right + deltaX), left + MIN_CROP_EDGE);
  if (handle.includes('n')) top = Math.min(clamp01(top + deltaY), bottom - MIN_CROP_EDGE);
  if (handle.includes('s')) bottom = Math.max(clamp01(bottom + deltaY), top + MIN_CROP_EDGE);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Keyboard nudge: arrows resize the handle edge, Shift+arrows use a coarse step. */
export function nudgeCrop(
  crop: CropRect,
  handle: CropHandle,
  key: string,
  coarse: boolean,
): CropRect | null {
  const step = coarse ? CROP_KEYBOARD_STEP * 10 : CROP_KEYBOARD_STEP;
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  if (dx === 0 && dy === 0) return null;
  if (handle === 'move') return resizeCrop(crop, 'move', dx, dy);

  // Edge handles only respond along their own axis so arrow keys stay predictable.
  const horizontalEdge = handle.includes('w') || handle.includes('e');
  const verticalEdge = handle.includes('n') || handle.includes('s');
  const effectiveX = horizontalEdge ? dx : 0;
  const effectiveY = verticalEdge ? dy : 0;
  if (effectiveX === 0 && effectiveY === 0) return null;
  return resizeCrop(crop, handle, effectiveX, effectiveY);
}
