import { test, expect } from '@playwright/test';
import type { RenderSettings } from '../../src/engine/pipeline/renderSettings';

/**
 * CP3 local stage: a radial mask with exposure must affect the mask center in
 * both preview and export, leave the far corner untouched, and an inactive
 * state must stay byte-identical to the CP2 path.
 */
test('radial mask exposure agrees between preview and export and keeps identity byte-equal', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebGL2 parity runs in desktop Chromium');
  test.slow();
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { WebGL2FilmRenderer } = await import('../../src/engine/renderer/webglRenderer');
    const { createWebGLPipelineBackend } = await import('../../src/engine/renderer/webglPipelineBackend');
    const { runRenderPipelineSync } = await import('../../src/engine/pipeline/renderPipeline');
    const { createQ02RenderRegistry } = await import('../../src/engine/optical/modules');
    const { prepareExportImage } = await import('../../src/engine/export/imageExporter');
    const { loadCubeLut } = await import('../../src/engine/color/lutLoader');
    const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');
    const { IDENTITY_GEOMETRY } = await import('../../src/engine/contracts/geometry');

    const W = 96;
    const H = 72;
    const source = document.createElement('canvas');
    source.width = W;
    source.height = H;
    const sctx = source.getContext('2d')!;
    const gradient = sctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, '#2a3038');
    gradient.addColorStop(0.5, '#8a6a50');
    gradient.addColorStop(1, '#d8c8b0');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) {
      sctx.fillStyle = `hsl(${i * 70}, 50%, ${40 + (i % 3) * 10}%)`;
      sctx.fillRect(8 + i * 16, 12 + (i % 3) * 16, 12, 10);
    }

    const group = {
      id: 'group-1',
      name: 'Radial',
      enabled: true,
      masks: [
        {
          id: 'mask-1',
          name: 'Radial 1',
          enabled: true,
          blend: 'add' as const,
          opacity: 1,
          inverted: false,
          kind: 'radial' as const,
          center: { x: 0.5, y: 0.5 },
          radiusX: 0.2,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.2,
        },
      ],
      adjustment: { exposure: 1.5 },
      opacity: 1,
      blend: 'add' as const,
    };
    const activeLocal = { enabled: true, groups: [group] };
    const inertLocal = { enabled: false, groups: [group] };

    const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
    const registry = createQ02RenderRegistry();

    const renderPreview = (settings: RenderSettings) => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const renderer = new WebGL2FilmRenderer(canvas);
      renderer.setImage(source, W, H);
      renderer.setLut(lut);
      runRenderPipelineSync(
        {
          target: 'preview',
          width: W,
          height: H,
          dpr: 1,
          source,
          sourceWidth: W,
          sourceHeight: H,
          settings,
          registry,
          extras: { compareMode: 'none', splitPos: 1, seed: 42 },
        },
        createWebGLPipelineBackend(renderer),
      );
      const raw = renderer.readPixels(0, 0, W, H)!;
      const oriented = new Uint8Array(raw.length);
      for (let y = 0; y < H; y++) {
        oriented.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      }
      renderer.destroy();
      return oriented;
    };

    const baseSettings: RenderSettings = {
      filmId: 'FS-001',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      geometry: IDENTITY_GEOMETRY,
    };
    const baseline = renderPreview(baseSettings);
    const masked = renderPreview({ ...baseSettings, localAdjustments: activeLocal });
    const inert = renderPreview({ ...baseSettings, localAdjustments: inertLocal });

    const image = { name: 'local.png', originalWidth: W, originalHeight: H, originalElement: source } as any;
    const prepared = await prepareExportImage(
      image,
      lut,
      { ...baseSettings, localAdjustments: activeLocal },
      { format: 'image/png', quality: 1, scale: 1 },
    );
    const bitmap = await createImageBitmap(prepared.blob);
    const probe = document.createElement('canvas');
    probe.width = W;
    probe.height = H;
    const pctx = probe.getContext('2d')!;
    pctx.drawImage(bitmap, 0, 0);
    const exported = pctx.getImageData(0, 0, W, H).data;
    bitmap.close();
    URL.revokeObjectURL(prepared.objectUrl);

    const meter = (a: Uint8Array | Uint8ClampedArray, b: Uint8Array) => {
      const diffs: number[] = [];
      let mean = 0;
      for (let i = 0; i < b.length; i += 4) {
        let pixel = 0;
        for (let c = 0; c < 3; c++) pixel = Math.max(pixel, Math.abs(a[i + c] - b[i + c]));
        diffs.push(pixel);
        mean += pixel;
      }
      mean /= diffs.length;
      diffs.sort((x, y) => x - y);
      return { mean, p99: diffs[Math.floor(diffs.length * 0.99)], max: diffs[diffs.length - 1] };
    };
    const parity = meter(exported, masked);

    const pixelDiff = (a: Uint8Array, b: Uint8Array, x: number, y: number) => {
      const index = (y * W + x) * 4;
      let value = 0;
      for (let c = 0; c < 3; c++) value = Math.max(value, Math.abs(a[index + c] - b[index + c]));
      return value;
    };

    let inertMax = 0;
    for (let i = 0; i < baseline.length; i++) inertMax = Math.max(inertMax, Math.abs(inert[i] - baseline[i]));

    return {
      parity,
      centerDelta: pixelDiff(masked, baseline, Math.floor(W / 2), Math.floor(H / 2)),
      outsideDelta: pixelDiff(masked, baseline, 2, 2),
      inertMax,
      exportSize: { width: prepared.width, height: prepared.height },
      maskedNonBlank: masked.some((value) => value > 0),
    };
  });

  expect(result.maskedNonBlank).toBe(true);
  expect(result.exportSize).toEqual({ width: 96, height: 72 });
  expect(result.parity.mean).toBeLessThanOrEqual(2);
  expect(result.parity.p99).toBeLessThanOrEqual(6);
  expect(result.centerDelta).toBeGreaterThan(25);
  expect(result.outsideDelta).toBeLessThanOrEqual(2);
  expect(result.inertMax).toBe(0);
});