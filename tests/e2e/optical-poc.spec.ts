import { test, expect, type Page } from '@playwright/test';
import type { PocApiInfo, PocConfig } from '../../poc/optical/gpu/optical-poc';
import { identityMat3, perspectiveCorrectionHomography } from '../../poc/optical/math/homography';
import { sourceToCorrected, type OpticalGeometry } from '../../poc/optical/math/coordinates';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Optical PoC harness is verified on desktop Chromium');
});

async function openPoc(page: Page): Promise<PocApiInfo> {
  await page.goto('/poc/optical/gpu/optical-poc.html');
  await page.waitForFunction(() => window.__opticalPoc?.ready === true, null, { timeout: 30000 });
  return page.evaluate(() => window.__opticalPoc!.info());
}

function render(page: Page, config: Partial<PocConfig>) {
  return page.evaluate((patch) => window.__opticalPoc!.render(patch), config);
}

function pixel(page: Page, u: number, v: number) {
  return page.evaluate(([x, y]) => window.__opticalPoc!.readPixel(x, y), [u, v]);
}

function sumRegion(page: Page, u0: number, v0: number, u1: number, v1: number, channel: number) {
  return page.evaluate(
    ([a, b, c, d, ch]) => window.__opticalPoc!.sumRegion(a, b, c, d, ch),
    [u0, v0, u1, v1, channel]
  );
}

test('initialises a WebGL2 context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const info = await openPoc(page);
  console.log(`[optical-gpu] renderer=${info.renderer} vendor=${info.vendor} maxTexture=${info.maxTextureSize}`);
  expect(info.maxTextureSize).toBeGreaterThanOrEqual(4096);
  expect(errors).toEqual([]);
});

test('keeps masks and content aligned after perspective correction', async ({ page }) => {
  await openPoc(page);
  const geometry: OpticalGeometry = {
    homography: perspectiveCorrectionHomography(0.8, 0, 0.1),
  };
  const sourceMarker = { x: 0.75, y: 0.25 };
  const corrected = sourceToCorrected(sourceMarker, geometry);
  expect(Math.hypot(corrected.x - sourceMarker.x, corrected.y - sourceMarker.y)).toBeGreaterThan(0.01);

  await render(page, {
    size: 512,
    scene: 'grid',
    view: 'mask',
    perspective: { vertical: 0.8, horizontal: 0, strength: 0.1 },
    rotationDeg: 0,
    distortion: null,
    mask: {
      kind: 'radial',
      center: [corrected.x, corrected.y],
      radius: [0.08, 0.08],
      rotation: 0,
      feather: 0.25,
    },
    localExposure: 0,
    focus: { center: [0.5, 0.5], radius: 0.2, falloff: 0.2, maxCoc: 0 },
  });

  const centreMask = await pixel(page, corrected.x, corrected.y);
  const farMask = await pixel(page, Math.min(0.98, corrected.x + 0.3), corrected.y);
  expect(centreMask[0]).toBeGreaterThan(245);
  expect(farMask[0]).toBeLessThan(5);

  await render(page, { view: 'geometry', mask: { kind: 'none' } });
  const marker = await pixel(page, corrected.x, corrected.y);
  expect(marker[1]).toBeGreaterThan(190);
  expect(marker[0]).toBeLessThan(120);
  expect(marker[2]).toBeLessThan(120);
});

test('applies radial distortion in the same direction as the CPU model', async ({ page }) => {
  await openPoc(page);
  const geometry: OpticalGeometry = {
    homography: identityMat3(),
    distortion: { k1: 0.2 },
  };
  const sourceMarker = { x: 0.25, y: 0.25 };
  const corrected = sourceToCorrected(sourceMarker, geometry);
  expect(Math.hypot(corrected.x - sourceMarker.x, corrected.y - sourceMarker.y)).toBeGreaterThan(0.005);

  await render(page, {
    size: 512,
    scene: 'grid',
    view: 'geometry',
    perspective: { vertical: 0, horizontal: 0, strength: 0.15 },
    rotationDeg: 0,
    distortion: { k1: 0.2 },
    mask: { kind: 'none' },
    localExposure: 0,
    focus: { center: [0.5, 0.5], radius: 0.2, falloff: 0.2, maxCoc: 0 },
  });

  const pixelValue = await pixel(page, corrected.x, corrected.y);
  expect(pixelValue[0]).toBeGreaterThan(180);
  expect(pixelValue[1]).toBeLessThan(110);
  expect(pixelValue[2]).toBeLessThan(110);
});

test('evaluates luminance and colour range masks on the GPU', async ({ page }) => {
  await openPoc(page);
  await render(page, {
    size: 512,
    scene: 'colour',
    view: 'mask',
    perspective: { vertical: 0, horizontal: 0, strength: 0.15 },
    rotationDeg: 0,
    distortion: null,
    mask: { kind: 'luma', lo: 0.25, hi: 0.42, feather: 0.05 },
    localExposure: 0,
    focus: { center: [0.5, 0.5], radius: 0.2, falloff: 0.2, maxCoc: 0 },
  });
  const darkQuadrant = await pixel(page, 0.25, 0.25);
  const brightQuadrant = await pixel(page, 0.75, 0.75);
  expect(darkQuadrant[0]).toBeGreaterThan(245);
  expect(brightQuadrant[0]).toBeLessThan(5);

  await render(page, {
    mask: {
      kind: 'color',
      color: [0.22, 0.3, 0.52],
      hueRange: 20,
      satRange: 0.3,
      lumRange: 0.3,
      feather: 0.1,
    },
  });
  const matching = await pixel(page, 0.25, 0.25);
  const other = await pixel(page, 0.75, 0.75);
  expect(matching[0]).toBeGreaterThan(200);
  expect(other[0]).toBeLessThan(20);
});

test('spreads a point source into an aperture footprint', async ({ page }) => {
  await openPoc(page);
  const base: Partial<PocConfig> = {
    size: 512,
    scene: 'bokeh',
    perspective: { vertical: 0, horizontal: 0, strength: 0.15 },
    rotationDeg: 0,
    distortion: null,
    mask: { kind: 'none' },
    localExposure: 0,
    focus: { center: [-10, -10], radius: 0, falloff: 1, maxCoc: 0 },
    aperture: { blades: 6, rotation: 0, roundness: 0 },
    taps: 64,
  };
  await render(page, { ...base, view: 'geometry' });
  const sharp = await sumRegion(page, 0.3, 0.3, 0.7, 0.7, 0);
  const sharpCentre = await pixel(page, 0.5, 0.5);
  expect(sharpCentre[0]).toBeGreaterThan(240);

  await render(page, {
    ...base,
    view: 'composite',
    focus: { center: [-10, -10], radius: 0, falloff: 1, maxCoc: 0.06 },
  });
  const blurred = await sumRegion(page, 0.3, 0.3, 0.7, 0.7, 0);
  const blurredCentre = await pixel(page, 0.5, 0.5);
  const farPixel = await pixel(page, 0.75, 0.5);

  expect(blurred / sharp).toBeGreaterThan(0.85);
  expect(blurred / sharp).toBeLessThan(1.15);
  expect(blurredCentre[0]).toBeLessThan(200);
  expect(blurredCentre[0]).toBeGreaterThan(5);
  expect(farPixel[0]).toBeLessThan(20);
});

test('preview and export resolutions agree in normalized coordinates', async ({ page }) => {
  await openPoc(page);
  const config: Partial<PocConfig> = {
    scene: 'colour',
    view: 'composite',
    perspective: { vertical: 0.5, horizontal: 0.2, strength: 0.1 },
    rotationDeg: 1.5,
    distortion: { k1: 0.1 },
    mask: {
      kind: 'radial',
      center: [0.45, 0.5],
      radius: [0.35, 0.3],
      rotation: 0.2,
      feather: 0.6,
    },
    localExposure: 0.8,
    focus: { center: [0.5, 0.5], radius: 0.2, falloff: 0.2, maxCoc: 0 },
  };
  const samples: [number, number][] = [
    [0.2, 0.2],
    [0.35, 0.2],
    [0.2, 0.35],
    [0.35, 0.35],
    [0.65, 0.2],
    [0.8, 0.35],
    [0.65, 0.65],
    [0.8, 0.8],
    [0.35, 0.65],
  ];

  await render(page, { ...config, size: 512 });
  const preview: number[][] = [];
  for (const [u, v] of samples) preview.push(await pixel(page, u, v));

  await render(page, { ...config, size: 1024 });
  const exported: number[][] = [];
  for (const [u, v] of samples) exported.push(await pixel(page, u, v));

  let maxDelta = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let c = 0; c < 3; c++) {
      maxDelta = Math.max(maxDelta, Math.abs(preview[i][c] - exported[i][c]));
    }
  }
  console.log(`[optical-gpu] parity_max_delta=${maxDelta}`);
  expect(maxDelta).toBeLessThanOrEqual(4);
});

test('records GPU pass timings for the PoC workload', async ({ page }) => {
  await openPoc(page);
  const config: Partial<PocConfig> = {
    scene: 'grid',
    view: 'composite',
    perspective: { vertical: 0.4, horizontal: 0.2, strength: 0.1 },
    rotationDeg: 1,
    distortion: { k1: 0.12 },
    mask: {
      kind: 'radial',
      center: [0.5, 0.5],
      radius: [0.4, 0.35],
      rotation: 0.3,
      feather: 0.5,
    },
    localExposure: 0.6,
    focus: { center: [0.4, 0.45], radius: 0.1, falloff: 0.3, maxCoc: 0.02 },
    aperture: { blades: 6, rotation: 0.1, roundness: 0.2 },
    taps: 32,
  };

  const results: Record<
    string,
    { avg: number; frames: number[]; passes: { scene: number; geometry: number; bokeh: number } }
  > = {};
  for (const size of [512, 1024]) {
    await render(page, { ...config, size });
    await page.evaluate(() => window.__opticalPoc!.render({}));
    const frames: number[] = [];
    const passes = { scene: 0, geometry: 0, bokeh: 0 };
    for (let i = 0; i < 3; i++) {
      const report = await render(page, { ...config, size });
      frames.push(report.totalMs);
      passes.scene += report.passes.scene;
      passes.geometry += report.passes.geometry;
      passes.bokeh += report.passes.bokeh;
    }
    results[size] = {
      avg: frames.reduce((a, b) => a + b, 0) / frames.length,
      frames,
      passes: { scene: passes.scene / 3, geometry: passes.geometry / 3, bokeh: passes.bokeh / 3 },
    };
  }
  console.log(`[optical-gpu] timings=${JSON.stringify(results)}`);
  expect(results[512].avg).toBeLessThan(2000);
  expect(results[1024].avg).toBeLessThan(2000);
});
