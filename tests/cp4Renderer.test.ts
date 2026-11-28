import { describe, expect, it, vi } from 'vitest';
import type { DecodedImage } from '../src/engine/image/decoder';
import type { RenderSettings } from '../src/engine/pipeline/renderSettings';
import { createVideoFrameRenderer } from '../src/engine/renderer/frameRenderer';
import { planTiles, renderTiled } from '../src/engine/renderer/tiledExport';
import { DEFAULT_ADJUSTMENTS } from '../src/types/film';
import type { ParsedLut3D } from '../src/engine/color/lutLoader';
import type { WebGL2FilmRenderer } from '../src/engine/renderer/webglRenderer';

interface FakeContext {
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  createLinearGradient: ReturnType<typeof vi.fn>;
  globalCompositeOperation: string;
  fillStyle: string;
}

interface FakeCanvas {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  ctx: FakeContext;
  getContext: (type: string) => FakeContext | null;
}

interface CanvasEvent {
  kind: 'draw' | 'destroy';
  at: number;
  source?: unknown;
  target?: unknown;
}

function fakeContext(onDraw?: (source: unknown) => void): FakeContext {
  return {
    drawImage: vi.fn((source: unknown) => {
      onDraw?.(source);
    }),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    globalCompositeOperation: 'source-over',
    fillStyle: '',
  };
}

/**
 * A real HTMLCanvasElement (so DOM-source checks pass) with a recording 2D
 * context; happy-dom does not implement one.
 */
function fakeCanvas(width = 1, height = 1, onDraw?: (source: unknown) => void): FakeCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = fakeContext(onDraw);
  const getContext = ((type: string) => (type === '2d' ? ctx : null)) as HTMLCanvasElement['getContext'];
  Object.defineProperty(canvas, 'getContext', { value: getContext });
  const fake: FakeCanvas = {
    canvas,
    get width() {
      return canvas.width;
    },
    set width(value: number) {
      canvas.width = value;
    },
    get height() {
      return canvas.height;
    },
    set height(value: number) {
      canvas.height = value;
    },
    ctx,
    getContext: getContext as unknown as (type: string) => FakeContext | null,
  };
  return fake;
}

function canvasFactory() {
  const canvases: FakeCanvas[] = [];
  const events: CanvasEvent[] = [];
  const createCanvas = vi.fn((width: number, height: number) => {
    const canvas = fakeCanvas(width, height, (source) =>
      events.push({ kind: 'draw', at: events.length, source, target: canvas.canvas }),
    );
    canvases.push(canvas);
    return canvas.canvas;
  });
  return { canvases, createCanvas, events };
}

interface FakeRenderer {
  canvas: HTMLCanvasElement;
  isReady: ReturnType<typeof vi.fn>;
  setImage: ReturnType<typeof vi.fn>;
  setLut: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function rendererFactory(events: CanvasEvent[] = []) {
  const renderers: FakeRenderer[] = [];
  const createRenderer = vi.fn((canvas: HTMLCanvasElement) => {
    const fake: FakeRenderer = {
      canvas,
      isReady: vi.fn(() => true),
      setImage: vi.fn(),
      setLut: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(() => {
        events.push({ kind: 'destroy', at: events.length, source: canvas });
      }),
    };
    renderers.push(fake);
    return fake as unknown as WebGL2FilmRenderer;
  });
  return { renderers, createRenderer };
}

const lut = { size: 33 } as ParsedLut3D;

function fakeImage(width: number, height: number): { image: DecodedImage; original: FakeCanvas } {
  const original = fakeCanvas(width, height);
  const image = {
    name: 'panorama.jpg',
    sourceUrl: 'blob:panorama',
    originalWidth: width,
    originalHeight: height,
    previewCanvas: fakeCanvas(64, 64),
    previewWidth: 64,
    previewHeight: 64,
    originalElement: original.canvas as unknown as HTMLImageElement,
  } as unknown as DecodedImage;
  return { image, original };
}

const identitySettings = (): RenderSettings => ({ adjustments: { ...DEFAULT_ADJUSTMENTS } });

describe('CP4 tiled planning', () => {
  it('keeps a frame that fits as a single full-frame tile', () => {
    const plan = planTiles(1000, 800, 4096, 32);
    expect(plan).toMatchObject({ columns: 1, rows: 1, tileWidth: 1000, tileHeight: 800 });
    expect(plan.tiles).toEqual([{ x: 0, y: 0, width: 1000, height: 800 }]);
  });

  it('splits oversized frames into overlapping tiles that cover every pixel', () => {
    const plan = planTiles(1000, 600, 400, 20);
    expect(plan.rows * plan.columns).toBe(plan.tiles.length);
    const covered = new Uint8Array(1000 * 600);
    for (const tile of plan.tiles) {
      expect(tile.width).toBeLessThanOrEqual(400);
      expect(tile.height).toBeLessThanOrEqual(400);
      expect(tile.x + tile.width).toBeLessThanOrEqual(1000);
      expect(tile.y + tile.height).toBeLessThanOrEqual(600);
      for (let y = tile.y; y < tile.y + tile.height; y++) {
        for (let x = tile.x; x < tile.x + tile.width; x++) covered[y * 1000 + x] = 1;
      }
    }
    expect(covered.every((value) => value === 1)).toBe(true);
    expect(plan.tiles.length).toBeGreaterThan(1);
    expect(plan.overlap).toBe(20);
  });

  it('clamps overlap below half the tile edge and rejects invalid sizes', () => {
    const plan = planTiles(900, 900, 400, 500);
    expect(plan.overlap).toBeLessThan(200);
    expect(plan.tiles.every((tile) => tile.width <= 400 && tile.height <= 400)).toBe(true);
    expect(() => planTiles(0, 100, 400, 10)).toThrow(/Invalid tile frame dimensions/);
    expect(() => planTiles(100, 100.5, 400, 10)).toThrow(/Invalid tile frame dimensions/);
  });
});

describe('CP4 renderTiled', () => {
  it('renders a frame that fits in one pass with the export request shape', async () => {
    const { image, original } = fakeImage(1000, 800);
    const { canvases, createCanvas } = canvasFactory();
    const onPlan = vi.fn();
    const { renderers, createRenderer } = rendererFactory();
    const loadLut = vi.fn(async () => lut);

    const result = await renderTiled(
      { image, settings: identitySettings(), maxTextureSize: 4096, budgetBytes: 64 * 1024 * 1024, overlap: 32 },
      { createCanvas, createRenderer, loadLut, onPlan },
    );

    expect(renderers).toHaveLength(1);
    const renderer = renderers[0];
    expect(renderer.setImage).toHaveBeenCalledWith(original.canvas, 1000, 800);
    expect(renderer.setLut).toHaveBeenCalledWith(lut);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    const request = renderer.render.mock.calls[0][0];
    expect(request.tile).toBeUndefined();
    expect(request.compareMode).toBe('none');
    expect(request.seed).toBe(42);
    expect(request.adjustments).toEqual(DEFAULT_ADJUSTMENTS);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    // The GL result is copied before the context is released.
    expect(result).toBe(canvases[1].canvas);
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(onPlan.mock.calls[0][0]).toMatchObject({ columns: 1, rows: 1, overlap: 0 });
    expect(canvases[1].width).toBe(1000);
    expect(canvases[1].ctx.drawImage).toHaveBeenCalledWith(canvases[0].canvas, 0, 0);
  });

  it('tiles oversized frames, passes full-frame coordinates and blends seams', async () => {
    const { image } = fakeImage(1000, 600);
    const { canvases, createCanvas, events } = canvasFactory();
    const { renderers, createRenderer } = rendererFactory(events);
    const loadLut = vi.fn(async () => lut);
    const onPlan = vi.fn();

    const result = await renderTiled(
      { image, settings: identitySettings(), maxTextureSize: 400, budgetBytes: 64 * 1024 * 1024, overlap: 20 },
      { createCanvas, createRenderer, loadLut, onPlan },
    );

    const plan = planTiles(1000, 600, 360, 20);
    expect(onPlan).toHaveBeenCalledWith(plan);
    expect(plan.columns).toBe(3);
    expect(renderers).toHaveLength(plan.tiles.length);
    for (const renderer of renderers) {
      expect(renderer.render).toHaveBeenCalledTimes(1);
      const request = renderer.render.mock.calls[0][0];
      expect(request.tile).toMatchObject({ frameWidth: 1000, frameHeight: 600 });
      expect(request.tile.width).toBeLessThanOrEqual(400);
      expect(request.tile.height).toBeLessThanOrEqual(400);
      expect(renderer.setImage).toHaveBeenCalledTimes(1);
      expect(renderer.setLut).toHaveBeenCalledTimes(1);
      expect(renderer.destroy).toHaveBeenCalledTimes(1);
      // The GL canvas must be copied while its context is alive: a draw from a
      // destroyed canvas is blank in real browsers.
      const copyIndex = events.findIndex((event) => event.kind === 'draw' && event.source === renderer.canvas);
      const destroyIndex = events.findIndex((event) => event.kind === 'destroy' && event.source === renderer.canvas);
      expect(copyIndex).toBeGreaterThanOrEqual(0);
      expect(copyIndex).toBeLessThan(destroyIndex);
      expect(events[copyIndex].target).not.toBe(canvases[0].canvas);
    }
    // Every tile also gets a feathered scratch composite into the frame canvas.
    expect(result).toBe(canvases[0].canvas);
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledTimes(plan.tiles.length);
    const gradients = canvases.filter((canvas) => canvas !== canvases[0] && canvas.ctx.createLinearGradient.mock.calls.length > 0);
    expect(gradients.length).toBeGreaterThan(0);
  });

  it('rejects tiled exports with local adjustments and unusable budgets', async () => {
    const { image } = fakeImage(1000, 600);
    const { createCanvas } = canvasFactory();
    const { createRenderer } = rendererFactory();
    const loadLut = vi.fn(async () => lut);
    const localSettings: RenderSettings = {
      ...identitySettings(),
      localAdjustments: { groups: [] } as never,
    };

    await expect(
      renderTiled(
        { image, settings: localSettings, maxTextureSize: 400, budgetBytes: 64 * 1024 * 1024, overlap: 20 },
        { createCanvas, createRenderer, loadLut },
      ),
    ).rejects.toThrow(/local adjustments/);

    await expect(
      renderTiled(
        { image, settings: identitySettings(), maxTextureSize: 8192, budgetBytes: 1024, overlap: 20 },
        { createCanvas, createRenderer, loadLut },
      ),
    ).rejects.toThrow(/graphics memory/);
  });

  it('fails loudly when no WebGL2 context is available', async () => {
    const { image } = fakeImage(400, 300);
    const { createCanvas } = canvasFactory();
    const { createRenderer } = rendererFactory();
    createRenderer.mockImplementation(
      () => ({ isReady: () => false, setImage: vi.fn(), setLut: vi.fn(), render: vi.fn(), destroy: vi.fn() }) as never,
    );

    await expect(
      renderTiled(
        { image, settings: identitySettings(), maxTextureSize: 4096, budgetBytes: 64 * 1024 * 1024, overlap: 32 },
        { createCanvas, createRenderer, loadLut: async () => lut },
      ),
    ).rejects.toThrow(/WebGL2 export context/);
  });
});

describe('CP4 createVideoFrameRenderer', () => {
  it('uploads one texture per frame and the LUT exactly once', async () => {
    const canvas = fakeCanvas(1, 1);
    const { renderers, createRenderer } = rendererFactory();
    const loadLut = vi.fn(async () => lut);
    const renderer = createVideoFrameRenderer(canvas.canvas, identitySettings(), {
      createRenderer,
      loadLut,
    });

    const frameA = fakeCanvas(320, 180).canvas as unknown as VideoFrame;
    await renderer.renderFrame(frameA);
    const frameB = fakeCanvas(320, 180).canvas as unknown as VideoFrame;
    await renderer.renderFrame(frameB);

    const gl = renderers[0];
    expect(loadLut).toHaveBeenCalledTimes(1);
    expect(gl.setLut).toHaveBeenCalledTimes(1);
    expect(gl.setImage).toHaveBeenNthCalledWith(1, frameA, 320, 180);
    expect(gl.setImage).toHaveBeenNthCalledWith(2, frameB, 320, 180);
    expect(gl.render).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(gl.render.mock.calls[1][0].seed).toBeGreaterThan(gl.render.mock.calls[0][0].seed);
    expect(gl.render.mock.calls[0][0].tile).toBeUndefined();

    renderer.dispose();
    expect(gl.destroy).toHaveBeenCalledTimes(1);
    await expect(renderer.renderFrame(frameA)).rejects.toThrow(/disposed/);
  });

  it('honors an explicit resize and surfaces LUT or context failures', async () => {
    const canvas = fakeCanvas(1, 1);
    const { renderers, createRenderer } = rendererFactory();
    const renderer = createVideoFrameRenderer(canvas.canvas, identitySettings(), {
      createRenderer,
      loadLut: async () => lut,
    });
    renderer.resize(640, 360);
    await renderer.renderFrame(fakeCanvas(320, 180).canvas as unknown as VideoFrame);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(renderers[0].render.mock.calls[0][0]).toMatchObject({ adjustments: DEFAULT_ADJUSTMENTS });
    renderer.dispose();

    const failing = createVideoFrameRenderer(fakeCanvas().canvas, identitySettings(), {
      createRenderer: (() => renderers[0]) as never,
      loadLut: async () => {
        throw new Error('lut unavailable');
      },
    });
    await expect(failing.renderFrame(fakeCanvas(16, 16).canvas as unknown as VideoFrame)).rejects.toThrow(/lut unavailable/);
    failing.dispose();

    expect(() =>
      createVideoFrameRenderer(fakeCanvas().canvas, identitySettings(), {
        createRenderer: (() => ({ isReady: () => false })) as never,
        loadLut: async () => lut,
      }),
    ).toThrow(/WebGL2 frame context/);
  });
});
