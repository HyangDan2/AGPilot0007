import { renderSourceStage } from '../optical/sourceStage';
import type { PreviewRequestFlags, RenderPipelineBackend, RenderPipelineFrame } from '../pipeline/renderPipeline';
import type { RenderRequest } from '../pipeline/renderSettings';
import type { WebGL2FilmRenderer } from './webglRenderer';

const DEFAULT_EXTRAS: PreviewRequestFlags = {
  compareMode: 'none',
  splitPos: 1,
  seed: 42,
  sharpeningMask: false,
  sharpeningDraft: false,
  mixerReference: false,
  mixerVisualize: null,
};

/** WebGL2 texture uploads above this size are refused by the source stage. */
export const MAX_SOURCE_STAGE_DIMENSION = 8192;

export function sourceStageWithinLimit(sourceWidth: number, sourceHeight: number): boolean {
  return sourceWidth <= MAX_SOURCE_STAGE_DIMENSION && sourceHeight <= MAX_SOURCE_STAGE_DIMENSION;
}

export interface WebGLPipelineBackend extends RenderPipelineBackend {
  /** Drop the cached warped canvas after context loss or a renderer rebuild. */
  resetSourceStage(): void;
}

export function buildRenderRequest(frame: RenderPipelineFrame): RenderRequest {
  const extras = frame.extras ?? DEFAULT_EXTRAS;
  return {
    ...frame.settings,
    compareMode: extras.compareMode,
    splitPos: extras.splitPos,
    seed: extras.seed ?? 42,
    sourceWidth: extras.sourceWidth,
    sourceHeight: extras.sourceHeight,
    sharpeningMask: extras.sharpeningMask,
    sharpeningDraft: extras.sharpeningDraft,
    mixerReference: extras.mixerReference,
    mixerVisualize: extras.mixerVisualize ?? null,
  };
}

function intrinsicSize(frame: RenderPipelineFrame): { width: number; height: number } | null {
  if (frame.sourceWidth && frame.sourceHeight) {
    return { width: frame.sourceWidth, height: frame.sourceHeight };
  }
  const source = frame.source as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const width = source?.naturalWidth ?? source?.width;
  const height = source?.naturalHeight ?? source?.height;
  return width && height ? { width, height } : null;
}

/**
 * Adapter between the plan executor and the existing WebGL2 renderer. When a
 * source is present the Q02 source stage warps geometry/optical first and the
 * renderer receives that canvas; identity or skipped stages keep the legacy
 * setImage path byte-for-byte.
 */
export function createWebGLPipelineBackend(renderer: WebGL2FilmRenderer, options: { warn?: (message: string) => void } = {}): WebGLPipelineBackend {
  let appliedCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  let warnedOversize = false;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  return {
    resetSourceStage() {
      appliedCanvas = null;
    },
    render(frame) {
      const source = frame.source;
      if (source) {
        const size = intrinsicSize(frame);
        if (size && !sourceStageWithinLimit(size.width, size.height)) {
          if (!warnedOversize) {
            warnedOversize = true;
            warn(
              `Source stage skipped: ${size.width}x${size.height} exceeds the ${MAX_SOURCE_STAGE_DIMENSION}px WebGL2 safety limit; using the legacy texture path.`,
            );
          }
        } else if (size) {
          const result = renderSourceStage({
            source,
            sourceWidth: size.width,
            sourceHeight: size.height,
            output: { width: frame.width, height: frame.height },
            geometry: frame.settings.geometry,
            optical: frame.settings.optical,
            masks: frame.settings.masks,
          });
          if (result) {
            if (result.canvas !== appliedCanvas) {
              renderer.setImage(result.canvas, result.width, result.height);
              appliedCanvas = result.canvas;
            }
          } else if (appliedCanvas) {
            renderer.setImage(source as TexImageSource, size.width, size.height);
            appliedCanvas = null;
          }
        }
      }
      renderer.render(buildRenderRequest(frame));
    },
  };
}
