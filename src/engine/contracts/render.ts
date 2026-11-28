import type { RenderSettings } from '../pipeline/renderSettings';
import type { ImageBuffer } from './imageBuffer';
import type { RenderPlan, RenderTargetKind } from './renderPlan';

/**
 * Preview-only render request flags. These never persist to recipes and must
 * not influence exported pixels; export always uses compareMode 'none'.
 */
export const PREVIEW_ONLY_REQUEST_FLAGS = [
  'compareMode',
  'splitPos',
  'sharpeningMask',
  'sharpeningDraft',
  'mixerReference',
  'mixerVisualize',
] as const;

export interface RenderContext {
  target: RenderTargetKind;
  width: number;
  height: number;
  dpr: number;
  source: ImageBuffer;
  settings: RenderSettings;
  plan: RenderPlan;
  signal?: AbortSignal;
}

export interface RenderBackend {
  readonly target: RenderTargetKind;
  render(context: RenderContext): Promise<void> | void;
  dispose(): void;
}
