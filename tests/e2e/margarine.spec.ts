import { test, expect } from '@playwright/test';

test('mobile sheet overlays the image without resizing or resetting zoom', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'Mobile sheet');
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  await page.getByTitle('Zoom In (+)', { exact: true }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas && Math.abs(new DOMMatrix(getComputedStyle(canvas.parentElement!).transform).a - 1.25) < .001;
  });
  const workspace = page.getByTestId('image-workspace');
  const before = await workspace.boundingBox();
  const canvasBefore = await page.locator('canvas').boundingBox();
  await page.getByRole('button', { name: /Adjustments \(/ }).click();
  const sheet = page.getByTestId('adjustment-sheet');
  await expect(sheet).toBeVisible();
  expect(await workspace.boundingBox()).toEqual(before);
  const canvasAfter = await page.locator('canvas').boundingBox();
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(canvasAfter![key] - canvasBefore![key])).toBeLessThanOrEqual(1);
  await page.getByTestId('slider-exposure').filter({ visible: true }).fill('.5');
  await page.getByRole('button', { name: 'Reset Exposure to default', exact: true }).filter({ visible: true }).tap();
  await expect(page.getByTestId('slider-exposure').filter({ visible: true })).toHaveValue('0');
  await page.screenshot({ path: testInfo.outputPath('sheet.png') });
  await page.getByRole('button', { name: 'Collapse adjustments', exact: true }).tap();
  await expect(sheet).not.toBeVisible();
  expect(await workspace.boundingBox()).toEqual(before);
  await page.getByRole('button', { name: /Adjustments \(/ }).click();
  await expect(page.getByTestId('slider-exposure').filter({ visible: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Close adjustments', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(await workspace.boundingBox()).toEqual(before);
  await page.getByRole('button', { name: /Adjustments \(/ }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await page.getByRole('button', { name: /Adjustments \(/ }).click();
  const handle = page.getByTestId('sheet-handle');
  await expect(handle).toBeVisible();
  // Wait for entry animation before exercising a downward handle gesture.
  await expect.poll(() => sheet.evaluate(el => Math.abs(new DOMMatrix(getComputedStyle(el).transform).m42))).toBeLessThan(.1);
  const h = await handle.boundingBox();
  await page.mouse.move(h!.x + 20, h!.y + 15);
  await page.mouse.down();
  await page.mouse.move(h!.x + 20, h!.y + 95, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).not.toBeVisible();
});

test('Margarine reselect opens searchable 58-look dialog, selects, and restores the last look', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  const card = page.getByTestId('margarine-card').filter({ visible: true });
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const modal = page.getByRole('dialog', { name: 'MARGARINE', exact: true });
  await expect(modal).not.toBeVisible();
  await card.click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { pressed: true })).toContainText('Soft White');
  await expect(modal.getByText('58 looks', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('margarine.png') });
  await modal.getByRole('textbox', { name: 'Search Margarine presets' }).fill('Cream');
  await modal.getByRole('button', { name: /Cream Daylight/ }).click();
  await expect(modal).not.toBeVisible();
  await expect(card).toContainText('Cream Daylight');
  await page.locator('button').filter({ hasText: 'RIMVA' }).filter({ visible: true }).first().click();
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await card.click();
  await expect(card).toContainText('Cream Daylight');
  await card.click();
  await modal.getByRole('combobox').selectOption('Cafe');
  await expect(modal.getByRole('button', { name: /House Brown/ })).toBeVisible();
  await modal.getByRole('textbox').fill('nonexistent');
  await expect(modal.getByText('No matching looks.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  expect(errors).toEqual([]);
});


test('tablet adjustment title collapses the closable panel', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  const toggle = page.getByRole('button', { name: 'Adjustments', exact: true });
  await toggle.click();
  await expect(page.getByRole('heading', { name: 'Manual Adjustments' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse adjustments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manual Adjustments' })).not.toBeVisible();
});
