import { test, expect } from '@playwright/test';

const MOUNT_HARNESS = async () => {
  const load = (id: string) => import(/* @vite-ignore */ id);
  const pick = (module: any) => module?.default ?? module;
  const React: any = pick(await load('/@id/react'));
  const reactDom: any = pick(await load('/@id/react-dom/client'));
  const { LensBlurPanel } = await load('/src/components/optical/LensBlurPanel.tsx');
  const { LensBlurOverlay } = await load('/src/components/optical/LensBlurOverlay.tsx');
  const { normalizeLensBlurState } = await load('/src/engine/optical/lensBlur.ts');

  let state = normalizeLensBlurState({
    enabled: true,
    focusPlane: 0.5,
    focusRange: 0.2,
    aperture: 2.8,
    bladeCount: 6,
    rotationDeg: 0,
    quality: 'preview',
    highlightBoost: 0,
    depthMask: null,
  });

  const host = document.createElement('div');
  host.id = 'lens-harness';
  host.style.cssText =
    'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:16px;background:#0b0d11;padding:16px';
  const frame = document.createElement('div');
  frame.id = 'lens-frame';
  frame.style.cssText =
    'position:relative;width:400px;height:300px;background:linear-gradient(135deg,#333,#777)';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:360px;height:560px;overflow:auto;display:flex';
  host.appendChild(frame);
  host.appendChild(panel);
  document.body.appendChild(host);

  const frameRoot = reactDom.createRoot(frame);
  const panelRoot = reactDom.createRoot(panel);
  const render = () => {
    (window as any).__lensState = state;
    frameRoot.render(
      React.createElement(LensBlurOverlay, {
        depthMask: state.depthMask,
        onDepthMaskChange: (depthMask: any) => {
          state = { ...state, depthMask };
          render();
        },
      }),
    );
    panelRoot.render(
      React.createElement(LensBlurPanel, {
        state,
        onChange: (patch: any) => {
          state = { ...state, ...patch };
          render();
        },
      }),
    );
  };
  render();
  return true;
};

const lensState = (page: any) => page.evaluate(() => (window as any).__lensState);

test('lens blur panel edits focus, aperture and quality', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium', 'Desktop lens blur harness runs in Chromium');
  await page.goto('/');
  await page.evaluate(MOUNT_HARNESS);
  await expect(page.getByTestId('lens-blur-panel')).toBeVisible();

  await page.getByTestId('lens-focus-plane').fill('0.3');
  expect((await lensState(page)).focusPlane).toBeCloseTo(0.3, 6);

  await page.getByTestId('lens-focus-range').fill('0.45');
  expect((await lensState(page)).focusRange).toBeCloseTo(0.45, 6);

  await page.getByTestId('lens-aperture').fill('1.4');
  expect((await lensState(page)).aperture).toBeCloseTo(1.4, 6);

  await page.getByTestId('lens-blades').fill('9');
  expect((await lensState(page)).bladeCount).toBe(9);

  await page.getByTestId('lens-rotation').fill('-30');
  expect((await lensState(page)).rotationDeg).toBeCloseTo(-30, 6);

  await page.getByTestId('lens-highlight-boost').fill('1.2');
  expect((await lensState(page)).highlightBoost).toBeCloseTo(1.2, 6);

  await page.getByTestId('lens-quality').selectOption('export');
  expect((await lensState(page)).quality).toBe('export');

  await page.getByTestId('lens-blur-enabled').uncheck();
  expect((await lensState(page)).enabled).toBe(false);
});

test('painting creates a depth mask that plans a depth field', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Depth mask painting runs in Chromium');
  await page.goto('/');
  await page.evaluate(MOUNT_HARNESS);
  await expect(page.getByTestId('lens-blur-overlay')).toBeVisible();

  const frame = page.getByTestId('lens-blur-overlay');
  const box = (await frame.boundingBox())!;
  const startX = box.x + box.width * 0.3;
  const startY = box.y + box.height * 0.6;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 90, startY - 40, { steps: 8 });
  await page.mouse.up();

  const state = await lensState(page);
  expect(state.depthMask).toHaveLength(1);
  expect(state.depthMask[0].kind).toBe('brush');
  const stroke = state.depthMask[0].strokes[0];
  expect(stroke.points.length).toBeGreaterThan(1);
  expect(stroke.points[0].x).toBeCloseTo(0.3, 1);
  expect(stroke.points[0].y).toBeCloseTo(0.6, 1);
  await expect(page.getByTestId('lens-blur-stroke')).toHaveCount(1);
  await expect(page.getByTestId('lens-depth-status')).toContainText('1 stroke');

  const plan = await page.evaluate(async () => {
    const { planLensBlur } = await import('../../src/engine/optical/lensBlur');
    const state = (window as any).__lensState;
    const planned = planLensBlur(state, { width: 96, height: 72 }, { maxTextureSize: 4096, maxTaps: 8 });
    return planned
      ? {
          hasDepth: planned.depth instanceof Float32Array,
          depthLength: planned.depth?.length ?? 0,
          size: planned.width * planned.height,
        }
      : null;
  });
  expect(plan).not.toBeNull();
  expect(plan!.hasDepth).toBe(true);
  expect(plan!.depthLength).toBe(plan!.size);

  await page.getByTestId('lens-depth-clear').click();
  expect((await lensState(page)).depthMask).toBeNull();
});
