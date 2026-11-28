import type { VideoFrameRenderer } from './types';

export interface CanvasFrameRenderer extends VideoFrameRenderer {
  readonly canvas: HTMLCanvasElement;
}/**
 * Plain 2D-canvas adapter used until Q01's graded WebGL2 renderer (CP4-01b) is mounted.
 * It letterbox-free stretches to the configured output size; grading is the renderer's job.
 */
export function createCanvasFrameRenderer(width: number, height: number): CanvasFrameRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas context unavailable for video rendering');
  return {
    canvas,
    renderFrame(frame: CanvasImageSource) {
      ctx.drawImage(frame, 0, 0, width, height);
    },
    resize(w: number, h: number) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
