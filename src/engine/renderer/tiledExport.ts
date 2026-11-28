import { FILM_PROFILES } from '../../films/registry';
import { loadCubeLut, type ParsedLut3D } from '../color/lutLoader';
import { decideResourceAllocation, createResourceBudget } from '../contracts/resourceBudget';
import type { DecodedImage } from '../image/decoder';
import { resolveDecodedImageOriginal } from '../image/decoder';
import { createQ02RenderRegistry } from '../optical/modules';
import { geometryOutputSize } from '../optical/geometry';
import { renderSourceStage, type Q02SourceStageSource } from '../optical/sourceStage';
import { assertRenderPlanParity, runRenderPipeline, type RenderPipelineSource } from '../pipeline/renderPipeline';
import type { RenderSettings } from '../pipeline/renderSettings';
import { WebGL2FilmRenderer } from './webglRenderer';
import { createWebGLPipelineBackend } from './webglPipelineBackend';

export interface TiledRenderOptions {
  image: DecodedImage;
  settings: RenderSettings;
  maxTextureSize: number;
  budgetBytes: number;
  /** Tile overlap in pixels; seams blend across the overlap. */
  overlap: number;
}

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TilePlan {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  overlap: number;
  tiles: TileRect[];
}

export interface TiledRenderDeps {
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  createRenderer?: (canvas: HTMLCanvasElement) => WebGL2FilmRenderer;
  loadLut?: (settings: RenderSettings) => Promise<ParsedLut3D>;
  /** Receives the tile geometry actually rendered (single tile when it fits). */
  onPlan?: (plan: TilePlan) => void;
}

const MIN_TILE_EDGE = 256;

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${label} dimensions`);
}

/**
 * Splits a frame into overlapping tiles no larger than `maxTileEdge`. Each tile
 * is a core rect; neighbours overlap by `overlap` pixels so the compositor can
 * blend a seam. A frame that already fits yields a single full-frame tile.
 */
export function planTiles(frameWidth: number, frameHeight: number, maxTileEdge: number, overlap: number): TilePlan {
  assertDimension(frameWidth, 'tile frame');
  assertDimension(frameHeight, 'tile frame');
  if (!Number.isFinite(maxTileEdge)) throw new Error('Invalid tile edge');
  const edge = Math.max(1, Math.floor(maxTileEdge));
  const requestedOverlap = Number.isFinite(overlap) ? Math.max(0, Math.floor(overlap)) : 0;
  const blend = Math.min(requestedOverlap, Math.floor((edge - 1) / 2));
  if (edge >= frameWidth && edge >= frameHeight) {
    return {
      columns: 1,
      rows: 1,
      tileWidth: frameWidth,
      tileHeight: frameHeight,
      overlap: 0,
      tiles: [{ x: 0, y: 0, width: frameWidth, height: frameHeight }],
    };
  }
  const step = edge - blend;
  const axis = (length: number): number[] => {
    const starts: number[] = [];
    for (let offset = 0; offset < length; offset += step) {
      starts.push(offset);
      if (offset + edge >= length) break;
    }
    return starts;
  };
  const xs = axis(frameWidth);
  const ys = axis(frameHeight);
  const tiles: TileRect[] = [];
  for (const y of ys) {
    for (const x of xs) {
      tiles.push({
        x,
        y,
        width: Math.min(edge, frameWidth - x),
        height: Math.min(edge, frameHeight - y),
      });
    }
  }
  return {
    columns: xs.length,
    rows: ys.length,
    tileWidth: Math.min(edge, frameWidth),
    tileHeight: Math.min(edge, frameHeight),
    overlap: blend,
    tiles,
  };
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

/** Copies the GL result so it survives the renderer's explicit context loss. */
function copyCanvas(source: HTMLCanvasElement, createCanvas: (w: number, h: number) => HTMLCanvasElement): HTMLCanvasElement {
  const copy = createCanvas(source.width, source.height);
  context2d(copy, 'Tiled export').drawImage(source, 0, 0);
  return copy;
}

async function renderFullFrame(
  source: CanvasImageSource,
  image: DecodedImage,
  settings: RenderSettings,
  output: { width: number; height: number },
  lut: ParsedLut3D,
  registry: ReturnType<typeof createQ02RenderRegistry>,
  createCanvas: (w: number, h: number) => HTMLCanvasElement,
  createRenderer: (canvas: HTMLCanvasElement) => WebGL2FilmRenderer,
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(output.width, output.height);
  const renderer = createRenderer(canvas);
  if (!renderer.isReady()) {
    throw new Error('Failed to allocate a WebGL2 export context on this device.');
  }
  try {
    renderer.setImage(source as TexImageSource, output.width, output.height);
    renderer.setLut(lut);
    await runRenderPipeline(
      {
        target: 'export',
        width: output.width,
        height: output.height,
        dpr: 1,
        settings,
        source: source as RenderPipelineSource,
        sourceWidth: image.originalWidth,
        sourceHeight: image.originalHeight,
        registry,
        extras: { compareMode: 'none', splitPos: 1, seed: 42 },
      },
      createWebGLPipelineBackend(renderer),
    );
    return copyCanvas(canvas, createCanvas);
  } finally {
    renderer.destroy();
  }
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
 * Feathered composite of one rendered crop. Only the tile core is drawn; the
 * crop margin exists so optical taps sample real neighbours. Leading edges
 * (left/top) fade over the core's overlap band so the previously drawn tile
 * shows through, while trailing edges stay opaque for the next tile.
 */
function compositeTile(
  target: CanvasRenderingContext2D,
  rendered: HTMLCanvasElement,
  crop: TileRect,
  tile: TileRect,
  overlap: number,
  createCanvas: (w: number, h: number) => HTMLCanvasElement,
): void {
  const scratch = createCanvas(crop.width, crop.height);
  const context = context2d(scratch, 'Tiled export');
  context.drawImage(rendered, 0, 0);
  const leadX = tile.x - crop.x;
  const leadY = tile.y - crop.y;
  if (overlap > 0) {
    // destination-in multiplies the whole canvas, so each gradient must span
    // full height/width and rely on stop clamping outside the fade band.
    const applyFade = (gradient: CanvasGradient): void => {
      context.fillStyle = gradient;
      context.fillRect(0, 0, crop.width, crop.height);
    };
    context.globalCompositeOperation = 'destination-in';
    if (tile.x > 0) {
      const gradient = context.createLinearGradient(leadX, 0, leadX + Math.min(overlap, tile.width), 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(1, 'rgba(255,255,255,1)');
      applyFade(gradient);
    }
    if (tile.y > 0) {
      const gradient = context.createLinearGradient(0, leadY, 0, leadY + Math.min(overlap, tile.height));
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(1, 'rgba(255,255,255,1)');
      applyFade(gradient);
    }
    context.globalCompositeOperation = 'source-over';
  }
  target.drawImage(scratch, leadX, leadY, tile.width, tile.height, tile.x, tile.y, tile.width, tile.height);
}

/**
 * CP4 tiled-export seam: renders images larger than MAX_TEXTURE_SIZE or the
 * memory budget in overlapping tiles, blends seams, and stays within
 * `resourceBudget`. Preview and export share the pipeline; only the tile edge
 * differs. Frames that fit render in one pass, identical to `prepareExportImage`.
 */
export async function renderTiled(options: TiledRenderOptions, deps: TiledRenderDeps = {}): Promise<HTMLCanvasElement> {
  const { image, settings, maxTextureSize, budgetBytes } = options;
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;
  const createRenderer = deps.createRenderer ?? ((canvas: HTMLCanvasElement) => new WebGL2FilmRenderer(canvas));
  const loadLut = deps.loadLut ?? ((value: RenderSettings) => loadCubeLut(filmLutPath(value)));

  const source = await resolveDecodedImageOriginal(image);
  const output = geometryOutputSize(settings.geometry, image.originalWidth, image.originalHeight);
  const registry = createQ02RenderRegistry();
  assertRenderPlanParity(settings, registry);

  const budget = createResourceBudget({
    maxGpuBytes: Math.max(1, Math.floor(budgetBytes)),
    maxTextureSize: Math.max(1, Math.floor(maxTextureSize)),
  });
  const decision = decideResourceAllocation(
    { width: output.width, height: output.height, format: 'rgba8', floatIntermediate: false, mode: 'export' },
    budget,
  );
  if (!decision.allowed) {
    throw new Error(decision.message ?? 'This export exceeds the available graphics budget.');
  }

  const lut = await loadLut(settings);

  if (decision.quality !== 'tile') {
    deps.onPlan?.({
      columns: 1,
      rows: 1,
      tileWidth: output.width,
      tileHeight: output.height,
      overlap: 0,
      tiles: [{ x: 0, y: 0, width: output.width, height: output.height }],
    });
    return renderFullFrame(source, image, settings, output, lut, registry, createCanvas, createRenderer);
  }

  if (settings.localAdjustments || settings.localStage) {
    throw new Error('Tiled export does not support local adjustments yet.');
  }

  const requestedOverlap = Number.isFinite(options.overlap) ? Math.max(0, Math.floor(options.overlap)) : 0;
  const shortSide = Math.min(output.width, output.height);
  // Optical taps sample neighbours inside the tile crop, so the crop margin
  // must cover the widest kernel even when the caller asks for no blend.
  const margin = Math.max(requestedOverlap, Math.ceil(0.004 * shortSide) + 2);
  const maxCropEdge = Math.min(maxTextureSize, Math.floor(Math.sqrt(budget.maxGpuBytes / 4)));
  const maxTileEdge = maxCropEdge - 2 * margin;
  if (maxTileEdge < MIN_TILE_EDGE) {
    throw new Error(
      `This export cannot be tiled within the graphics budget (tile edge ${Math.max(0, maxTileEdge)}px).`,
    );
  }
  const plan = planTiles(output.width, output.height, Math.min(decision.tile?.width ?? maxTileEdge, maxTileEdge), requestedOverlap);
  deps.onPlan?.(plan);
  const corrected = correctedFrame(source, image, settings, output);
  const tileSettings: RenderSettings = {
    ...settings,
    geometry: undefined,
    optical: undefined,
    masks: undefined,
    localAdjustments: undefined,
    localStage: undefined,
  };

  const target = createCanvas(output.width, output.height);
  const targetContext = context2d(target, 'Tiled export');

  for (const tile of plan.tiles) {
    const cropX = Math.max(0, tile.x - margin);
    const cropY = Math.max(0, tile.y - margin);
    const cropRight = Math.min(output.width, tile.x + tile.width + margin);
    const cropBottom = Math.min(output.height, tile.y + tile.height + margin);
    const crop: TileRect = { x: cropX, y: cropY, width: cropRight - cropX, height: cropBottom - cropY };

    if (crop.width > maxTextureSize || crop.height > maxTextureSize) {
      throw new Error(`This export cannot be tiled within the ${maxTextureSize}px texture limit.`);
    }

    const cropCanvas = createCanvas(crop.width, crop.height);
    context2d(cropCanvas, 'Tiled export').drawImage(
      corrected,
      cropX,
      cropY,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );

    const tileCanvas = createCanvas(crop.width, crop.height);
    const renderer = createRenderer(tileCanvas);
    if (!renderer.isReady()) {
      throw new Error('Failed to allocate a WebGL2 export context on this device.');
    }
    let rendered: HTMLCanvasElement;
    try {
      renderer.setImage(cropCanvas, crop.width, crop.height);
      renderer.setLut(lut);
      await runRenderPipeline(
        {
          target: 'export',
          width: crop.width,
          height: crop.height,
          dpr: 1,
          settings: tileSettings,
          source: cropCanvas,
          sourceWidth: crop.width,
          sourceHeight: crop.height,
          registry,
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
      rendered = copyCanvas(tileCanvas, createCanvas);
    } finally {
      renderer.destroy();
    }
    compositeTile(targetContext, rendered, crop, tile, plan.overlap, createCanvas);
  }

  return target;
}
