import type { LocalStageGroup, LocalStagePlan } from '../local/maskRaster';
import { LOCAL_STAGE_TEXTURE_BASE } from '../local/maskRaster';

export type { LocalStageGroup, LocalStagePlan };

/** Renderer texture units 0..4 are taken (image, LUT, date stamp, curves, graded detail). */
export const LOCAL_STAGE_MASK_TEXTURE_BASE = LOCAL_STAGE_TEXTURE_BASE;
export const LOCAL_STAGE_MAX_GROUPS = 8;

export function hasLocalStagePlan(value: LocalStagePlan | null | undefined): value is LocalStagePlan {
  return !!value;
}