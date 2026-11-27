import { test, expect } from '@playwright/test';

test('GPU source stage matches the optical -> geometry CPU mapping at five points', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebGL2 reference parity runs in Chromium');
  test.slow();
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { renderSourceStage } = await import('../../src/engine/optical/sourceStage');
    const { geometryOutputToSource } = await import('../../src/engine/optical/geometry');
    const { opticalCorrectedToSource } = await import('../../src/engine/optical/transform');

    const width = 64;
    const height = 48;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext('2d')!;
    const sourceImage = sourceContext.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        sourceImage.data[offset] = Math.round(((x + 0.5) / width) * 255);
        sourceImage.data[offset + 1] = Math.round(((y + 0.5) / height) * 255);
        sourceImage.data[offset + 2] = 32;
        sourceImage.data[offset + 3] = 255;
      }
    }
    sourceContext.putImageData(sourceImage, 0, 0);

    const geometry = {
      rotation: 90 as const,
      straighten: 6,
      flipHorizontal: true,
      flipVertical: false,
      crop: { x: 0.15, y: 0.1, width: 0.7, height: 0.75 },
    };
    const optical = {
      version: 1 as const,
      homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      distortion: { k1: 0.08, k2: -0.02, p1: 0.002, p2: -0.001 },
    };
    const output = { width, height };
    const first = renderSourceStage({
      source,
      sourceWidth: width,
      sourceHeight: height,
      output,
      geometry,
      optical,
    });
    if (!first) return { error: 'source stage returned null' };

    const readback = document.createElement('canvas');
    readback.width = width;
    readback.height = height;
    const readContext = readback.getContext('2d')!;
    readContext.drawImage(first.canvas as CanvasImageSource, 0, 0);
    const warped = readContext.getImageData(0, 0, width, height).data;

    const pixels = [
      [13, 10],
      [25, 17],
      [32, 24],
      [41, 14],
      [51, 38],
    ] as const;
    const samples = pixels.map(([px, py]) => {
      const uv = { x: (px + 0.5) / width, y: (py + 0.5) / height };
      const geometrySource = geometryOutputToSource(uv, geometry, width / height);
      const sourcePoint = opticalCorrectedToSource(geometrySource, optical);
      const offset = (py * width + px) * 4;
      return {
        pixel: [px, py] as const,
        source: [sourcePoint.x, sourcePoint.y] as const,
        expected: [sourcePoint.x * 255, sourcePoint.y * 255, 32] as const,
        actual: [warped[offset], warped[offset + 1], warped[offset + 2]] as const,
        alpha: warped[offset + 3],
      };
    });

    const second = renderSourceStage({
      source,
      sourceWidth: width,
      sourceHeight: height,
      output,
      geometry: { ...geometry, crop: { ...geometry.crop } },
      optical: { ...optical, homography: [...optical.homography], distortion: { ...optical.distortion } },
    });

    return {
      fingerprint: first.fingerprint,
      secondFingerprint: second?.fingerprint,
      samples,
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.secondFingerprint).toBe(result.fingerprint);
  expect(result.samples).toHaveLength(5);
  for (const sample of result.samples) {
    expect(Math.abs(sample.actual[0] - sample.expected[0]), `R at ${sample.pixel}`).toBeLessThanOrEqual(4);
    expect(Math.abs(sample.actual[1] - sample.expected[1]), `G at ${sample.pixel}`).toBeLessThanOrEqual(4);
    expect(Math.abs(sample.actual[2] - sample.expected[2]), `B at ${sample.pixel}`).toBeLessThanOrEqual(4);
    expect(sample.alpha).toBe(255);
  }
});

test('source stage caches by source identity and fingerprint', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebGL2 cache probe runs in Chromium');
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { renderSourceStage } = await import('../../src/engine/optical/sourceStage');

    const width = 64;
    const height = 48;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    source.getContext('2d')!.fillRect(0, 0, width, height);

    const input = {
      source,
      sourceWidth: width,
      sourceHeight: height,
      output: { width, height },
      geometry: {
        rotation: 0 as const,
        straighten: 4,
        flipHorizontal: true,
        flipVertical: false,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      },
      optical: {
        version: 1 as const,
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        distortion: { k1: 0.05 },
      },
    };

    const prototype = WebGL2RenderingContext.prototype as any;
    const original = prototype.texImage2D;
    let uploads = 0;
    prototype.texImage2D = function (this: WebGL2RenderingContext, ...args: any[]) {
      uploads += 1;
      return original.apply(this, args);
    };

    try {
      const first = renderSourceStage(input);
      const afterFirst = uploads;
      const second = renderSourceStage(input);
      const afterSecond = uploads;
      return {
        first: first?.fingerprint,
        second: second?.fingerprint,
        sameCanvas: first?.canvas === second?.canvas,
        afterFirst,
        afterSecond,
      };
    } finally {
      prototype.texImage2D = original;
    }
  });

  expect(result.first).toBeTruthy();
  expect(result.second).toBe(result.first);
  expect(result.sameCanvas).toBe(true);
  expect(result.afterFirst).toBeGreaterThan(0);
  expect(result.afterSecond).toBe(result.afterFirst);
});
