import { test, expect } from '@playwright/test';

test('preview and export share identical render settings across every feature group', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { WebGL2FilmRenderer } = await import('../../src/engine/renderer/webglRenderer');
    const { loadCubeLut } = await import('../../src/engine/color/lutLoader');
    const { DEFAULT_ADJUSTMENTS } = await import('../../src/types/film');
    const { defaultCurves } = await import('../../src/types/curves');
    const { normalizeColorMixer } = await import('../../src/types/colorMixer');
    const { normalizeCamera } = await import('../../src/types/camera');
    const { normalizeSharpening } = await import('../../src/types/sharpening');
    const { prepareExportImage } = await import('../../src/engine/export/imageExporter');

    const W = 256;
    const H = 160;
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
    for (let i = 0; i < 8; i++) {
      sctx.fillStyle = `hsl(${i * 45}, 65%, ${30 + (i % 3) * 15}%)`;
      sctx.fillRect(8 + i * 30, 20 + (i % 4) * 30, 22, 20);
    }

    const image = { name: 'parity.png', originalWidth: W, originalHeight: H, originalElement: source } as any;
    const lut = await loadCubeLut('luts/FS-001_VAERN.cube');

    const adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      exposure: 0.2, contrast: 12, highlights: -10, shadows: 8, temperature: 6, tint: -4,
      saturation: 10, grain: 6, vignette: 10, filmStrength: 85, whites: 5, blacks: -6,
    };
    const curves = defaultCurves();
    curves.white = [[0, 0.03], [0.5, 0.55], [1, 0.97]];
    curves.red = [[0, 0], [0.6, 0.65], [1, 1]];
    const colorMixer = normalizeColorMixer({
      enabled: true,
      bands: { red: { hue: 10, saturation: 15, luminance: 0 }, blue: { hue: -8, saturation: -10, luminance: 5 } } as any,
      points: [{
        id: 'parity-point', name: 'Sky', color: [0.2, 0.4, 0.8], enabled: true,
        shift: { hue: -12, saturation: 10, luminance: 4 },
        range: { hue: 30, saturation: 40, luminance: 40 }, feather: 60,
      }],
    });
    const sharpening = normalizeSharpening({ amount: 55, radius: 1.2, detail: 40, masking: 20, mode: 'advanced' });
    const camera = normalizeCamera({
      dateStamp: { enabled: true, date: '2026-11-26', source: 'manual', format: 'compact', position: 'bottom-right', size: 3, color: '#ff792b', glow: 35, opacity: 85 },
      optics: { glow: 10, halation: 6, softness: 5, quality: 'standard' },
    });
    const settings = { filmId: 'FS-001' as const, adjustments, curves, colorMixer, sharpening, camera };

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const renderer = new WebGL2FilmRenderer(canvas);
    renderer.setImage(source);
    renderer.setLut(lut);
    renderer.render({ ...settings, compareMode: 'none', splitPos: 0.5, seed: 42 });

    const readImageOriented = () => {
      const raw = renderer.readPixels(0, 0, W, H)!;
      const oriented = new Uint8Array(raw.length);
      for (let y = 0; y < H; y++) oriented.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      return oriented;
    };
    const preview = readImageOriented();

    const decode = document.createElement('canvas');
    decode.width = W;
    decode.height = H;
    const dctx = decode.getContext('2d')!;

    const cases: Array<{ format: string; max: number; size: number }> = [];
    for (const format of ['image/png', 'image/jpeg'] as const) {
      const prepared = await prepareExportImage(image, lut, settings, { format, quality: 1, scale: 1 });
      const bitmap = await createImageBitmap(prepared.blob);
      dctx.clearRect(0, 0, W, H);
      dctx.drawImage(bitmap, 0, 0);
      const data = dctx.getImageData(0, 0, W, H).data;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(data[i + c] - preview[i + c]));
      }
      cases.push({ format, max, size: prepared.blob.size });
      bitmap.close();
      URL.revokeObjectURL(prepared.objectUrl);
    }

    // Neutral bypass must be byte-identical between preview and export.
    const identity = await loadCubeLut('luts/identity.cube');
    renderer.setLut(identity);
    renderer.render({ adjustments: DEFAULT_ADJUSTMENTS, filmId: 'FS-001', compareMode: 'none', splitPos: 0.5, seed: 42 });
    const neutralPreview = readImageOriented();
    const neutralPrepared = await prepareExportImage(image, identity, { adjustments: DEFAULT_ADJUSTMENTS, filmId: 'FS-001' }, { format: 'image/png', quality: 1, scale: 1 });
    const neutralBitmap = await createImageBitmap(neutralPrepared.blob);
    dctx.clearRect(0, 0, W, H);
    dctx.drawImage(neutralBitmap, 0, 0);
    const neutralData = dctx.getImageData(0, 0, W, H).data;
    let neutralMax = 0;
    for (let i = 0; i < neutralData.length; i++) neutralMax = Math.max(neutralMax, Math.abs(neutralData[i] - neutralPreview[i]));
    neutralBitmap.close();
    URL.revokeObjectURL(neutralPrepared.objectUrl);
    renderer.destroy();

    return { cases, neutralMax, previewNonBlank: preview.some((value) => value > 0) };
  });

  expect(result.previewNonBlank).toBe(true);
  expect(result.neutralMax).toBeLessThanOrEqual(1);
  for (const output of result.cases) {
    expect(output.size).toBeGreaterThan(100);
    expect(output.max).toBeLessThanOrEqual(output.format === 'image/png' ? 1 : 8);
  }
});
