import { renderSourceStage, type Q02SourceStageSource } from '../optical/sourceStage';
import {
  localStageCacheKey,
  planLocalStage,
  type LocalStagePlan,
} from '../local/maskRaster';
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
  // A null plan must not add a key to the request; only a real plan travels.
  const { localStage, ...settings } = frame.settings;
  return {
    ...settings,
    ...(localStage ? { localStage } : {}),
    compareMode: extras.compareMode,
    splitPos: extras.splitPos,
    seed: extras.seed ?? 42,
    sourceWidth: extras.sourceWidth,
    sourceHeight: extras.sourceHeight,
    sharpeningMask: extras.sharpeningMask,
    sharpeningDraft: extras.sharpeningDraft,
    mixerReference: extras.mixerReference,
    mixerVisualize: extras.mixerVisualize ?? null,
    ...(frame.tile ? { tile: frame.tile } : {}),
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

function isCanvasImageSource(value: unknown): value is CanvasImageSource {
  return (
    (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) ||
    (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
    (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) ||
    (typeof VideoFrame !== 'undefined' && value instanceof VideoFrame)
  );
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

  // Plans rasterize masks from corrected pixels, so they are built once per
  // (state, output size, corrected canvas) and reused across frames.
  let planCache: {
    key: string;
    width: number;
    height: number;
    corrected: CanvasImageSource;
    plan: LocalStagePlan | null;
  } | null = null;

  const resolveLocalPlan = (frame: RenderPipelineFrame, corrected: CanvasImageSource | null): LocalStagePlan | null => {
    const state = frame.settings.localAdjustments;
    const key = state ? localStageCacheKey(state) : null;
    if (!state || !key || !corrected) {
      planCache = null;
      return null;
    }
    if (
      !planCache ||
      planCache.key !== key ||
      planCache.width !== frame.width ||
      planCache.height !== frame.height ||
      planCache.corrected !== corrected
    ) {
      planCache = {
        key,
        width: frame.width,
        height: frame.height,
        corrected,
        plan: planLocalStage({ state, width: frame.width, height: frame.height, corrected }),
      };
    }
    return planCache.plan;
  };

  return {
    resetSourceStage() {
      appliedCanvas = null;
      planCache = null;
    },
    render(frame) {
      const source = frame.source;
      let corrected: CanvasImageSource | null = null;
      if (source) {
        const size = intrinsicSize(frame);
        if (size && !sourceStageWithinLimit(size.width, size.height)) {
          if (!warnedOversize) {
            warnedOversize = true;
            warn(
              `Source stage skipped: ${size.width}x${size.height} exceeds the ${MAX_SOURCE_STAGE_DIMENSION}px WebGL2 safety limit; using the legacy texture path.`,
            );
          }
          if (isCanvasImageSource(source)) corrected = source;
        } else if (size) {
          const result = renderSourceStage({
            source: source as Q02SourceStageSource,
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
            corrected = result.canvas;
          } else {
            if (appliedCanvas) {
              renderer.setImage(source as TexImageSource, size.width, size.height);
              appliedCanvas = null;
            }
            if (isCanvasImageSource(source)) corrected = source;
          }
        }
      }
      const request = buildRenderRequest(frame);
      const localStage = resolveLocalPlan(frame, corrected);
      if (localStage) request.localStage = localStage;
      renderer.render(request);
    },
  };
}
