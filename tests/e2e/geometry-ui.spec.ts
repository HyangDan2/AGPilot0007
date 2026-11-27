import { test, expect } from '@playwright/test';

/**
 * CP3-01 UI mount: the geometry panel drives the shared store, quarter turns
 * swap the canvas backing size (derived by geometryOutputSize) and crop editing
 * renders the uncropped frame with the Q02 overlay on top.
 */
test.describe('Geometry panel and crop overlay', () => {
  test('rotates the derived canvas and opens crop editing with the overlay', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'Desktop layout only');
    await page.goto('/');
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();

    const canvas = page.locator('canvas').first();
    await page.waitForFunction(() => {
      const node = document.querySelector('canvas');
      return !!node && node.width > 0 && node.height > 0;
    });
    const before = await canvas.evaluate((node: HTMLCanvasElement) => ({
      width: node.width,
      height: node.height,
    }));

    await expect(page.getByTestId('geometry-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Rotate right 90 degrees' }).click();

    await page.waitForFunction(
      (start) => {
        const node = document.querySelector('canvas') as HTMLCanvasElement | null;
        return !!node && node.width === start.height && node.height === start.width;
      },
      before,
    );
    const rotated = await canvas.evaluate((node: HTMLCanvasElement) => ({
      width: node.width,
      height: node.height,
    }));
    expect(rotated).toEqual({ width: before.height, height: before.width });

    await page.getByRole('button', { name: 'Toggle crop editing' }).click();
    await expect(page.getByTestId('geometry-overlay')).toBeVisible();
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      await expect(page.getByTestId(`geometry-handle-${handle}`)).toBeVisible();
    }

    await page.getByRole('button', { name: 'Toggle crop editing' }).click();
    await expect(page.getByTestId('geometry-overlay')).toHaveCount(0);

    await page.getByRole('button', { name: 'Reset geometry' }).click();
    await page.waitForFunction(
      (start) => {
        const node = document.querySelector('canvas') as HTMLCanvasElement | null;
        return !!node && node.width === start.width && node.height === start.height;
      },
      before,
    );
  });
});