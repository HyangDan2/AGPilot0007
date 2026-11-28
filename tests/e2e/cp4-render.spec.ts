import { test, expect } from '@playwright/test';

/**
 * CP4-01b GPU seams. Real pixels only: happy-dom canvases cannot be uploaded to
 * WebGL, so the identity/tiling contract is verified in Chromium.
 */
test.describe('CP4 frame and tiled renderers', () => {
  // Software GL in headless shell takes ~6 s per full render stage.
  test.setTimeout(240_000);
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebGL export parity runs on Chromium only');

  test('tiled export equals the single-pass export and blends seams', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { renderTiled } = await import('../../src/engine/renderer/tiledExport');
      const { prepareExportImage } = await import('../../src/engine/export/imageExporter');
      const { loadCubeLut } = await import('../../src/engine/color/lutLoader');
      const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');
      const { normalizeCamera } = await import('../../src/types/camera');
      const { normalizeSharpening } = await import('../../src/types/sharpening');
      const { WebGL2FilmRenderer } = await import('../../src/engine/renderer/webglRenderer');
      const { assertRenderPlanParity, runRenderPipeline } = await import('../../src/engine/pipeline/renderPipeline');
      const { createQ02RenderRegistry } = await import('../../src/engine/optical/modules');
      const { createWebGLPipelineBackend } = await import('../../src/engine/renderer/webglPipelineBackend');

      const makeSource = (width: number, height: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#0d1b2a');
        gradient.addColorStop(0.5, '#c87941');
        gradient.addColorStop(1, '#f3e9dc');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = `hsl(${i * 36}, 60%, ${25 + (i % 4) * 12}%)`;
          ctx.fillRect(6 + i * (width / 12), 12 + (i % 5) * (height / 6), width / 14, height / 8);
        }
        return canvas;
      };

      const W = 500;
      const H = 300;
      const source = makeSource(W, H);
      const image = {
        name: 'cp4.png',
        originalWidth: W,
        originalHeight: H,
        originalElement: source,
      } as any;

      const settings: any = {
        filmId: 'FS-001',
        adjustments: {
          ...DEFAULT_ADJUSTMENTS,
          exposure: 0.15, contrast: 10, saturation: 8, filmStrength: 90,
          grain: 0, vignette: 28, highlights: -8, shadows: 6,
        },
        camera: normalizeCamera({
          dateStamp: {
            enabled: true, date: '2026-11-27', source: 'manual', format: 'compact',
            position: 'bottom-right', size: 3, color: '#ffb347', glow: 30, opacity: 80,
          },
          optics: { glow: 12, halation: 6, softness: 6, quality: 'standard' },
        }),
        sharpening: normalizeSharpening({ amount: 45, radius: 1.1, detail: 35, masking: 18, mode: 'advanced' }),
      };

      const readCanvas = (canvas: HTMLCanvasElement) => {
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d')!;
        ctx.drawImage(canvas, 0, 0);
        return { data: ctx.getImageData(0, 0, copy.width, copy.height).data, width: copy.width, height: copy.height };
      };

      const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let max = 0;
        let sum = 0;
        let count = 0;
        for (let i = 0; i < a.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(a[i + c] - b[i + c]);
            max = Math.max(max, d);
            sum += d;
            count += 1;
          }
        }
        return { max, mean: sum / Math.max(1, count) };
      };

      // 1) Frame fits: renderTiled single pass must match the real export path.
      const SMALL_W = 240;
      const SMALL_H = 160;
      const smallSource = makeSource(SMALL_W, SMALL_H);
      const smallImage = { name: 'small.png', originalWidth: SMALL_W, originalHeight: SMALL_H, originalElement: smallSource } as any;
      const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
      const smallSettings: any = { ...settings, adjustments: { ...settings.adjustments, grain: 18 } };

      const single = await renderTiled(
        { image: smallImage, settings: smallSettings, maxTextureSize: 4096, budgetBytes: 512 * 1024 * 1024, overlap: 0 },
      );
      const singleData = readCanvas(single);

      const prepared = await prepareExportImage(smallImage, lut, smallSettings, { format: 'image/png', quality: 1, scale: 1 });
      const bitmap = await createImageBitmap(prepared.blob);
      const decoded = document.createElement('canvas');
      decoded.width = SMALL_W;
      decoded.height = SMALL_H;
      const dctx = decoded.getContext('2d')!;
      dctx.drawImage(bitmap, 0, 0);
      const exportData = dctx.getImageData(0, 0, SMALL_W, SMALL_H).data;
      bitmap.close();
      URL.revokeObjectURL(prepared.objectUrl);
      const identityDiff = diff(singleData.data, exportData);

      // 2) Same frame rendered as a full-frame tile must be pixel-identical to
      //    the non-tiled shader path (frame-coordinate mapping is a no-op).
      const renderDirect = async (tile?: { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number }) => {
        const canvas = document.createElement('canvas');
        canvas.width = SMALL_W;
        canvas.height = SMALL_H;
        const renderer = new WebGL2FilmRenderer(canvas);
        const registry = createQ02RenderRegistry();
        assertRenderPlanParity(smallSettings, registry);
        renderer.setImage(smallSource, SMALL_W, SMALL_H);
        renderer.setLut(lut);
        await runRenderPipeline(
          {
            target: 'export', width: SMALL_W, height: SMALL_H, dpr: 1, settings: smallSettings,
            source: smallSource, sourceWidth: SMALL_W, sourceHeight: SMALL_H, registry,
            ...(tile ? { tile } : {}),
            extras: { compareMode: 'none', splitPos: 1, seed: 42 },
          },
          createWebGLPipelineBackend(renderer),
        );
        const pixels = readCanvas(canvas).data;
        renderer.destroy();
        return pixels;
      };
      const framePixels = await renderDirect();
      const fullTilePixels = await renderDirect({ x: 0, y: 0, width: SMALL_W, height: SMALL_H, frameWidth: SMALL_W, frameHeight: SMALL_H });
      const fullTileDiff = diff(framePixels, fullTilePixels);

      // 3) Tiled path: 500x300 split into two columns, blended across an overlap.
      const tiled = await renderTiled({ image, settings, maxTextureSize: 300, budgetBytes: 8 * 1024 * 1024, overlap: 8 });
      const tiledData = readCanvas(tiled);
      const reference = await renderTiled({ image, settings, maxTextureSize: 4096, budgetBytes: 512 * 1024 * 1024, overlap: 0 });
      const referenceData = readCanvas(reference);
      const tiledDiff = diff(tiledData.data, referenceData.data);
      const nonBlank = Array.prototype.some.call(tiledData.data, (value: number) => value > 0);
      return {
        singleSize: { width: singleData.width, height: singleData.height },
        identityDiff,
        fullTileDiff,
        tiledSize: { width: tiledData.width, height: tiledData.height },
        tiledDiff,
        nonBlank,
      };
    });

    expect(result.singleSize).toEqual({ width: 240, height: 160 });
    expect(result.identityDiff.max).toBeLessThanOrEqual(1);
    expect(result.fullTileDiff.max).toBeLessThanOrEqual(1);
    expect(result.tiledSize).toEqual({ width: 500, height: 300 });
    expect(result.nonBlank).toBe(true);
    expect(result.tiledDiff.max).toBeLessThanOrEqual(4);
    expect(result.tiledDiff.mean).toBeLessThanOrEqual(0.5);
  });

  test('video frame renderer uploads per frame with the LUT loaded once', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { createVideoFrameRenderer } = await import('../../src/engine/renderer/frameRenderer');
      const { loadCubeLut } = await import('../../src/engine/color/lutLoader');
      const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');

      const W = 192;
      const H = 108;
      const source = document.createElement('canvas');
      source.width = W;
      source.height = H;
      const ctx = source.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, '#12314a');
      gradient.addColorStop(1, '#e8c39e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);

      const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
      let lutCalls = 0;
      const canvas = document.createElement('canvas');
      const renderer = createVideoFrameRenderer(
        canvas,
        { filmId: 'FS-001', adjustments: { ...DEFAULT_ADJUSTMENTS, grain: 25, filmStrength: 90 } } as any,
        { loadLut: async () => { lutCalls += 1; return lut; } },
      );

      const read = () => {
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const cctx = copy.getContext('2d')!;
        cctx.drawImage(canvas, 0, 0);
        return { data: cctx.getImageData(0, 0, copy.width, copy.height).data, width: copy.width, height: copy.height };
      };

      const frame = new VideoFrame(source, { timestamp: 0 });
      await renderer.renderFrame(frame);
      const first = read();
      await renderer.renderFrame(frame);
      await renderer.renderFrame(frame);
      const third = read();
      frame.close();

      let grainDelta = 0;
      for (let i = 0; i < first.data.length; i += 4) {
        grainDelta = Math.max(grainDelta, Math.abs(first.data[i] - third.data[i]));
        grainDelta = Math.max(grainDelta, Math.abs(first.data[i + 1] - third.data[i + 1]));
        grainDelta = Math.max(grainDelta, Math.abs(first.data[i + 2] - third.data[i + 2]));
      }

      renderer.resize(320, 180);
      const resized = read();
      renderer.dispose();
      let disposedError = '';
      try {
        await renderer.renderFrame(new VideoFrame(source, { timestamp: 1 }));
      } catch (error) {
        disposedError = (error as Error).message;
      }

      return {
        firstSize: { width: first.width, height: first.height },
        resizedSize: { width: resized.width, height: resized.height },
        lutCalls,
        grainDelta,
        nonBlank: Array.prototype.some.call(first.data, (value: number) => value > 0),
        disposedError,
      };
    });

    expect(result.firstSize).toEqual({ width: 192, height: 108 });
    expect(result.resizedSize).toEqual({ width: 320, height: 180 });
    expect(result.lutCalls).toBe(1);
    expect(result.nonBlank).toBe(true);
    expect(result.grainDelta).toBeGreaterThan(0);
    expect(result.disposedError).toContain('disposed');
  });
});
