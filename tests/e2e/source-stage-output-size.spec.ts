import { test, expect } from '@playwright/test';

test('source stage preview and export stay identical at geometry-derived sizes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebGL2 parity runs in Chromium');
  test.slow();
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { renderSourceStage } = await import('../../src/engine/optical/sourceStage');
    const { geometryOutputSize, geometryOutputToSource } = await import(
      '../../src/engine/optical/geometry'
    );
    const { createPerspectiveTransform, opticalCorrectedToSource } = await import(
      '../../src/engine/optical/transform'
    );

    const sourceWidth = 96;
    const sourceHeight = 72;
    const source = document.createElement('canvas');
    source.width = sourceWidth;
    source.height = sourceHeight;
    const sourceContext = source.getContext('2d')!;
    const sourceImage = sourceContext.createImageData(sourceWidth, sourceHeight);
    for (let y = 0; y < sourceHeight; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        const offset = (y * sourceWidth + x) * 4;
        sourceImage.data[offset] = Math.round(((x + 0.5) / sourceWidth) * 255);
        sourceImage.data[offset + 1] = Math.round(((y + 0.5) / sourceHeight) * 255);
        sourceImage.data[offset + 2] = 64;
        sourceImage.data[offset + 3] = 255;
      }
    }
    sourceContext.putImageData(sourceImage, 0, 0);

    // Rotation + straighten + crop, plus a lens perspective: the WO parity case.
    const geometry = {
      rotation: 90 as const,
      straighten: 6,
      flipHorizontal: false,
      flipVertical: false,
      crop: { x: 0.1, y: 0.15, width: 0.6, height: 0.5 },
    };
    const optical = createPerspectiveTransform(0.3, -0.2);

    const preview = geometryOutputSize(geometry, sourceWidth, sourceHeight);
    const exportSize = geometryOutputSize(geometry, sourceWidth * 2, sourceHeight * 2);

    const render = (output: { width: number; height: number }) => {
      const stage = renderSourceStage({
        source,
        sourceWidth,
        sourceHeight,
        output,
        geometry,
        optical,
      });
      if (!stage) throw new Error('source stage returned null');
      const readback = document.createElement('canvas');
      readback.width = output.width;
      readback.height = output.height;
      const context = readback.getContext('2d')!;
      context.drawImage(stage.canvas as CanvasImageSource, 0, 0);
      return {
        stage,
        pixels: context.getImageData(0, 0, output.width, output.height).data,
      };
    };

    const previewRender = render(preview);
    const exportRender = render(exportSize);

    const sampleAt = (
      pixels: Uint8ClampedArray,
      size: { width: number; height: number },
      uv: { x: number; y: number },
    ) => {
      const px = Math.min(size.width - 1, Math.max(0, Math.floor(uv.x * size.width)));
      const py = Math.min(size.height - 1, Math.max(0, Math.floor(uv.y * size.height)));
      const offset = (py * size.width + px) * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]] as const;
    };

    // Sample the same corrected NIS points in both renders.
    const points = [
      { x: 0.2, y: 0.25 },
      { x: 0.5, y: 0.5 },
      { x: 0.78, y: 0.3 },
      { x: 0.35, y: 0.8 },
    ];
    const parity = points.map((uv) => ({
      uv,
      preview: sampleAt(previewRender.pixels, preview, uv),
      exported: sampleAt(exportRender.pixels, exportSize, uv),
    }));

    // No-stretch check: in source pixel space the mapped output rectangle must
    // stay a rectangle (right angles, equal opposite sides). Straighten is a
    // cover rotation, never an anisotropic scale.
    const center = geometryOutputToSource(
      { x: 0.5, y: 0.5 },
      geometry,
      sourceWidth / sourceHeight,
    );
    const corners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ].map((point) => {
      const mapped = geometryOutputToSource(point, geometry, sourceWidth / sourceHeight);
      return { x: mapped.x * sourceWidth, y: mapped.y * sourceHeight };
    });
    const side = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const top = side(corners[0], corners[1]);
    const bottom = side(corners[3], corners[2]);
    const left = side(corners[0], corners[3]);
    const right = side(corners[1], corners[2]);
    const edgeDot =
      (corners[1].x - corners[0].x) * (corners[3].x - corners[0].x) +
      (corners[1].y - corners[0].y) * (corners[3].y - corners[0].y);

    return {
      preview,
      exportSize,
      previewFingerprint: previewRender.stage.fingerprint,
      exportFingerprint: exportRender.stage.fingerprint,
      parity,
      top,
      bottom,
      left,
      right,
      edgeDot,
      opticalSample: opticalCorrectedToSource(center, optical),
    };
  });

  // Crop sizes follow rotation-swapped source dimensions, at preview and export.
  expect(result.preview).toEqual({ width: Math.round(72 * 0.6), height: Math.round(96 * 0.5) });
  expect(result.exportSize).toEqual({
    width: Math.round(144 * 0.6),
    height: Math.round(192 * 0.5),
  });
  expect(result.opticalSample).toBeTruthy();

  // The cache fingerprint must include the output size.
  expect(result.exportFingerprint).not.toBe(result.previewFingerprint);

  for (const sample of result.parity) {
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(sample.preview[channel] - sample.exported[channel]),
        `channel ${channel} at ${JSON.stringify(sample.uv)}`,
      ).toBeLessThanOrEqual(4);
    }
  }

  expect(Math.abs(result.top - result.bottom)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(result.left - result.right)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(result.edgeDot)).toBeLessThanOrEqual(1e-6);
});
