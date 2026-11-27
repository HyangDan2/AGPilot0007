import type { LocalAdjustmentValues } from '../contracts/localAdjustments';
import type { MaskBlend } from '../contracts/masks';

/**
 * Structural mirror of the frozen CP3 §3 seam (Q02 owns
 * `src/engine/local/maskRaster.ts` and `planLocalStage`). The pipeline only
 * carries the plan until 02E lands; it never rasterizes masks itself.
 * Groups are index-aligned with `LocalAdjustmentState.groups`.
 */
export interface LocalStageGroup {
  adjustment: LocalAdjustmentValues;
  opacity: number;
  blend: MaskBlend;
}

export interface LocalStagePlan {
  width: number;
  height: number;
  groups: LocalStageGroup[];
  /** One coverage canvas per group, index-aligned with `groups`. */
  masks: HTMLCanvasElement[];
}

/**
 * Renderer texture units 0..4 are taken (0 image, 1 LUT, 2 date stamp, 3
 * curves, 4 graded detail), so mask textures must start above them. The §3
 * note suggests 2..9 when only image/LUT are bound; the actual allocation is
 * reported to Q00 for a ruling before 02E.
 */
export const LOCAL_STAGE_MASK_TEXTURE_BASE = 5;
export const LOCAL_STAGE_MAX_GROUPS = 8;

export function hasLocalStagePlan(value: LocalStagePlan | null | undefined): value is LocalStagePlan {
  return !!value;
}