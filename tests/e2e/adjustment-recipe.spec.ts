import { test, expect, Page } from '@playwright/test';

async function openRecipes(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.locator('#main-nav-menu-button').click();
    await page.getByRole('button', { name: 'Film Recipes', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Recipes', exact: true }).click();
  }
}

test('slider double-click does not reset adjustments', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  if (isMobile) await page.getByRole('button', { name: /Adjustments \(/ }).click();
  const exposure = page.getByTestId('slider-exposure').filter({ visible: true });
  const contrast = page.getByTestId('slider-contrast').filter({ visible: true });
  await exposure.fill('-1');
  await contrast.fill('25');
  const bounds = await exposure.boundingBox();
  await exposure.dblclick({ position: { x: bounds!.width * 0.75, y: bounds!.height / 2 } });
  await expect(exposure).not.toHaveValue('0');
  await expect(contrast).toHaveValue('25');
});

test('value button resets with one click or tap and keyboard without changing other adjustments', async ({ page, isMobile }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  if (isMobile) await page.getByRole('button', { name: /Adjustments \(/ }).click();
  const exposure = page.getByTestId('slider-exposure').filter({ visible: true });
  const contrast = page.getByTestId('slider-contrast').filter({ visible: true });
  await exposure.fill('1.5');
  await contrast.fill('25');
  const reset = page.getByRole('button', { name: 'Reset Exposure to default', exact: true }).filter({ visible: true });
  const bounds = await reset.boundingBox();
  expect(bounds!.width).toBeLessThan(64);
  expect(bounds!.height).toBeLessThanOrEqual(20);
  if (isMobile) await reset.tap();
  else await reset.click();
  await expect(exposure).toHaveValue('0');
  await expect(contrast).toHaveValue('25');
  await exposure.fill('0.5');
  await reset.focus();
  await reset.press('Enter');
  await expect(exposure).toHaveValue('0');
  if (isMobile) {
    await page.getByRole('button', { name: 'film', exact: true }).click();
    const strength = page.getByTestId('slider-filmStrength').filter({ visible: true });
    await strength.fill('35');
    await page.getByRole('button', { name: 'Reset Film Strength to default' }).tap();
    await expect(strength).toHaveValue('100');
    await page.getByRole('button', { name: 'light', exact: true }).click();
    await expect(contrast).toHaveValue('25');
  } else {
    const strength = page.getByTestId('slider-filmStrength').filter({ visible: true });
    await strength.fill('35');
    await page.getByRole('button', { name: 'Reset Film Strength to default' }).filter({ visible: true }).click();
    await expect(strength).toHaveValue('100');
    await expect(contrast).toHaveValue('25');
  }
  await page.screenshot({ path: testInfo.outputPath('value-reset.png') });
});

test('recipe imports preserve modal position and contain long names and growing lists', async ({ page, isMobile }) => {
  await page.goto('/');
  await openRecipes(page, isMobile);
  const dialog = page.getByRole('dialog', { name: 'Film Recipe Manager' });
  const initial = await dialog.boundingBox();
  const file = { name: 'recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    name: 'Long imported recipe '.repeat(12), baseFilmId: 'FS-007', adjustments: { exposure: 0.2 },
  })) };
  const input = dialog.locator('input[type=file]');
  for (let i = 1; i <= 7; i++) {
    await input.setInputFiles(file);
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(i);
    await expect(dialog.getByRole('status')).toContainText('Successfully imported');
    expect(await dialog.boundingBox()).toEqual(initial);
  }
  await dialog.getByRole('button', { name: 'Dismiss recipe notification' }).click();
  expect(await dialog.boundingBox()).toEqual(initial);
  const bounds = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await expect(dialog.getByRole('button', { name: 'Import Recipe (.json)' })).toBeInViewport();
  const list = dialog.getByTestId('recipe-list');
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await dialog.getByRole('button', { name: 'Apply', exact: true }).last().click();
  await expect(dialog).not.toBeVisible();
});
