import { test, expect } from '@playwright/test';

/**
 * CP4-06: lens blur must actually reach pixels. The production renderer runs
 * Q02's gather as a post pass; `blurRgbaReference` is the oracle. Export runs
 * the real `prepareExportImage` path and is compared against lens blur off.
 */
test.describe('CP4-06 lens blur render wiring', () => {
  test.setTimeout(240_000);
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebGL lens blur parity runs on Chromium only');

  test('GPU post pass matches the Q02 reference at preview and export quality', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { WebGL2FilmRenderer } = await import('../../src/engine/renderer/webglRenderer');
      const { loadCubeLut } = await import('../../src/engine/color/lutLoader');
      const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');
      const { planLensBlur, blurRgbaReference } = await import('../../src/engine/optical/lensBlur');
      const { normalizeLensBlur } = await import('../../src/engine/contracts/lensBlur');
      const { assertRenderPlanParity, runRenderPipeline } = await import('../../src/engine/pipeline/renderPipeline');
      const { createQ02RenderRegistry } = await import('../../src/engine/optical/modules');
      const { createWebGLPipelineBackend } = await import('../../src/engine/renderer/webglPipelineBackend');

      // Soft structure only: the chunk and its CPU reference diverge at hard
      // color edges (Q02's own GLSL harness shows the same delta), which is not
      // a property of this integration.
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
        for (let i = 0; i < 6; i++) {
          const cx = 10 + i * (width / 7);
          const cy = 12 + (i % 3) * (height / 4);
          const blob = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.min(width, height) * 0.22);
          blob.addColorStop(0, `hsl(${i * 55}, 65%, 62%)`);
          blob.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = blob;
          ctx.fillRect(0, 0, width, height);
        }
        return canvas;
      };

      const W = 96;
      const H = 64;
      const source = makeSource(W, H);
      const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
      const baseSettings: any = {
        filmId: 'FS-001',
        adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.15, contrast: 10, vignette: 20 },
      };

      const render = async (width: number, height: number, lensStage?: unknown) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const renderer = new WebGL2FilmRenderer(canvas);
        const registry = createQ02RenderRegistry();
        assertRenderPlanParity(baseSettings, registry);
        renderer.setImage(source, width, height);
        renderer.setLut(lut);
        await runRenderPipeline(
          {
            target: 'export',
            width,
            height,
            dpr: 1,
            settings: lensStage ? { ...baseSettings, lensStage } : baseSettings,
            source,
            sourceWidth: width,
            sourceHeight: height,
            registry,
            extras: { compareMode: 'none', splitPos: 1, seed: 42 },
          },
          createWebGLPipelineBackend(renderer),
        );
        const raw = renderer.readPixels(0, 0, width, height)!;
        const oriented = new Uint8Array(raw.length);
        for (let y = 0; y < height; y++) oriented.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
        renderer.destroy();
        return oriented;
      };

      const depthMask = [{
        id: 'cp4-depth', name: 'Depth', enabled: true, blend: 'add' as const, opacity: 1, inverted: false,
        kind: 'radial' as const, center: { x: 0.5, y: 0.45 }, radiusX: 0.8, radiusY: 0.7, rotation: 0, feather: 0.6,
      }];

      const runQuality = async (quality: 'preview' | 'export', withDepth: boolean) => {
        const state = normalizeLensBlur({
          enabled: true, focusPlane: 0.4, focusRange: 0.12, aperture: 1.4, bladeCount: 6,
          rotationDeg: 0, quality, highlightBoost: 0.4, depthMask: withDepth ? depthMask : null,
        });
        const plan = planLensBlur(state, { width: W, height: H }, { maxTextureSize: 4096 });
        if (!plan) throw new Error('lens plan unexpectedly null');
        const off = await render(plan.width, plan.height);
        const src = new Float32Array(plan.width * plan.height * 4);
        for (let y = 0; y < plan.height; y++) {
          for (let x = 0; x < plan.width; x++) {
            const at = (y * plan.width + x) * 4;
            src[at] = off[at] / 255;
            src[at + 1] = off[at + 1] / 255;
            src[at + 2] = off[at + 2] / 255;
            src[at + 3] = off[at + 3] / 255;
          }
        }
        const cpu = blurRgbaReference(src, plan.width, plan.height, plan);
        const on = await render(plan.width, plan.height, plan);
        const margin = Math.min(
          Math.floor(Math.min(plan.width, plan.height) / 4),
          Math.ceil(plan.maxCocPx) + 3,
        );
        let parityMax = 0;
        let paritySum = 0;
        let parityCount = 0;
        let changedMax = 0;
        let changedSum = 0;
        for (let y = margin; y < plan.height - margin; y++) {
          for (let x = margin; x < plan.width - margin; x++) {
            const at = (y * plan.width + x) * 4;
            for (let c = 0; c < 3; c++) {
              const diff = Math.abs(on[at + c] / 255 - cpu[at + c]);
              parityMax = Math.max(parityMax, diff);
              paritySum += diff;
              parityCount += 1;
              const changed = Math.abs(on[at + c] - off[at + c]);
              changedMax = Math.max(changedMax, changed);
              changedSum += changed;
            }
          }
        }
        return {
          quality,
          withDepth,
          planSize: { width: plan.width, height: plan.height },
          tapCount: plan.tapCount,
          hasDepth: plan.depth !== null,
          changed: { max: changedMax / 255, mean: changedSum / parityCount / 255 },
          parity: { max: parityMax, mean: paritySum / parityCount },
        };
      };

      return {
        preview: await runQuality('preview', false),
        previewDepth: await runQuality('preview', true),
        exportNull: await runQuality('export', false),
        exportDepth: await runQuality('export', true),
      };
    });

    // Every tier really changes pixels (the post pass ran, not a dropped stage)
    // and stays within the chunk-vs-reference envelope measured on this scene.
    for (const run of [result.preview, result.previewDepth, result.exportNull, result.exportDepth]) {
      expect(run.tapCount).toBeGreaterThan(1);
      expect(run.changed.mean).toBeGreaterThan(0.001);
      expect(run.changed.max).toBeGreaterThan(0.08);
      // Depth cases guard-weight taps, so the chunk/reference gap roughly
      // doubles there (measured: 0.0078 mean / 0.066 max at preview).
      expect(run.parity.mean).toBeLessThan(0.01);
      expect(run.parity.max).toBeLessThan(0.07);
    }
    expect(result.preview.hasDepth).toBe(false);
    expect(result.previewDepth.hasDepth).toBe(true);
    expect(result.exportDepth.hasDepth).toBe(true);
    // Preview gathers at half resolution, export at full resolution.
    expect(result.preview.planSize).toEqual({ width: 48, height: 32 });
    expect(result.exportNull.planSize).toEqual({ width: 96, height: 64 });
  });

  test('export with lens blur off is byte-identical and on differs from off', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { prepareExportImage } = await import('../../src/engine/export/imageExporter');
      const { loadCubeLut } = await import('../../src/engine/color/lutLoader');
      const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');
      const { normalizeLensBlur } = await import('../../src/engine/contracts/lensBlur');

      const W = 160;
      const H = 120;
      const source = document.createElement('canvas');
      source.width = W;
      source.height = H;
      const ctx = source.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, '#14213d');
      gradient.addColorStop(0.5, '#fca311');
      gradient.addColorStop(1, '#e5e5e5');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsl(${i * 30}, 70%, ${30 + (i % 3) * 18}%)`;
        ctx.fillRect(5 + i * 12, 10 + (i % 4) * 25, 10, 14);
      }

      const image = { name: 'lens-export.png', originalWidth: W, originalHeight: H, originalElement: source } as any;
      const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
      const settings: any = { filmId: 'FS-001', adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.1, contrast: 8 } };
      const depthMask = [{
        id: 'export-depth', name: 'Depth', enabled: true, blend: 'add' as const, opacity: 1, inverted: false,
        kind: 'radial' as const, center: { x: 0.5, y: 0.5 }, radiusX: 0.75, radiusY: 0.65, rotation: 0, feather: 0.5,
      }];

      const decode = async (prepared: { blob: Blob; objectUrl: string }) => {
        const bitmap = await createImageBitmap(prepared.blob);
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const dctx = canvas.getContext('2d')!;
        dctx.drawImage(bitmap, 0, 0);
        const data = dctx.getImageData(0, 0, W, H).data;
        bitmap.close();
        URL.revokeObjectURL(prepared.objectUrl);
        return data;
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

      const exportWith = async (lensBlur: unknown) => {
        const prepared = await prepareExportImage(
          image,
          lut,
          lensBlur ? { ...settings, lensBlur } : settings,
          { format: 'image/png', quality: 1, scale: 1 },
        );
        return decode(prepared);
      };

      const off = await exportWith(undefined);
      const neutral = await exportWith(normalizeLensBlur({ enabled: false }));
      const onNull = await exportWith(normalizeLensBlur({
        enabled: true, focusPlane: 0.45, focusRange: 0.12, aperture: 1.4, bladeCount: 6,
        rotationDeg: 0, quality: 'preview', highlightBoost: 0.3, depthMask: null,
      }));
      const onDepth = await exportWith(normalizeLensBlur({
        enabled: true, focusPlane: 0.45, focusRange: 0.12, aperture: 1.4, bladeCount: 6,
        rotationDeg: 0, quality: 'preview', highlightBoost: 0.3, depthMask,
      }));

      return {
        neutralDiff: diff(off, neutral),
        nullDepthDiff: diff(off, onNull),
        depthDiff: diff(off, onDepth),
        nonBlank: Array.prototype.some.call(onNull, (value: number) => value > 0),
      };
    });

    // Neutral and absent stay byte-identical; active blur changes real export pixels.
    expect(result.neutralDiff.max).toBe(0);
    expect(result.nonBlank).toBe(true);
    expect(result.nullDepthDiff.mean).toBeGreaterThan(0.5);
    expect(result.nullDepthDiff.max).toBeGreaterThan(20);
    expect(result.depthDiff.mean).toBeGreaterThan(0.5);
    expect(result.depthDiff.max).toBeGreaterThan(20);
  });
});
