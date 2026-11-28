import { FILM_PROFILES } from '../../films/registry';
import { loadCubeLut, type ParsedLut3D } from '../color/lutLoader';
import type { RenderSettings } from '../pipeline/renderSettings';
import { runRenderPipeline, type RenderPipelineSource } from '../pipeline/renderPipeline';
import { createQ02RenderRegistry } from '../optical/modules';
import { WebGL2FilmRenderer } from './webglRenderer';
import { createWebGLPipelineBackend } from './webglPipelineBackend';

/**
 * CP4 frame-grading seam: textures upload per frame, the LUT uploads once, and
 * GL resources are reused across frames. Q03's video engine drives it; the
 * request goes through the same render pipeline as photo preview/export.
 */
export interface VideoFrameRenderer {
  renderFrame(frame: VideoFrame | ImageBitmap): Promise<void>;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface FrameRendererDeps {
  createRenderer?: (canvas: HTMLCanvasElement) => WebGL2FilmRenderer;
  loadLut?: (settings: RenderSettings) => Promise<ParsedLut3D>;
}

interface MaybeSizedFrame {
  displayWidth?: number;
  displayHeight?: number;
  width?: number;
  height?: number;
}

function frameSize(frame: VideoFrame | ImageBitmap): { width: number; height: number } {
  const sized = frame as unknown as MaybeSizedFrame;
  const width = sized.displayWidth || sized.width || 0;
  const height = sized.displayHeight || sized.height || 0;
  return { width, height };
}

function filmLutPath(settings: RenderSettings): string {
  const profile = settings.filmId ? FILM_PROFILES[settings.filmId] : undefined;
  return (profile ?? FILM_PROFILES.identity).lutFile;
}

export function createVideoFrameRenderer(
  canvas: HTMLCanvasElement,
  settings: RenderSettings,
  deps: FrameRendererDeps = {},
): VideoFrameRenderer {
  const createRenderer = deps.createRenderer ?? ((target: HTMLCanvasElement) => new WebGL2FilmRenderer(target));
  const loadLut = deps.loadLut ?? ((value: RenderSettings) => loadCubeLut(filmLutPath(value)));

  const renderer = createRenderer(canvas);
  if (!renderer.isReady()) {
    throw new Error('Failed to allocate a WebGL2 frame context on this device.');
  }
  const backend = createWebGLPipelineBackend(renderer);
  const registry = createQ02RenderRegistry();
  let disposed = false;
  let pinnedSize = false;
  let frameIndex = 0;
  let lutError: unknown = null;

  const lutReady = loadLut(settings).then(
    (lut) => {
      if (!disposed) renderer.setLut(lut);
    },
    (error) => {
      lutError = error;
    },
  );

  return {
    async renderFrame(frame) {
      if (disposed) throw new Error('Video frame renderer has been disposed.');
      await lutReady;
      if (lutError) throw lutError;
      if (disposed) throw new Error('Video frame renderer has been disposed.');
      const { width, height } = frameSize(frame);
      if (!width || !height) throw new Error('Invalid video frame dimensions.');
      if (!pinnedSize && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      // Upload every frame; the LUT texture and program stay resident.
      renderer.setImage(frame as unknown as TexImageSource, width, height);
      const seed = 42 + frameIndex * 7.31;
      frameIndex += 1;
      await runRenderPipeline(
        {
          target: 'export',
          width: canvas.width,
          height: canvas.height,
          dpr: 1,
          settings,
          source: frame as unknown as RenderPipelineSource,
          sourceWidth: width,
          sourceHeight: height,
          registry,
          extras: { compareMode: 'none', splitPos: 1, seed },
        },
        backend,
      );
    },
    resize(width, height) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error('Invalid frame renderer size.');
      }
      pinnedSize = true;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.destroy();
    },
  };
}
