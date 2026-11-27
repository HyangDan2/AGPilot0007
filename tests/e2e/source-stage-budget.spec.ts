import { test, expect } from '@playwright/test';

test('source stage warp budget at 12MP and 24MP', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebGL2 budget probe runs in Chromium');
  test.slow();
  await page.goto('/');

  const measurements: any[] = await page.evaluate(async () => {
    const { renderSourceStage } = await import('../../src/engine/optical/sourceStage');

    const scenarios = [
      { name: '12MP', width: 4000, height: 3000 },
      { name: '24MP', width: 6000, height: 4000 },
    ];

    const results: any[] = [];
    for (const scenario of scenarios) {
      const source = document.createElement('canvas');
      source.width = scenario.width;
      source.height = scenario.height;
      const context = source.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, scenario.width, scenario.height);
      gradient.addColorStop(0, '#202020');
      gradient.addColorStop(1, '#e0e0e0');
      context.fillStyle = gradient;
      context.fillRect(0, 0, scenario.width, scenario.height);

      const input = {
        source,
        sourceWidth: scenario.width,
        sourceHeight: scenario.height,
        output: { width: scenario.width, height: scenario.height },
        geometry: {
          rotation: 0 as const,
          straighten: 3,
          flipHorizontal: true,
          flipVertical: false,
          crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
        },
        optical: {
          version: 1 as const,
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          distortion: { k1: 0.05 },
        },
      };

      const heapBefore = (performance as any).memory?.usedJSHeapSize ?? null;
      const start = performance.now();
      const rendered = renderSourceStage(input);
      const gl = (rendered?.canvas.getContext('webgl2') ?? null) as WebGL2RenderingContext | null;
      gl?.finish();
      const elapsed = performance.now() - start;
      const heapAfter = (performance as any).memory?.usedJSHeapSize ?? null;

      const cachedStart = performance.now();
      const cached = renderSourceStage(input);
      const cachedElapsed = performance.now() - cachedStart;

      const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
      results.push({
        name: scenario.name,
        width: scenario.width,
        height: scenario.height,
        elapsedMs: elapsed,
        cachedMs: cachedElapsed,
        cachedSameCanvas: rendered?.canvas === cached?.canvas,
        fingerprint: rendered?.fingerprint,
        gpu: rendererInfo ? gl?.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : null,
        maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? null,
        heapDeltaBytes: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
        heapUsedBytes: heapAfter,
        sourceBytes: scenario.width * scenario.height * 4,
        textureBytes: scenario.width * scenario.height * 4,
        outputBytes: scenario.width * scenario.height * 4,
        estimatedPixelBytes: scenario.width * scenario.height * 4 * 3,
      });

      context.clearRect(0, 0, scenario.width, scenario.height);
      source.width = 1;
      source.height = 1;
    }
    return results;
  });

  for (const measurement of measurements) {
    console.log(`[q02-budget] ${JSON.stringify(measurement)}`);
  }
  expect(measurements).toHaveLength(2);
  for (const measurement of measurements) {
    expect(measurement.fingerprint).toBeTruthy();
    expect(measurement.elapsedMs).toBeGreaterThan(0);
    expect(measurement.cachedSameCanvas).toBe(true);
  }
});
