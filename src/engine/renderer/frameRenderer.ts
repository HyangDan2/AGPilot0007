import type { RenderSettings } from '../pipeline/renderSettings';

/**
 * CP4 frame-grading seam: textures upload per frame, the LUT uploads once, and
 * GL resources are reused across frames. Q03's video engine drives it.
 */
export interface VideoFrameRenderer {
  renderFrame(frame: VideoFrame | ImageBitmap): Promise<void>;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** Stub until CP4-01b implements the per-frame pipeline. */
export function createVideoFrameRenderer(_canvas: HTMLCanvasElement, _settings: RenderSettings): VideoFrameRenderer {
  throw new Error('createVideoFrameRenderer is not implemented yet (CP4-01b)');
}
