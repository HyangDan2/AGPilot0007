import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Local-only fixtures (never committed): ffmpeg -f lavfi testsrc …
const CLIP = path.resolve('.private/video-fixtures/clip.mp4');
const TALL = path.resolve('.private/video-fixtures/tall.mp4');
const fixtureMissing = !existsSync(CLIP);

async function workspaceWith(page: Page, info: TestInfo, key: string, videos: string[], photo = true): Promise<string> {
  const dir = path.resolve(`.private/video-fixtures/runs/${info.project.name}/${key}`);
  await mkdir(dir, { recursive: true });
  if (photo) {
    const png = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#6d8a5b';
        ctx.fillRect(0, 0, 64, 48);
        return canvas.toDataURL().split(',')[1];
      }),
      'base64',
    );
    await writeFile(path.join(dir, 'photo-0.png'), png);
  }
  for (const fixture of videos) await copyFile(fixture, path.join(dir, path.basename(fixture)));
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

async function setRange(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('ingests a video beside a photo and drives the timeline, trim and capability badges', async ({ page }, info) => {
  test.skip(fixtureMissing, `video fixture missing at ${CLIP}`);
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const strip = await openWorkspace(page, await workspaceWith(page, info, 'ingest', [CLIP]));
  await expect(strip.getByText('1 photos · 1 videos', { exact: true })).toBeVisible();
  const videoThumb = strip.locator('[data-testid="workspace-thumbnail"][data-kind="video"]');
  await expect(videoThumb).toHaveCount(1);
  await expect(videoThumb.getByTestId('workspace-video-icon')).toBeVisible();

  await strip.getByRole('button', { name: 'Open clip.mp4', exact: true }).click();
  const workspace = page.getByTestId('video-workspace');
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId('video-player')).toBeVisible();

  const summary = page.getByTestId('video-trim-summary');
  await expect(summary).toContainText('3.00s', { timeout: 20000 });
  await expect(page.getByTestId('video-time')).toContainText('/ 0:03.00');

  const badges = page.getByTestId('video-capability');
  await expect(badges).toHaveCount(5);
  for (const capability of ['mp4', 'webm', 'avc', 'vp9', 'audio']) {
    const badge = page.locator(`[data-testid="video-capability"][data-capability="${capability}"]`);
    await expect(badge).toHaveAttribute('data-supported', /^(true|false)$/);
    if (capability === 'mp4' || capability === 'webm') {
      const supported = (await badge.getAttribute('data-supported')) === 'true';
      const option = page.locator(`[data-testid="video-container"] option[value="${capability}"]`);
      if (supported) await expect(option).toBeEnabled();
      else await expect(option).toBeDisabled();
    }
  }

  await setRange(page, 'video-scrub', 1);
  await expect(page.getByTestId('video-time')).toContainText('0:01.00');

  await setRange(page, 'video-trim-in', 0.5);
  await expect(summary).toContainText('0.50s –');
  await setRange(page, 'video-trim-out', 1.5);
  await expect(summary).toContainText('0.50s – 1.50s · 1.00s · 30 frames @ 30fps');

  if (await page.getByTestId('video-engine-missing').isVisible()) {
    await expect(page.getByTestId('video-export')).toBeDisabled();
  }

  await page.getByRole('button', { name: 'Close video workspace' }).click();
  await expect(workspace).toHaveCount(0);
  await expect(strip.getByText('1 photos · 1 videos', { exact: true })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Edit photo-0.png', exact: true })).toBeVisible();

  info.annotations.push({ type: 'video-console-errors', description: errors.length ? errors.join(' | ') : 'none' });
  expect(errors).toEqual([]);
});

test('mobile profile blocks source resolution above 1080p and shows the memory guard', async ({ page }, info) => {
  test.skip(fixtureMissing || !info.project.name.startsWith('mobile'), 'mobile-only guard check');
  test.setTimeout(90000);
  const strip = await openWorkspace(page, await workspaceWith(page, info, 'mobile-limit', [TALL], false));
  await expect(strip.getByText('0 photos · 1 videos', { exact: true })).toBeVisible();
  await strip.getByRole('button', { name: 'Open tall.mp4', exact: true }).click();
  await expect(page.getByTestId('video-workspace')).toBeVisible();
  await expect(page.getByTestId('video-mobile-guard')).toBeVisible();
  await expect(page.getByTestId('video-mobile-limit')).toBeVisible();
  await expect(page.locator('[data-testid="video-resolution"] option[value="source"]')).toBeDisabled();
  await expect(page.getByTestId('video-export')).toBeDisabled();

  await page.getByTestId('video-resolution').selectOption('1080p');
  await expect(page.getByTestId('video-mobile-limit')).toHaveCount(0);
  await expect(page.locator('[data-testid="video-resolution"] option[value="source"]')).toBeDisabled();
});

test('video export either reports the pending engine binding or completes with a download', async ({ page }, info) => {
  test.skip(fixtureMissing || info.project.name !== 'chromium', 'desktop chromium only');
  test.setTimeout(180000);
  const strip = await openWorkspace(page, await workspaceWith(page, info, 'export', [CLIP], false));
  await strip.getByRole('button', { name: 'Open clip.mp4', exact: true }).click();
  await expect(page.getByTestId('video-trim-summary')).toContainText('3.00s', { timeout: 20000 });

  const exportButton = page.getByTestId('video-export');
  if (await page.getByTestId('video-engine-missing').isVisible()) {
    info.annotations.push({ type: 'video-engine', description: 'Q03 binding absent; export disabled' });
    await expect(exportButton).toBeDisabled();
    return;
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 150000 });
  await exportButton.click();
  await expect(page.getByTestId('video-progress')).toBeVisible();
  const download = await downloadPromise;
  await expect(page.getByTestId('video-done')).toBeVisible({ timeout: 150000 });
  info.annotations.push({ type: 'video-export', description: download.suggestedFilename() });
  expect(download.suggestedFilename()).toMatch(/\.(mp4|webm)$/);
});

test('video export cancels with a clear error and retries when the engine is bound', async ({ page }, info) => {
  test.skip(fixtureMissing || info.project.name !== 'chromium', 'desktop chromium only');
  test.setTimeout(180000);
  const strip = await openWorkspace(page, await workspaceWith(page, info, 'cancel', [CLIP], false));
  await strip.getByRole('button', { name: 'Open clip.mp4', exact: true }).click();
  await expect(page.getByTestId('video-trim-summary')).toContainText('3.00s', { timeout: 20000 });

  if (await page.getByTestId('video-engine-missing').isVisible()) {
    info.annotations.push({ type: 'video-engine', description: 'Q03 binding absent; cancel/retry covered after rebind' });
    await expect(page.getByTestId('video-export')).toBeDisabled();
    return;
  }

  await page.getByTestId('video-export').click();
  await page.getByTestId('video-cancel').click();
  await expect(page.getByTestId('video-error')).toContainText('Export cancelled');
  await expect(page.getByTestId('video-retry')).toBeVisible();
  const downloadPromise = page.waitForEvent('download', { timeout: 150000 });
  await page.getByTestId('video-retry').click();
  await downloadPromise;
  await expect(page.getByTestId('video-done')).toBeVisible({ timeout: 150000 });
});
