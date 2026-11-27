import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RAW_FIXTURE = path.resolve('.private/raw-fixtures/R0000357.DNG');

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
  await expect(page.getByTestId('image-workspace')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Open photo', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Open photo or workspace' });
  await modal.getByTestId('workspace-folder-input').setInputFiles(dir);
  return page.getByTestId('workspace-strip');
}

test('multi-select copy/paste applies chosen groups to the selection with one undo step', async ({ page }, info) => {
  test.setTimeout(60000);
  const dir = await photoFixture(page, info, 'copy-paste', 3);
  const strip = await openWorkspace(page, dir);
  await expect(strip.getByText('3 photos', { exact: true })).toBeVisible();

  await page.getByLabel('Exposure', { exact: true }).fill('0.8');

  await page.getByTestId('copy-paste-open').click();
  const dialog = page.getByTestId('copy-paste-dialog');
  await expect(dialog).toBeVisible();
  for (const group of ['film', 'grain', 'curves', 'camera', 'colorMixer', 'sharpening', 'geometry', 'optical', 'localAdjustments']) {
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

test('geometry paste rotates a selected photo and the batch export is rotated full-res', async ({ page }, info) => {
  test.setTimeout(120000);
  const dir = await photoFixture(page, info, 'geometry-paste', 2, 1600, 1200);
  const strip = await openWorkspace(page, dir);
  await expect(strip.getByText('2 photos', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Rotate right 90 degrees' }).click();
  await page.getByTestId('copy-paste-open').click();
  const dialog = page.getByTestId('copy-paste-dialog');
  for (const group of ['film', 'tone', 'grain', 'curves', 'camera', 'colorMixer', 'sharpening', 'optical', 'localAdjustments']) {
    await dialog.getByTestId(`copy-group-${group}`).uncheck();
  }
  await dialog.getByTestId('copy-parameters').click();
  await expect(dialog.getByTestId('copy-paste-status')).toContainText('Copied 1 groups from photo-0.png');
  await dialog.getByRole('button', { name: 'Close copy paste' }).click();

  await strip.getByRole('button', { name: 'Edit photo-1.png', exact: true }).click();
  await expect(strip.getByTestId('workspace-selection-count')).toHaveText('1 selected');
  await page.getByTestId('copy-paste-open').click();
  await dialog.getByTestId('paste-parameters').click();
  await expect(dialog.getByTestId('copy-paste-status')).toContainText('Pasted to 1 photo');
  await dialog.getByRole('button', { name: 'Close copy paste' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('batch-export-open').click();
  const batch = page.getByTestId('batch-export-dialog');
  await batch.getByTestId('batch-export-start').click();
  await expect(batch.getByTestId('batch-export-summary')).toContainText('1/1 saved', { timeout: 60000 });

  const download = await downloadPromise;
  const downloaded = await readFile((await download.path())!);
  const size = await page.evaluate(
    (base64) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('downloaded export could not be decoded'));
        img.src = `data:image/jpeg;base64,${base64}`;
      }),
    downloaded.toString('base64'),
  );
  expect(size).toEqual({ width: 1200, height: 1600 });
});

test('batch export cancels queued photos, retries them and saves every unique file', async ({ page }, info) => {
  test.setTimeout(180000);
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
  // The retry re-runs 10 jobs at the device concurrency; on loaded CI hosts the
  // mobile encode path needs well over 40 s to drain them all.
  await expect(dialog.getByTestId('batch-export-summary')).toContainText('12/12 saved', { timeout: 120000 });
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

test('RAW batch export decodes the full-resolution original, not the preview', async ({ page }, info) => {
  test.skip(!existsSync(RAW_FIXTURE), `RAW fixture missing at ${RAW_FIXTURE}`);
  test.setTimeout(300000);
  const dir = path.resolve(`.private/workspace-cp3/fixtures/${info.project.name}/raw`);
  await mkdir(dir, { recursive: true });
  await copyFile(RAW_FIXTURE, path.join(dir, 'R0000357.DNG'));

  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const strip = await openWorkspace(page, dir);
  await expect(strip.getByText('1 photos', { exact: true })).toBeVisible();
  await strip.getByRole('button', { name: 'Edit R0000357.DNG', exact: true }).click();
  await expect(strip.getByTestId('workspace-selection-count')).toHaveText('1 selected', { timeout: 120000 });

  const started = Date.now();
  const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
  await page.getByTestId('batch-export-open').click();
  const batch = page.getByTestId('batch-export-dialog');
  await batch.getByTestId('batch-export-start').click();
  await expect(batch.getByTestId('batch-export-summary')).toContainText('1/1 saved', { timeout: 240000 });
  const durationMs = Date.now() - started;

  const download = await downloadPromise;
  const downloaded = await readFile((await download.path())!);
  const size = await page.evaluate(
    (base64) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('downloaded RAW export could not be decoded'));
        img.src = `data:image/jpeg;base64,${base64}`;
      }),
    downloaded.toString('base64'),
  );

  info.annotations.push(
    { type: 'raw-export', description: `${size.width}x${size.height} · ${downloaded.byteLength} bytes · ${durationMs} ms` },
    { type: 'console-errors', description: errors.length ? errors.join(' | ') : 'none' },
  );
  console.log(`[raw-export] ${size.width}x${size.height} · ${downloaded.byteLength} bytes · ${durationMs} ms · console errors: ${errors.length}`);
  expect(size).toEqual({ width: 6000, height: 4000 });
  expect(download.suggestedFilename()).toBe('R0000357_HD2Lab_FilmStudio.jpg');
  expect(errors).toEqual([]);
});
