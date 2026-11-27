import { test, expect } from '@playwright/test';

const MOUNT_HARNESS = async () => {
  // Runs in the page; ids are Vite dev URLs, so resolve them dynamically.
  const load = (id: string) => import(/* @vite-ignore */ id);
  const pick = (module: any) => module?.default ?? module;
  const React: any = pick(await load('/@id/react'));
  const reactDom: any = pick(await load('/@id/react-dom/client'));
  const createRoot = reactDom.createRoot.bind(reactDom);
  const { GeometryOverlay } = await load('/src/components/geometry/GeometryOverlay.tsx');
  const { GeometryPanel } = await load('/src/components/geometry/GeometryPanel.tsx');

  const host = document.createElement('div');
  host.id = 'geometry-harness';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:16px;background:#0b0d11;padding:16px';
  const frame = document.createElement('div');
  frame.id = 'geometry-frame';
  frame.style.cssText = 'position:relative;width:400px;height:300px;background:linear-gradient(135deg,#333,#777)';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:320px;color:#c8cfda';
  host.appendChild(frame);
  host.appendChild(panel);
  document.body.appendChild(host);

  const state: any = {
    geometry: { rotation: 0, straighten: 0, flipHorizontal: false, flipVertical: false, crop: null },
    optical: null,
  };
  (window as any).__geomState = state;

  const Harness = () => {
    const [geometry, setGeometry] = React.useState(state.geometry);
    React.useEffect(() => {
      state.geometry = geometry;
    }, [geometry]);
    return React.createElement(GeometryOverlay, {
      geometry,
      onChange: (patch: any) => setGeometry((current: any) => ({ ...current, ...patch })),
    });
  };

  const root = createRoot(frame);
  root.render(React.createElement(Harness));
  const panelRoot = createRoot(panel);
  panelRoot.render(
    React.createElement(() => {
      const [geometry, setGeometry] = React.useState(state.geometry);
      const [optical, setOptical] = React.useState(state.optical);
      React.useEffect(() => {
        state.geometry = geometry;
        state.optical = optical;
      }, [geometry, optical]);
      return React.createElement(GeometryPanel, {
        geometry,
        optical,
        onGeometryChange: (patch: any) => setGeometry((current: any) => ({ ...current, ...patch })),
        onOpticalChange: (next: any) => setOptical(next),
      });
    }),
  );
  return true;
};

test('crop overlay drives geometry with pointer and keyboard', async ({ page }) => {
  // The harness is a fixed desktop layout; mobile-chromium also reports browserName chromium.
  test.skip(test.info().project.name !== 'chromium', 'Desktop overlay harness runs in Chromium');
  await page.goto('/');
  await page.evaluate(MOUNT_HARNESS);
  const overlay = page.getByTestId('geometry-overlay');
  await expect(overlay).toBeVisible();

  // Drag the east handle 40px left on a 400px frame -> crop width 0.9.
  const east = page.getByTestId('geometry-handle-e');
  const box = (await east.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => page.evaluate(() => (window as any).__geomState.geometry.crop))
    .not.toBeNull();
  const crop = await page.evaluate(() => (window as any).__geomState.geometry.crop);
  expect(crop.x).toBeCloseTo(0, 6);
  expect(crop.y).toBeCloseTo(0, 6);
  expect(crop.width).toBeGreaterThanOrEqual(0.88);
  expect(crop.width).toBeLessThanOrEqual(0.92);
  expect(crop.height).toBeCloseTo(1, 6);

  // Keyboard nudge on the east handle shrinks the crop by one step.
  await page.getByTestId('geometry-handle-e').focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => page.evaluate(() => (window as any).__geomState.geometry.crop.width))
    .toBeLessThan(crop.width);

  // Dragging the move area past the frame keeps the crop inside [0,1].
  const move = page.getByTestId('geometry-crop-move');
  const moveBox = (await move.boundingBox())!;
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(moveBox.x + moveBox.width / 2 + 600, moveBox.y + moveBox.height / 2, { steps: 4 });
  await page.mouse.up();
  const moved = await page.evaluate(() => (window as any).__geomState.geometry.crop);
  expect(moved.x + moved.width).toBeLessThanOrEqual(1 + 1e-6);
});

test('overlay is hidden in compare/original mode', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Overlay visibility runs in Chromium');
  await page.goto('/');
  const mounted: boolean = await page.evaluate(async () => {
    const load = (id: string) => import(/* @vite-ignore */ id);
    const pick = (module: any) => module?.default ?? module;
    const React: any = pick(await load('/@id/react'));
    const reactDom: any = pick(await load('/@id/react-dom/client'));
    const { GeometryOverlay } = await load('/src/components/geometry/GeometryOverlay.tsx');
    const host = document.createElement('div');
    host.id = 'hidden-overlay-host';
    host.style.cssText = 'position:relative;width:200px;height:150px';
    document.body.appendChild(host);
    reactDom.createRoot(host).render(
      React.createElement(GeometryOverlay, {
        geometry: { rotation: 0, straighten: 0, flipHorizontal: false, flipVertical: false, crop: null },
        onChange: () => undefined,
        hidden: true,
      }),
    );
    return true;
  });
  expect(mounted).toBe(true);
  await expect(page.locator('#hidden-overlay-host')).toBeEmpty();
});

test('geometry panel rotate, flip, straighten and perspective controls commit real state', async ({ page }) => {
  // The harness is a fixed desktop layout; mobile-chromium also reports browserName chromium.
  test.skip(test.info().project.name !== 'chromium', 'Desktop overlay harness runs in Chromium');
  await page.goto('/');
  await page.evaluate(MOUNT_HARNESS);
  await expect(page.getByTestId('geometry-panel').first()).toBeVisible();

  await page.getByLabel('Rotate right 90 degrees').first().click();
  await page.getByLabel('Flip vertical').first().click();
  expect(await page.evaluate(() => (window as any).__geomState.geometry.rotation)).toBe(90);
  expect(await page.evaluate(() => (window as any).__geomState.geometry.flipVertical)).toBe(true);

  await page.getByLabel('Straighten').first().fill('12');
  expect(await page.evaluate(() => (window as any).__geomState.geometry.straighten)).toBeCloseTo(12, 6);

  await page.getByLabel('Perspective vertical').first().fill('0.5');
  const optical = await page.evaluate(() => (window as any).__geomState.optical);
  expect(optical).not.toBeNull();
  expect(optical.perspective[0].x).toBeCloseTo(0.5 * 0.15, 6);
  expect(optical.homography).toHaveLength(9);
  expect(optical.homography.every(Number.isFinite)).toBe(true);

  await page.getByLabel('Reset perspective').first().click();
  expect(await page.evaluate(() => (window as any).__geomState.optical)).toBeNull();

  await page.getByLabel('Reset geometry').first().click();
  const reset = await page.evaluate(() => (window as any).__geomState.geometry);
  expect(reset.rotation).toBe(0);
  expect(reset.straighten).toBe(0);
  expect(reset.flipHorizontal).toBe(false);
  expect(reset.flipVertical).toBe(false);
  expect(reset.crop).toBeNull();
});
