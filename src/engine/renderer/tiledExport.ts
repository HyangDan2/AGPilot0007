import type { DecodedImage } from '../image/decoder';
import type { RenderSettings } from '../pipeline/renderSettings';

export interface TiledRenderOptions {
  image: DecodedImage;
  settings: RenderSettings;
  maxTextureSize: number;
  budgetBytes: number;
  /** Tile overlap in pixels; seams blend across the overlap. */
  overlap: number;
}

/**
 * CP4 tiled-export seam: renders images larger than MAX_TEXTURE_SIZE or the
 * memory budget in overlapping tiles, blends seams, and stays within
 * `resourceBudget`. Preview and export share this pipeline; only tile size,
 * half-res and tap budget differ.
 */
export function renderTiled(_options: TiledRenderOptions): Promise<HTMLCanvasElement> {
  return Promise.reject(new Error('renderTiled is not implemented yet (CP4-01b)'));
}
