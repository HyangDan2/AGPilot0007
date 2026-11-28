import { FILM_PROFILES } from '../../films/registry';
import { loadCubeLut, type ParsedLut3D } from '../color/lutLoader';
import { isNeutralLensBlur, type LensBlurCapability } from '../contracts/lensBlur';
import type { DecodedImage } from '../image/decoder';
import { resolveDecodedImageOriginal } from '../image/decoder';
import { assertRenderPlanParity, runRenderPipeline, type RenderPipelineSource } from '../pipeline/renderPipeline';
import type { RenderSettings } from '../pipeline/renderSettings';
import { WebGL2FilmRenderer } from '../renderer/webglRenderer';
import { createWebGLPipelineBackend } from '../renderer/webglPipelineBackend';
import { MAX_TAPS } from './lensBlur';
import { geometryOutputSize } from './geometry';
import {
  GPU_BYTES_PER_TILE_PIXEL,
  LENS_TILE_CORE_EDGE,
  MIN_LENS_TILE_EDGE,
  createLensTileTemplate,
  planLensTileStage,
  planLensTiles,
  type LensTileRegion,
} from './lensTiled';
import { createQ02RenderRegistry } from './modules';
import { renderSourceStage, type Q02SourceStageSource } from './sourceStage';

export {
  LENS_TILE_AUTO_PIXELS,
  LENS_TILE_CORE_EDGE,
  GPU_BYTES_PER_TILE_PIXEL,
  createLensTileTemplate,
  planLensTileStage,
  planLensTiles,
  shouldTileLensExport,
  type LensTile,
  type LensTileGrid,
  type LensTileRegion,
  type LensTileTemplate,
} from './lensTiled';

export interface LensTileRenderDeps {
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  createRenderer?: (canvas: HTMLCanvasElement) => WebGL2FilmRenderer;
  loadLut?: (settings: RenderSettings) => Promise<ParsedLut3D>;
  onPlan?: (plan: {
    columns: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
    overlap: number;
    tiles: LensTileRegion[];
  }) => void;
  onProgress?: (progress: number, stage: string) => void;
}

export interface LensTileRenderOptions {
  image: DecodedImage;
  settings: RenderSettings;
  maxTextureSize: number;
  budgetBytes: number;
  maxTileEdge?: number;
  signal?: AbortSignal;
}

function filmLutPath(settings: RenderSettings): string {
  const profile = settings.filmId ? FILM_PROFILES[settings.filmId] : undefined;
  return (profile ?? FILM_PROFILES.identity).lutFile;
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement, usage: string): CanvasRenderingContext2D {
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!context) throw new Error(`${usage} requires a 2D canvas context.`);
  return context;
}

function correctedFrame(
  source: CanvasImageSource,
  image: DecodedImage,
  settings: RenderSettings,
  output: { width: number; height: number },
): CanvasImageSource {
  const result = renderSourceStage({
    source: source as Q02SourceStageSource,
    sourceWidth: image.originalWidth,
    sourceHeight: image.originalHeight,
    output,
    geometry: settings.geometry,
    optical: settings.optical,
    masks: settings.masks,
  });
  return result ? result.canvas : source;
}

/**
 * Lens-ON tiled export. Each tile renders the full pipeline (including
 * frame-global grain/vignette/stamp through the tile region) with a per-crop
 * lens plan whose gather halo covers the PSF support, then only the core is
 * composited. One renderer is reused across tiles and the depth buffer is
 * pooled, so the frame never needs a full-resolution lens intermediate.
 */
export async function renderLensTiled(
  options: LensTileRenderOptions,
  deps: LensTileRenderDeps = {},
): Promise<HTMLCanvasElement> {
  const { image, settings, maxTextureSize, budgetBytes, signal } = options;
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const createRenderer = deps.createRenderer ?? ((canvas: HTMLCanvasElement) => new WebGL2FilmRenderer(canvas));
  const loadLut = deps.loadLut ?? ((value: RenderSettings) => loadCubeLut(filmLutPath(value)));

  const source = await resolveDecodedImageOriginal(image);
  const output = geometryOutputSize(settings.geometry, image.originalWidth, image.originalHeight);
  const registry = createQ02RenderRegistry();
  assertRenderPlanParity(settings, registry);

  const local = settings.localAdjustments;
  const localActive = !!local && local.enabled && local.groups.some((group) => group.enabled);
  if (settings.localStage || localActive) {
    throw new Error('Tiled export does not support local adjustments yet.');
  }

  const state = settings.lensBlur;
  if (!state || isNeutralLensBlur(state)) {
    throw new Error('Lens tiled export requires an active lens blur state');
  }
  const capability: LensBlurCapability = {
    maxTextureSize,
    maxTaps: MAX_TAPS,
  };
  const template = createLensTileTemplate({ ...state, quality: 'export' }, output, capability);

  const budgetEdge = Math.max(
    MIN_LENS_TILE_EDGE,
    Math.floor(Math.sqrt(Math.max(1, budgetBytes) / GPU_BYTES_PER_TILE_PIXEL)),
  );
  const halo = template ? template.halo : 0;
  const maxCropEdge = Math.max(MIN_LENS_TILE_EDGE, Math.min(maxTextureSize, budgetEdge));
  const requestedEdge = Math.floor(options.maxTileEdge ?? LENS_TILE_CORE_EDGE);
  const coreEdge = Math.max(
    MIN_LENS_TILE_EDGE,
    Math.min(requestedEdge, maxCropEdge - 2 * halo),
  );
  if (maxCropEdge - 2 * halo < MIN_LENS_TILE_EDGE) {
    throw new Error(
      `This export cannot be tiled within the graphics budget (tile edge ${Math.max(0, maxCropEdge - 2 * halo)}px).`,
    );
  }

  const grid = planLensTiles(output.width, output.height, coreEdge, halo);
  deps.onPlan?.({
    columns: grid.columns,
    rows: grid.rows,
    tileWidth: grid.coreEdge,
    tileHeight: grid.coreEdge,
    overlap: 0,
    tiles: grid.tiles.map((tile) => tile.core),
  });

  const lut = await loadLut(settings);
  const corrected = correctedFrame(source as CanvasImageSource, image, settings, output);
  const target = createCanvas(output.width, output.height);
  const targetContext = context2d(target, 'Lens tiled export');

  const tileSettings: RenderSettings = {
    ...settings,
    geometry: undefined,
    optical: undefined,
    masks: undefined,
    localAdjustments: undefined,
    localStage: undefined,
    lensStage: null,
  };

  let maxCropPixels = 0;
  for (const tile of grid.tiles) {
    maxCropPixels = Math.max(maxCropPixels, tile.crop.width * tile.crop.height);
  }
  const depthPool = template ? new Float32Array(maxCropPixels) : null;

  const tileCanvas = createCanvas(1, 1);
  const cropCanvas = createCanvas(1, 1);
  const renderer = createRenderer(tileCanvas);
  if (!renderer.isReady()) {
    throw new Error('Failed to allocate a WebGL2 export context on this device.');
  }
  renderer.setLut(lut);

  try {
    for (let index = 0; index < grid.tiles.length; index++) {
      if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
      const { core, crop } = grid.tiles[index];

      tileCanvas.width = crop.width;
      tileCanvas.height = crop.height;
      cropCanvas.width = crop.width;
      cropCanvas.height = crop.height;
      context2d(cropCanvas, 'Lens tiled export').drawImage(
        corrected,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );

      const lensStage = template
        ? planLensTileStage(template, output, crop, depthPool ?? undefined)
        : null;
      renderer.setImage(cropCanvas, crop.width, crop.height);
      await runRenderPipeline(
        {
          target: 'export',
          width: crop.width,
          height: crop.height,
          dpr: 1,
          settings: { ...tileSettings, lensStage },
          source: cropCanvas as RenderPipelineSource,
          sourceWidth: crop.width,
          sourceHeight: crop.height,
          registry,
          signal,
          tile: {
            x: crop.x,
            y: crop.y,
            width: crop.width,
            height: crop.height,
            frameWidth: output.width,
            frameHeight: output.height,
          },
          extras: { compareMode: 'none', splitPos: 1, seed: 42 },
        },
        createWebGLPipelineBackend(renderer),
      );

      const leadX = core.x - crop.x;
      const leadY = core.y - crop.y;
      targetContext.drawImage(
        tileCanvas,
        leadX,
        leadY,
        core.width,
        core.height,
        core.x,
        core.y,
        core.width,
        core.height,
      );
      deps.onProgress?.(90 * (index + 1) / grid.tiles.length, 'Rendering lens tiles...');
    }
  } finally {
    renderer.destroy();
    tileCanvas.width = 1;
    tileCanvas.height = 1;
    cropCanvas.width = 1;
    cropCanvas.height = 1;
  }

  return target;
}
