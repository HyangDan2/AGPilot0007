import { test, expect } from '@playwright/test';

const MOUNT_HARNESS = async () => {
  const load = (id: string) => import(/* @vite-ignore */ id);
  const pick = (module: any) => module?.default ?? module;
  const React: any = pick(await load('/@id/react'));
  const reactDom: any = pick(await load('/@id/react-dom/client'));
  const { MaskControls, MaskEditingOverlay } = await load(
    '/src/components/masks/MasksWorkspace.tsx',
  );
  const storeModule: any = await load('/src/stores/maskUiStore.ts');

  const host = document.createElement('div');
  host.id = 'mask-harness';
  host.style.cssText =
    'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:16px;background:#0b0d11;padding:16px';
  const frame = document.createElement('div');
  frame.id = 'mask-frame';
  frame.style.cssText =
    'position:relative;width:400px;height:300px;background:linear-gradient(135deg,#333,#777)';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:340px;height:640px;overflow:auto;display:flex';
  host.appendChild(frame);
  host.appendChild(panel);
  document.body.appendChild(host);

  reactDom.createRoot(frame).render(React.createElement(MaskEditingOverlay, { aspect: 4 / 3 }));
  reactDom.createRoot(panel).render(React.createElement(MaskControls, {}));
  (window as any).__maskStore = storeModule.useMaskUiStore;
  storeModule.useMaskUiStore.getState().addGroup();
  return true;
};

const localState = (page: any) =>
  page.evaluate(() => (window as any).__maskStore.getState().local);

test('mask panel creates masks, edits adjustments and drags handles', async ({ page }) => {
  // The harness is a fixed 756px desktop layout; mobile-chromium also reports browserName chromium.
  test.skip(test.info().project.name !== 'chromium', 'Desktop mask harness runs in Chromium');
  await page.goto('/');
  await page.evaluate(MOUNT_HARNESS);
  await expect(page.getByTestId('mask-panel')).toBeVisible();

  await page.getByTestId('mask-add-radial').click();
  const created = await localState(page);
  expect(created.groups).toHaveLength(1);
  expect(created.groups[0].masks).toHaveLength(1);
  expect(created.groups[0].masks[0].kind).toBe('radial');
  await expect(page.getByTestId('mask-overlay')).toBeVisible();

  await page.getByTestId('mask-adjust-exposure').fill('1.5');
  expect((await localState(page)).groups[0].adjustment.exposure).toBeCloseTo(1.5, 6);

  await page.getByTestId('mask-opacity').fill('0.4');
  expect((await localState(page)).groups[0].masks[0].opacity).toBeCloseTo(0.4, 2);

  await page.getByTestId('mask-blend').selectOption('subtract');
  expect((await localState(page)).groups[0].masks[0].blend).toBe('subtract');

  const handle = page.getByTestId('mask-handle-center');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragged = (await localState(page)).groups[0].masks[0];
  expect(dragged.center.x).toBeGreaterThan(0.56);
  expect(dragged.center.x).toBeLessThan(0.64);

  const radiusBefore = dragged.radiusX;
  await page.getByTestId('mask-handle-radius').focus();
  await page.keyboard.press('ArrowRight');
  expect((await localState(page)).groups[0].masks[0].radiusX).toBeGreaterThan(radiusBefore);

  await page.getByTestId('mask-inverted').check();
  expect((await localState(page)).groups[0].masks[0].inverted).toBe(true);
});

test('planLocalStage matches preview and export at geometry-scaled sizes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Local stage parity runs in Chromium');
  await page.goto('/');

  const result: any = await page.evaluate(async () => {
    const { planLocalStage } = await import('../../src/engine/local/maskRaster');
    const { normalizeLocalAdjustments } = await import('../../src/engine/contracts/localAdjustments');

    const state = normalizeLocalAdjustments({
      enabled: true,
      groups: [
        {
          id: 'g',
          name: 'Group',
          enabled: true,
          opacity: 1,
          blend: 'add',
          adjustment: { exposure: 0.5 },
          masks: [
            {
              id: 'radial',
              name: 'Radial',
              enabled: true,
              blend: 'add',
              opacity: 1,
              inverted: false,
              kind: 'radial',
              center: { x: 0.5, y: 0.5 },
              radiusX: 0.25,
              radiusY: 0.25,
              rotation: 0,
              feather: 0.4,
            },
            {
              id: 'luma',
              name: 'Luma',
              enabled: true,
              blend: 'add',
              opacity: 1,
              inverted: false,
              kind: 'luminance',
              lo: 0.55,
              hi: 0.95,
              feather: 0.2,
            },
          ],
        },
      ],
    });

    const makeSource = (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#1a1a1a');
      gradient.addColorStop(1, '#e8e8e8');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      return canvas;
    };

    const read = (canvas: HTMLCanvasElement, width: number, height: number, nx: number, ny: number) => {
      const x = Math.min(width - 1, Math.floor(nx * width));
      const y = Math.min(height - 1, Math.floor(ny * height));
      const data = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return { value: data[0], alpha: data[3] };
    };

    const preview = planLocalStage({ state, width: 96, height: 72, corrected: makeSource(96, 72) });
    const exported = planLocalStage({ state, width: 192, height: 144, corrected: makeSource(192, 144) });
    const previewSource = makeSource(96, 72);
    const inactive = planLocalStage({
      state: normalizeLocalAdjustments({ enabled: true, groups: [] }),
      width: 96,
      height: 72,
      corrected: previewSource,
    });

    const points = [
      { nis: [0.5, 0.5] as const, tolerance: 2 },
      { nis: [0.02, 0.02] as const, tolerance: 2 },
      { nis: [0.9, 0.1] as const, tolerance: 8 },
      { nis: [0.1, 0.9] as const, tolerance: 8 },
    ];

    return {
      inactive: inactive === null,
      plan: preview
        ? {
            width: preview.width,
            height: preview.height,
            groups: preview.groups,
            masks: preview.masks.length,
          }
        : null,
      preview: points.map(({ nis: [nx, ny] }) => read(preview!.masks[0], 96, 72, nx, ny)),
      exported: points.map(({ nis: [nx, ny] }) => read(exported!.masks[0], 192, 144, nx, ny)),
      tolerances: points.map((point) => point.tolerance),
      previewSize: [preview!.width, preview!.height],
      exportSize: [exported!.width, exported!.height],
    };
  });

  expect(result.inactive).toBe(true);
  expect(result.plan.masks).toBe(1);
  expect(result.plan.groups).toHaveLength(1);
  expect(result.plan.groups[0].adjustment.exposure).toBeCloseTo(0.5, 6);
  expect(result.plan.groups[0].opacity).toBe(1);
  expect(result.previewSize).toEqual([96, 72]);
  expect(result.exportSize).toEqual([192, 144]);

  result.preview.forEach((pixel: { value: number; alpha: number }, index: number) => {
    const exportedPixel = result.exported[index];
    expect(pixel.alpha).toBe(255);
    expect(exportedPixel.alpha).toBe(255);
    expect(Math.abs(pixel.value - exportedPixel.value)).toBeLessThanOrEqual(
      result.tolerances[index],
    );
  });
  expect(result.preview[0].value).toBeGreaterThan(240);
  expect(result.preview[1].value).toBe(0);
});

test('mask capacity is blocked with explicit messages and overlay hides in compare', async ({ page }) => {
  // Same fixed-width harness; mobile-chromium also reports browserName chromium.
  test.skip(test.info().project.name !== 'chromium', 'Desktop mask harness runs in Chromium');
  await page.goto('/');
  await page.evaluate(MOUNT_HARNESS);

  await page.evaluate(() => {
    const store = (window as any).__maskStore.getState();
    const groupId = store.local.groups[0].id;
    for (let index = 0; index < 16; index++) store.addMask(groupId, 'linear');
  });
  await page.getByTestId('mask-add-linear').click();
  await expect(page.getByTestId('mask-notice')).toContainText('limited to 16 masks');
  expect((await localState(page)).groups[0].masks).toHaveLength(16);

  await page.evaluate(() => {
    const store = (window as any).__maskStore.getState();
    for (let index = 0; index < 7; index++) store.addGroup();
    store.addGroup();
  });
  await expect(page.getByTestId('mask-notice')).toContainText('limited to 8 groups');
  expect((await localState(page)).groups).toHaveLength(8);

  await page.evaluate(async () => {
    const load = (id: string) => import(/* @vite-ignore */ id);
    const pick = (module: any) => module?.default ?? module;
    const React: any = pick(await load('/@id/react'));
    const reactDom: any = pick(await load('/@id/react-dom/client'));
    const { MaskEditingOverlay } = await load('/src/components/masks/MasksWorkspace.tsx');
    const host = document.createElement('div');
    host.id = 'hidden-mask-host';
    host.style.cssText = 'position:relative;width:200px;height:150px';
    document.body.appendChild(host);
    reactDom.createRoot(host).render(React.createElement(MaskEditingOverlay, { hidden: true }));
  });
  await expect(page.locator('#hidden-mask-host')).toBeEmpty();
});
