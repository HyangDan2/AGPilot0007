import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function fixtureDir(page: Page, info: TestInfo): Promise<string> {
  const dir = path.resolve('.private/batch-export/fixtures/' + info.project.name);
  await mkdir(dir, { recursive: true });
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#be634a';
      ctx.fillRect(0, 0, 64, 48);
      return canvas.toDataURL().split(',')[1];
    }),
    'base64',
  );
  await Promise.all([0, 1, 2].map((index) => writeFile(path.join(dir, `photo-${index}.png`), png)));
  return dir;
}

test('batch export runs the workspace selection with per-photo edits and keeps the workspace intact', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /Portrait/ }).filter({ visible: true }).first().click();
  await expect(page.getByTestId('image-workspace')).toBeVisible();

  const dir = await fixtureDir(page, info);
  await page.getByRole('button', { name: 'Open photo', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Open photo or workspace' });
  await modal.getByTestId('workspace-folder-input').setInputFiles(dir);
  const strip = page.getByTestId('workspace-strip');
  await expect(strip.getByText('3 photos', { exact: true })).toBeVisible();
  await expect(strip.getByTestId('workspace-thumbnail').first()).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Exposure', { exact: true }).fill('0.8');
  await strip.getByRole('button', { name: 'Edit photo-1.png', exact: true }).click();
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0');
  await page.getByLabel('Exposure', { exact: true }).fill('-0.5');
  await strip.getByRole('button', { name: 'Edit photo-0.png', exact: true }).click();
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0.8');

  await page.getByTestId('batch-export-open').click();
  const dialog = page.getByTestId('batch-export-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('batch-export-select-all').click();
  await expect(dialog.getByTestId('batch-export-item')).toHaveCount(3);

  await dialog.getByTestId('batch-export-start').click();
  const summary = dialog.getByTestId('batch-export-summary');
  await expect(summary).toContainText('3/3 saved', { timeout: 30000 });
  await expect(dialog.locator('[data-testid="batch-export-item"][data-status="succeeded"]')).toHaveCount(3);

  await dialog.getByRole('button', { name: 'Close batch export' }).click();
  await expect(page.getByLabel('Exposure', { exact: true })).toHaveValue('0.8');
  await expect(strip.getByRole('button', { name: 'Edit photo-0.png', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
