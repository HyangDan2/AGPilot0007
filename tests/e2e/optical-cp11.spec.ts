import { test, expect, type Page } from '@playwright/test';
import type { PocConfig, PocMask } from '../../poc/optical/gpu/optical-poc';
import { identityMat3 } from '../../poc/optical/math/homography';
import { sourceToCorrected, type OpticalGeometry } from '../../poc/optical/math/coordinates';
import { circleOfConfusion } from '../../poc/optical/math/focus';
import {
  composeMaskStack,
  type BrushMask,
  type LinearMask,
  type LocalMask,
  type LuminanceMask,
  type RadialMask,
} from '../../poc/optical/math/masks';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Optical PoC harness is verified on desktop Chromium');
});

async function openPoc(page: Page): Promise<void> {
  await page.goto('/poc/optical/gpu/optical-poc.html');
  await page.waitForFunction(() => window.__opticalPoc?.ready === true, null, { timeout: 30000 });
}

function render(page: Page, config: Partial<PocConfig>) {
  return page.evaluate((patch) => window.__opticalPoc!.render(patch), config);
}

function pixel(page: Page, u: number, v: number) {
  return page.evaluate(([x, y]) => window.__opticalPoc!.readPixel(x, y), [u, v]);
}

const NEUTRAL: Partial<PocConfig> = {
  scene: 'colour',
  perspective: { vertical: 0, horizontal: 0, strength: 0.15 },
  rotationDeg: 0,
  distortion: null,
  localExposure: 0,
  focus: { center: [-10, -10], radius: 0, falloff: 1, maxCoc: 0 },
  aperture: { blades: 6, rotation: 0, roundness: 0.2 },
  taps: 32,
  bokehScale: 1,
};

function renderSize(size: number, aspect: number) {
  return {
    width: aspect >= 1 ? Math.round(size * aspect) : size,
    height: aspect >= 1 ? size : Math.round(size / aspect),
  };
}

// readPixel samples the pixel whose centre is floor(u * width) + 0.5.
function pixelCentre(u: number, v: number, width: number, height: number) {
  return {
    x: (Math.min(width - 1, Math.floor(u * width)) + 0.5) / width,
    y: (Math.min(height - 1, Math.floor(v * height)) + 0.5) / height,
  };
}

async function renderMask(page: Page, size: number, aspect: number, masks: PocMask[]) {
  return render(page, {
    ...NEUTRAL,
    size,
    aspect,
    view: 'mask',
    masks,
    mask: { kind: 'none' },
  });
}

// Mirrors the 'colour' scene: quadrant-coloured, sampled by CPU luma masks.
function colourAt(uv: { x: number; y: number }) {
  return {
    r: uv.x >= 0.5 ? 0.78 : 0.22,
    g: uv.y >= 0.5 ? 0.68 : 0.3,
    b: 0.52,
  };
}

async function compareMask(
  page: Page,
  size: number,
  aspect: number,
  masks: PocMask[],
  cpuMasks: LocalMask[],
  points: Array<[number, number]>,
  tolerance: number
): Promise<number> {
  await renderMask(page, size, aspect, masks);
  const { width, height } = renderSize(size, aspect);
  let maxDelta = 0;
  for (const [u, v] of points) {
    const centre = pixelCentre(u, v, width, height);
    const gpu = (await pixel(page, u, v))[0];
    const cpu = Math.round(255 * composeMaskStack(cpuMasks, centre, aspect, colourAt(centre)));
    if (Math.abs(gpu - cpu) > tolerance) {
      console.log(`[optical-cp11] mismatch u=${u} v=${v} gpu=${gpu} cpu=${cpu} centre=(${centre.x.toFixed(4)},${centre.y.toFixed(4)})`);
    }
    maxDelta = Math.max(maxDelta, Math.abs(gpu - cpu));
    expect(Math.abs(gpu - cpu)).toBeLessThanOrEqual(tolerance);
  }
  return maxDelta;
}

function radial(
  center: [number, number],
  radius: [number, number],
  rotation: number,
  feather: number,
  extra: Partial<RadialMask> = {}
): RadialMask {
  return { id: 'radial', enabled: true, kind: 'radial', center: { x: center[0], y: center[1] }, radiusX: radius[0], radiusY: radius[1], rotation, feather, ...extra };
}

function linear(
  start: [number, number],
  end: [number, number],
  feather: number,
  extra: Partial<LinearMask> = {}
): LinearMask {
  return { id: 'linear', enabled: true, kind: 'linear', start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, feather, ...extra };
}

function luma(lo: number, hi: number, feather: number, extra: Partial<LuminanceMask> = {}): LuminanceMask {
  return { id: 'luma', enabled: true, kind: 'luminance', lo, hi, feather, ...extra };
}

function linePoints(count: number, from: [number, number], to: [number, number]): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
}

test('mask weights match the CPU model for 1:1, 4:3, 16:9 and 9:16 sources', async ({ page }) => {
  await openPoc(page);
  const gpuMask: PocMask = {
    kind: 'radial',
    center: [0.42, 0.55],
    radius: [0.28, 0.18],
    rotation: 0.3,
    feather: 0.5,
  };
  const cpuMask = radial([0.42, 0.55], [0.28, 0.18], 0.3, 0.5);
  const points: Array<[number, number]> = [];
  for (const u of [0.12, 0.3, 0.5, 0.7, 0.86]) {
    for (const v of [0.2, 0.5, 0.8]) points.push([u, v]);
  }

  for (const aspect of [1, 4 / 3, 16 / 9, 9 / 16]) {
    const delta = await compareMask(page, 192, aspect, [gpuMask], [cpuMask], points, 3);
    console.log(`[optical-cp11] mask_aspect=${aspect.toFixed(4)} max_delta=${delta}`);
  }

  const focus = { center: [0.46, 0.5] as [number, number], radius: 0.12, falloff: 0.25, maxCoc: 0.08 };
  const cpuFocus = { center: { x: 0.46, y: 0.5 }, focusRadius: 0.12, falloff: 0.25, maxCoc: 0.08 };
  for (const aspect of [1, 4 / 3, 16 / 9, 9 / 16]) {
    await render(page, { ...NEUTRAL, size: 192, aspect, view: 'coc', focus });
    const { width, height } = renderSize(192, aspect);
    for (const [u, v] of points) {
      const centre = pixelCentre(u, v, width, height);
      const gpu = (await pixel(page, u, v))[0];
      const cpu = Math.round((255 * circleOfConfusion(centre, cpuFocus, aspect)) / focus.maxCoc);
      expect(Math.abs(gpu - cpu)).toBeLessThanOrEqual(3);
    }
  }
});

test('brush masks support a single point and polylines beyond 100 segments', async ({ page }) => {
  await openPoc(page);
  const line = linePoints(121, [0.2, 0.72], [0.85, 0.72]);
  const dot: [number, number] = [0.3, 0.3];
  const gpuMask: PocMask = {
    kind: 'brush',
    strokes: [
      { points: [dot], radius: 0.08, hardness: 0.6, flow: 1 },
      { points: line, radius: 0.02, hardness: 0.7, flow: 0.85 },
    ],
  };
  const cpuMask: BrushMask = {
    id: 'brush',
    enabled: true,
    kind: 'brush',
    strokes: [
      { points: [{ x: dot[0], y: dot[1] }], radius: 0.08, hardness: 0.6, flow: 1 },
      { points: line.map(([x, y]) => ({ x, y })), radius: 0.02, hardness: 0.7, flow: 0.85 },
    ],
  };
  expect(cpuMask.strokes[1].points.length - 1).toBeGreaterThan(100);

  const aspect = 4 / 3;
  await renderMask(page, 192, aspect, [gpuMask]);
  const dotCentre = await pixel(page, dot[0], dot[1]);
  const far = await pixel(page, 0.6, 0.1);
  // 0.7 maps to segment index ~92; a GPU that still clamped to 8 segments reads 0 here.
  const lateSegment = await pixel(page, 0.7, 0.72);
  expect(dotCentre[0]).toBeGreaterThan(250);
  expect(far[0]).toBeLessThan(4);
  expect(lateSegment[0]).toBeGreaterThan(150);

  const points: Array<[number, number]> = [
    dot,
    [0.24, 0.24],
    [0.36, 0.36],
    [0.4, 0.72],
    [0.52, 0.72],
    [0.7, 0.72],
    [0.84, 0.72],
    [0.52, 0.75],
    [0.52, 0.69],
    [0.6, 0.1],
  ];
  const delta = await compareMask(page, 192, aspect, [gpuMask], [cpuMask], points, 6);
  console.log(`[optical-cp11] brush_121_segments_max_delta=${delta}`);
});

test('feather extremes stay finite and blend matches the CPU model', async ({ page }) => {
  await openPoc(page);
  const aspect = 1;
  const size = 192;

  const sharp = await compareMask(
    page,
    size,
    aspect,
    [{ kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.2], rotation: 0, feather: 0 }],
    [radial([0.5, 0.5], [0.2, 0.2], 0, 0)],
    [
      [0.5, 0.5],
      [0.5, 0.69],
      [0.5, 0.71],
      [0.3, 0.5],
    ],
    2
  );
  const blunt = await compareMask(
    page,
    size,
    aspect,
    [{ kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.2], rotation: 0, feather: 1 }],
    [radial([0.5, 0.5], [0.2, 0.2], 0, 1)],
    [
      [0.5, 0.5],
      [0.5, 0.6],
      [0.5, 0.7],
    ],
    3
  );

  const hardLinearGpu: PocMask = { kind: 'linear', start: [0.3, 0.5], end: [0.7, 0.5], feather: 0 };
  const softLinearGpu: PocMask = { kind: 'linear', start: [0.3, 0.5], end: [0.7, 0.5], feather: 1 };
  const hardLinear = await compareMask(
    page,
    size,
    aspect,
    [hardLinearGpu],
    [linear([0.3, 0.5], [0.7, 0.5], 0)],
    [
      [0.49, 0.5],
      [0.51, 0.5],
      [0.2, 0.5],
      [0.8, 0.5],
    ],
    2
  );
  const softLinear = await compareMask(
    page,
    size,
    aspect,
    [softLinearGpu],
    [linear([0.3, 0.5], [0.7, 0.5], 1)],
    [
      [0.39, 0.5],
      [0.5, 0.5],
      [0.61, 0.5],
    ],
    3
  );

  const hardBrushGpu: PocMask = {
    kind: 'brush',
    strokes: [{ points: [[0.5, 0.5]], radius: 0.1, hardness: 1, flow: 1 }],
  };
  const hardBrushCpu: BrushMask = {
    id: 'hard-brush',
    enabled: true,
    kind: 'brush',
    strokes: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.1, hardness: 1, flow: 1 }],
  };
  const hardBrush = await compareMask(
    page,
    size,
    aspect,
    [hardBrushGpu],
    [hardBrushCpu],
    [
      [0.5, 0.5],
      [0.5, 0.59],
      [0.5, 0.61],
    ],
    2
  );

  await renderMask(page, size, aspect, [{ kind: 'luma', lo: 0.25, hi: 0.42, feather: 0 }]);
  const darkLuma = await pixel(page, 0.25, 0.25);
  const brightLuma = await pixel(page, 0.75, 0.75);
  expect(darkLuma[0]).toBeGreaterThan(250);
  expect(brightLuma[0]).toBeLessThan(5);

  await renderMask(page, size, aspect, [
    { kind: 'color', color: [0.22, 0.3, 0.52], hueRange: 20, satRange: 0.3, lumRange: 0.3, feather: 0 },
  ]);
  const matching = await pixel(page, 0.25, 0.25);
  const other = await pixel(page, 0.75, 0.75);
  expect(matching[0]).toBeGreaterThan(250);
  expect(other[0]).toBeLessThan(5);
  expect(Number.isFinite(matching[1])).toBe(true);

  console.log(
    `[optical-cp11] feather_extremes max_delta=${Math.max(sharp, blunt, hardLinear, softLinear, hardBrush)}`
  );
});

test('extreme distortion converges and non-invertible coefficients are rejected', async ({ page }) => {
  await openPoc(page);
  const distortion = { k1: 2, k2: -0.2 };
  const geometry: OpticalGeometry = { homography: identityMat3(), distortion };
  const marker = sourceToCorrected({ x: 0.75, y: 0.25 }, geometry);

  await render(page, {
    ...NEUTRAL,
    size: 256,
    aspect: 1,
    scene: 'grid',
    view: 'geometry',
    distortion,
  });
  const markerPixel = await pixel(page, marker.x, marker.y);
  expect(markerPixel[1]).toBeGreaterThan(190);
  expect(markerPixel[0]).toBeLessThan(120);
  expect(markerPixel[2]).toBeLessThan(120);

  await expect(
    page.evaluate(() => {
      window.__opticalPoc!.render({ distortion: { k1: -0.5 } });
    })
  ).rejects.toThrow(/not invertible/i);

  const info = await page.evaluate(() => window.__opticalPoc!.info());
  console.log(`[optical-cp11] distortion_domain renderer=${info.renderer} marker=(${marker.x.toFixed(4)},${marker.y.toFixed(4)})`);
});

test('mask coordinates are identical between preview and export resolutions', async ({ page }) => {
  await openPoc(page);
  const line = linePoints(41, [0.25, 0.65], [0.8, 0.65]);
  const masks: PocMask[] = [
    {
      kind: 'radial',
      center: [0.4, 0.42],
      radius: [0.22, 0.3],
      rotation: 0.4,
      feather: 0.6,
    },
    { kind: 'brush', strokes: [{ points: line, radius: 0.03, hardness: 0.6, flow: 0.9 }] },
  ];
  const points: Array<[number, number]> = [
    [0.2, 0.2],
    [0.4, 0.42],
    [0.5, 0.5],
    [0.5, 0.65],
    [0.7, 0.65],
    [0.8, 0.3],
    [0.25, 0.8],
    [0.6, 0.75],
    [0.9, 0.9],
  ];
  const aspect = 4 / 3;

  await renderMask(page, 160, aspect, masks);
  const preview: number[] = [];
  for (const [u, v] of points) preview.push((await pixel(page, u, v))[0]);

  await renderMask(page, 320, aspect, masks);
  const exported: number[] = [];
  for (const [u, v] of points) exported.push((await pixel(page, u, v))[0]);

  let maxDelta = 0;
  for (let i = 0; i < points.length; i++) {
    maxDelta = Math.max(maxDelta, Math.abs(preview[i] - exported[i]));
  }
  console.log(`[optical-cp11] mask_resolution_parity_max_delta=${maxDelta}`);
  expect(maxDelta).toBeLessThanOrEqual(3);
});

test('multi-mask stack (add/subtract/intersect, invert, opacity) matches the CPU model', async ({ page }) => {
  await openPoc(page);
  const aspect = 4 / 3;
  const gpuMasks: PocMask[] = [
    { kind: 'radial', center: [0.35, 0.5], radius: [0.25, 0.3], rotation: 0, feather: 0.4 },
    {
      kind: 'radial',
      center: [0.62, 0.5],
      radius: [0.18, 0.22],
      rotation: 0.2,
      feather: 0.3,
      blend: 'subtract',
      invert: true,
      opacity: 0.7,
    },
    { kind: 'linear', start: [0.1, 0.85], end: [0.9, 0.85], feather: 0.5, blend: 'add' },
    { kind: 'luma', lo: 0.22, hi: 0.43, feather: 0.05, blend: 'intersect' },
  ];
  const cpuMasks: LocalMask[] = [
    radial([0.35, 0.5], [0.25, 0.3], 0, 0.4),
    radial([0.62, 0.5], [0.18, 0.22], 0.2, 0.3, { blend: 'subtract', invert: true, opacity: 0.7 }),
    linear([0.1, 0.85], [0.9, 0.85], 0.5),
    luma(0.22, 0.43, 0.05, { blend: 'intersect' }),
  ];
  const points: Array<[number, number]> = [
    [0.2, 0.2],
    [0.35, 0.5],
    [0.5, 0.5],
    [0.62, 0.5],
    [0.75, 0.5],
    [0.2, 0.8],
    [0.5, 0.8],
    [0.8, 0.8],
    [0.65, 0.25],
    [0.4, 0.3],
    [0.55, 0.7],
    [0.2, 0.5],
  ];

  const delta = await compareMask(page, 192, aspect, gpuMasks, cpuMasks, points, 4);
  console.log(`[optical-cp11] mask_stack_max_delta=${delta}`);

  await renderMask(page, 192, aspect, gpuMasks);
  // Inside mask 1 (1.0), inverted subtract outside mask 2 (0.7) leaves 0.3;
  // the luma intersect keeps the dark quadrant.
  const composed = await pixel(page, 0.35, 0.35);
  expect(composed[0]).toBeGreaterThan(68);
  expect(composed[0]).toBeLessThan(90);
  expect((await pixel(page, 0.8, 0.8))[0]).toBeLessThan(5);
});

test('bokeh cost scales with tap count and resolution', async ({ page }) => {
  await openPoc(page);
  const base: Partial<PocConfig> = {
    ...NEUTRAL,
    scene: 'colour',
    view: 'composite',
    aspect: 1,
    focus: { center: [-10, -10], radius: 0, falloff: 1, maxCoc: 0.05 },
    bokehScale: 1,
  };
  const table: Record<string, number> = {};
  for (const size of [512, 1024]) {
    for (const taps of [16, 32, 64]) {
      await render(page, { ...base, size, taps });
      let total = 0;
      const frames = 3;
      for (let i = 0; i < frames; i++) {
        total += (await render(page, { ...base, size, taps })).passes.bokeh;
      }
      table[`${size}x${taps}`] = total / frames;
    }
  }
  console.log(`[optical-cp11] bokeh_taps_bokeh_ms=${JSON.stringify(table)}`);
  expect(table['512x64']).toBeGreaterThan(table['512x16']);
  expect(table['1024x64']).toBeGreaterThan(table['1024x16']);
});

test('half-resolution bokeh reduces cost while preserving composite quality', async ({ page }) => {
  await openPoc(page);
  const base: Partial<PocConfig> = {
    ...NEUTRAL,
    size: 512,
    aspect: 1,
    scene: 'colour',
    view: 'composite',
    focus: { center: [-10, -10], radius: 0, falloff: 1, maxCoc: 0.06 },
    taps: 32,
  };

  const timings: Record<string, number> = {};
  for (const scale of [1, 2] as const) {
    await render(page, { ...base, bokehScale: scale });
    await render(page, { ...base, bokehScale: scale });
    let total = 0;
    for (let i = 0; i < 5; i++) {
      total += (await render(page, { ...base, bokehScale: scale })).passes.bokeh;
    }
    timings[scale] = total / 5;
  }
  console.log(`[optical-cp11] bokeh_scale_bokeh_ms=${JSON.stringify(timings)}`);
  expect(timings[2]).toBeLessThan(timings[1] * 0.75);

  const quality: Partial<PocConfig> = {
    ...NEUTRAL,
    size: 256,
    aspect: 1,
    scene: 'colour',
    view: 'composite',
    focus: { center: [0.5, 0.5], radius: 0.08, falloff: 0.3, maxCoc: 0.05 },
    taps: 32,
  };
  const points: Array<[number, number]> = [];
  for (const u of [0.15, 0.3, 0.7, 0.85]) {
    for (const v of [0.2, 0.4, 0.6, 0.8]) points.push([u, v]);
  }

  await render(page, { ...quality, bokehScale: 1 });
  const full: number[][] = [];
  for (const [u, v] of points) full.push(await pixel(page, u, v));

  await render(page, { ...quality, bokehScale: 2 });
  const half: number[][] = [];
  for (const [u, v] of points) half.push(await pixel(page, u, v));

  let sum = 0;
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(full[i][c] - half[i][c]);
      sum += delta;
      max = Math.max(max, delta);
    }
  }
  const mean = sum / (points.length * 3);
  console.log(`[optical-cp11] bokeh_scale_quality mean_delta=${mean.toFixed(2)} max_delta=${max}`);

  const sharpEnergy = full.reduce((a, p) => a + p[0], 0);
  const halfEnergy = half.reduce((a, p) => a + p[0], 0);
  expect(sharpEnergy / halfEnergy).toBeGreaterThan(0.95);
  expect(sharpEnergy / halfEnergy).toBeLessThan(1.05);
  expect(mean).toBeLessThan(6);
  expect(max).toBeLessThan(20);
});
