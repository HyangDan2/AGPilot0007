import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function photoFixture(page: Page, info: TestInfo, key: string, count: number, width = 64, height = 48): Promise<string> {
  const dir = path.resolve(`.private/workspace-cp3/fixtures/${info.project.name}/${key}`);
  await mkdir(dir, { recursive: true });
  const png = Buffer.from(
    await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#6d8a5b';
      ctx.fillRect(0, 0, width / 2, height);
      ctx.fillStyle = '#c9b184';
      ctx.fillRect(width / 2, 0, width / 2, height);
      return canvas.toDataURL().split(',')[1];
    }, { width, height }),
    'base64',
  );
  await Promise.all(Array.from({ length: count }, (_, index) => writeFile(path.join(dir, `photo-${index}.png`), png)));
  return dir;
}

async function openWorkspace(page: Page, dir: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  await expect(page.getByTestId('image-workspace')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Open photo', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Open photo or workspace' });
  await modal.getByTestId('workspace-folder-input').setInputFiles(dir);
  return page.getByTestId('workspace-strip');
}

test('multi-select copy/paste applies chosen groups to the selection with one undo step', async ({ page }, info) => {
  const dir = await photoFixture(page, info, 'copy-paste', 3);
  const strip = await openWorkspace(page, dir);
  await expect(strip.getByText('3 photos', { exact: true })).toBeVisible();

  await page.getByLabel('Exposure', { exact: true }).fill('0.8');

  await page.getByTestId('copy-paste-open').click();
  const dialog = page.getByTestId('copy-paste-dialog');
  await expect(dialog).toBeVisible();
  for (const group of ['film', 'grain', 'curves', 'camera', 'colorMixer', 'sharpening']) {
    await dialog.getByTestId(`copy-group-${group}`).uncheck();
  }
  await dialog.getByTestId('copy-parameters').click();
  await expect(dialog.getByTestId('copy-paste-status')).toContainText('Copied 1 groups from photo-0.png');
  await dialog.getByRole('button', { name: 'Close copy paste' }).click();

  await strip.getByRole('button', { name: 'Edit photo-1.png', exact: true }).click();
  await strip.getByRole('button', { name: 'Edit photo-2.png', exact: true }).click({ modifiers: ['Shift'] });
  await expect(strip.getByTestId('workspace-selection-count')).toHaveText('2 selected');
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0');

  await page.getByTestId('copy-paste-open').click();
  await expect(dialog.getByTestId('paste-parameters')).toHaveText('Paste to 2');
  await dialog.getByTestId('paste-parameters').click();
  await expect(dialog.getByTestId('copy-paste-status')).toContainText('Pasted to 2 photos');
  await dialog.getByRole('button', { name: 'Close copy paste' }).click();
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0.8');

  await page.getByTestId('image-workspace').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0');

  await strip.getByRole('button', { name: 'Edit photo-1.png', exact: true }).click();
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0.8');
});

test('batch export cancels queued photos, retries them and saves every unique file', async ({ page }, info) => {
  test.setTimeout(120000);
  const dir = await photoFixture(page, info, 'batch', 12, 1600, 1200);
  const strip = await openWorkspace(page, dir);
  await expect(strip.getByText('12 photos', { exact: true })).toBeVisible();

  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.getByTestId('batch-export-open').click();
  const dialog = page.getByTestId('batch-export-dialog');
  await dialog.getByTestId('batch-export-select-all').click();
  await dialog.getByTestId('batch-export-start').click();
  await dialog.getByTestId('batch-export-cancel-all').click();

  const reconciled = dialog.getByTestId('batch-export-reconciled');
  await expect(reconciled).toContainText(/cancelled [1-9]/, { timeout: 30000 });
  await dialog.getByTestId('batch-export-retry-failed').click();
  await expect(dialog.getByTestId('batch-export-summary')).toContainText('12/12 saved', { timeout: 40000 });
  await expect(reconciled).toHaveAttribute('data-ok', 'true');
  await expect(dialog.locator('[data-testid="batch-export-item"][data-status="succeeded"]')).toHaveCount(12);

  expect(downloads).toHaveLength(12);
  expect(new Set(downloads).size).toBe(12);
});

test('EXIF search filters the workspace and opens a result', async ({ page }, info) => {
  const dir = await photoFixture(page, info, 'exif', 3);
  const strip = await openWorkspace(page, dir);
  await expect(strip.getByText('3 photos', { exact: true })).toBeVisible();

  await page.getByTestId('exif-open').click();
  const dialog = page.getByTestId('exif-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('exif-text').fill('photo-1');
  await expect(dialog.getByTestId('exif-result')).toHaveCount(1);
  await expect(dialog.getByTestId('exif-result')).toContainText('photo-1.png');
  await dialog.getByTestId('exif-result').click();
  await expect(dialog).toBeHidden();
  await expect(strip.getByRole('button', { name: 'Edit photo-1.png', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('recommendation shows the top three films and applies one locally', async ({ page }, info) => {
  const dir = await photoFixture(page, info, 'recommend', 2);
  await openWorkspace(page, dir);

  await page.getByTestId('recommend-open').click();
  const dialog = page.getByTestId('recommend-dialog');
  await expect(dialog.getByTestId('recommend-card')).toHaveCount(3);
  await dialog.getByTestId('recommend-apply').first().click();
  await expect(dialog.getByTestId('recommend-status')).toContainText('applied to 1 photo');
});
