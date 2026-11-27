import { test, expect } from '@playwright/test';
import type { RenderSettings } from '../../src/engine/pipeline/renderSettings';

/**
 * CP3-01: preview and export must agree for rotate → crop → straighten with
 * lens perspective, at sizes derived by Q02's geometryOutputSize. Export is
 * rendered at twice the preview size and downscaled for comparison, so the
 * documented tolerance allows resampling only (mean ≤ 6, max p99 ≤ 24).
 * Identity geometry must stay pixel-exact against the CP2 path.
 */
test('preview and export agree for rotated, cropped and straightened geometry at derived sizes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebGL2 parity runs in Chromium');
  test.slow();
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { WebGL2FilmRenderer } = await import('../../src/engine/renderer/webglRenderer');
    const { createWebGLPipelineBackend } = await import('../../src/engine/renderer/webglPipelineBackend');
    const { runRenderPipelineSync } = await import('../../src/engine/pipeline/renderPipeline');
    const { createQ02RenderRegistry } = await import('../../src/engine/optical/modules');
    const { geometryOutputSize } = await import('../../src/engine/optical/geometry');
    const { createPerspectiveTransform } = await import('../../src/engine/optical/transform');
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
    gradient.addColorStop(0, '#101820');
    gradient.addColorStop(0.45, '#c87941');
    gradient.addColorStop(1, '#f6e7d8');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      sctx.fillStyle = `hsl(${i * 60}, 60%, ${35 + (i % 3) * 12}%)`;
      sctx.fillRect(6 + i * 14, 10 + (i % 4) * 14, 10, 9);
    }

    const geometry = {
      rotation: 90 as const,
      straighten: 6,
      flipHorizontal: false,
      flipVertical: false,
      crop: { x: 0.1, y: 0.15, width: 0.6, height: 0.5 },
    };
    const optical = createPerspectiveTransform(0.3, -0.2);
    const settings: RenderSettings = { filmId: 'FS-001', adjustments: { ...DEFAULT_ADJUSTMENTS }, geometry, optical };
    const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
    const registry = createQ02RenderRegistry();
    const previewSize = geometryOutputSize(geometry, W, H);

    const renderPreview = (output: { width: number; height: number }, renderSettings: RenderSettings) => {
      const canvas = document.createElement('canvas');
      canvas.width = output.width;
      canvas.height = output.height;
      const renderer = new WebGL2FilmRenderer(canvas);
      renderer.setImage(source, W, H);
      renderer.setLut(lut);
      runRenderPipelineSync(
        {
          target: 'preview',
          width: output.width,
          height: output.height,
          dpr: 1,
          source,
          sourceWidth: W,
          sourceHeight: H,
          settings: renderSettings,
          registry,
          extras: { compareMode: 'none', splitPos: 1, seed: 42 },
        },
        createWebGLPipelineBackend(renderer),
      );
      const raw = renderer.readPixels(0, 0, output.width, output.height)!;
      const oriented = new Uint8Array(raw.length);
      for (let y = 0; y < output.height; y++) {
        oriented.set(
          raw.subarray((output.height - 1 - y) * output.width * 4, (output.height - y) * output.width * 4),
          y * output.width * 4,
        );
      }
      renderer.destroy();
      return oriented;
    };

    const image = { name: 'geometry.png', originalWidth: W, originalHeight: H, originalElement: source } as any;
    const scale = 2;
    const exportTarget = { width: previewSize.width * scale, height: previewSize.height * scale };
    const prepared = await prepareExportImage(image, lut, settings, {
      format: 'image/png',
      quality: 1,
      targetWidth: exportTarget.width,
    });
    const bitmap = await createImageBitmap(prepared.blob);
    const probe = document.createElement('canvas');
    probe.width = previewSize.width;
    probe.height = previewSize.height;
    const pctx = probe.getContext('2d')!;
    pctx.imageSmoothingEnabled = true;
    pctx.drawImage(bitmap, 0, 0, previewSize.width, previewSize.height);
    const exported = pctx.getImageData(0, 0, previewSize.width, previewSize.height).data;
    const preview = renderPreview(previewSize, settings);

    const diffs: number[] = [];
    let mean = 0;
    for (let i = 0; i < exported.length; i += 4) {
      let pixel = 0;
      for (let c = 0; c < 3; c++) pixel = Math.max(pixel, Math.abs(exported[i + c] - preview[i + c]));
      diffs.push(pixel);
      mean += pixel;
    }
    mean /= diffs.length;
    diffs.sort((a, b) => a - b);
    const p99 = diffs[Math.floor(diffs.length * 0.99)];
    bitmap.close();
    URL.revokeObjectURL(prepared.objectUrl);

    // Identity regression: derived size equals the source and PNG matches.
    const identitySize = geometryOutputSize(IDENTITY_GEOMETRY, W, H);
    const identityPrepared = await prepareExportImage(
      image,
      lut,
      { filmId: 'FS-001', adjustments: { ...DEFAULT_ADJUSTMENTS }, geometry: IDENTITY_GEOMETRY },
      { format: 'image/png', quality: 1, scale: 1 },
    );
    const identityBitmap = await createImageBitmap(identityPrepared.blob);
    const identityProbe = document.createElement('canvas');
    identityProbe.width = W;
    identityProbe.height = H;
    const ictx = identityProbe.getContext('2d')!;
    ictx.drawImage(identityBitmap, 0, 0);
    const identityExport = ictx.getImageData(0, 0, W, H).data;
    const identityPreview = renderPreview(identitySize, {
      filmId: 'FS-001',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      geometry: IDENTITY_GEOMETRY,
    } as RenderSettings);
    let identityMax = 0;
    for (let i = 0; i < identityExport.length; i++) {
      identityMax = Math.max(identityMax, Math.abs(identityExport[i] - identityPreview[i]));
    }
    identityBitmap.close();
    URL.revokeObjectURL(identityPrepared.objectUrl);

    return {
      previewSize,
      exportSize: { width: prepared.width, height: prepared.height },
      exportTarget,
      mean,
      p99,
      previewNonBlank: preview.some((value) => value > 0),
      identitySize,
      identityMax,
    };
  });

  expect(result.previewNonBlank).toBe(true);
  expect(result.previewSize).toEqual({ width: 43, height: 48 });
  expect(result.exportSize).toEqual(result.exportTarget);
  expect(result.mean).toBeLessThanOrEqual(6);
  expect(result.p99).toBeLessThanOrEqual(24);
  expect(result.identitySize).toEqual({ width: 96, height: 72 });
  expect(result.identityMax).toBeLessThanOrEqual(1);
});