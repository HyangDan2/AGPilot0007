import { test, expect } from '@playwright/test';

test.describe('Film Studio Native Photo Library Export & Share (Work Order v1.5)', () => {
  test('EXP-01 — Two-Stage Export Workflow: Stage A (Configure & Prepare) to Stage B (Save & Share)', async ({ page }) => {
    await page.goto('/');

    // Load sample image to activate editing controls
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();

    // Open Export dialog
    await page.getByRole('button', { name: 'Export' }).filter({ visible: true }).first().click();

    // Verify Stage A elements
    await expect(page.getByText('Export Final Image')).toBeVisible();
    await expect(page.getByText('Stage A: Prepare')).toBeVisible();
    await expect(page.getByText('Output Format')).toBeVisible();
    await expect(page.getByText('Output Resolution')).toBeVisible();
    await expect(page.getByRole('button', { name: /Prepare Photo/i })).toBeVisible();

    // Verify resolution presets
    await expect(page.getByRole('button', { name: /Full \(100%\)/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /High \(75%\)/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Social \(50%\)/i })).toBeVisible();

    // Click "Prepare Photo" to start Stage A -> Stage B transition
    await page.getByRole('button', { name: /Prepare Photo/i }).click();

    // Verify progress or completion to Stage B
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Photo Prepared in Memory')).toBeVisible();

    // Verify Stage B actions are rendered
    await expect(page.getByRole('button', { name: /Download File/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Preview Image/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Prepare Again/i })).toBeVisible();
  });

  test('EXP-02 — Download File executes directly from prepared memory without re-rendering', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Export' }).filter({ visible: true }).first().click();

    // Prepare photo
    await page.getByRole('button', { name: /Prepare Photo/i }).click();
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible({ timeout: 10000 });

    // Set up download listener
    const downloadPromise = page.waitForEvent('download');

    // Click Download File
    await page.getByRole('button', { name: /Download File/i }).click();

    // Verify download triggered
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('HD2Lab_FilmStudio.jpg');

    // Verify status feedback
    await expect(page.getByText('Download started!')).toBeVisible();
  });

  test('EXP-03 — Preview Image opens full view with long-press mobile saving instructions', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Export' }).filter({ visible: true }).first().click();

    // Prepare photo
    await page.getByRole('button', { name: /Prepare Photo/i }).click();
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible({ timeout: 10000 });

    // Click Preview Image
    await page.getByRole('button', { name: /Preview Image/i }).click();

    // Verify preview overlay is visible
    await expect(page.getByAltText('Full Resolution Export Preview')).toBeVisible();
    await expect(page.getByText(/Long-press \(tap and hold\) the image above/i)).toBeVisible();

    // Close preview via close button
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(page.getByAltText('Full Resolution Export Preview')).not.toBeVisible();
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible();
  });

  test('EXP-04 — Prepare Again allows re-configuring format and resolution scale', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Export' }).filter({ visible: true }).first().click();

    // First preparation with default JPEG
    await page.getByRole('button', { name: /Prepare Photo/i }).click();
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('JPEG', { exact: true })).toBeVisible();

    // Click Prepare Again
    await page.getByRole('button', { name: /Prepare Again/i }).click();
    await expect(page.getByText('Stage A: Prepare')).toBeVisible();

    // Switch to PNG and Social 50%
    await page.getByRole('button', { name: /PNG \(Lossless\)/i }).click();
    await page.getByRole('button', { name: /Social \(50%\)/i }).click();

    // Prepare second time
    await page.getByRole('button', { name: /Prepare Photo/i }).click();
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible({ timeout: 10000 });

    // Verify updated metadata
    await expect(page.getByText('PNG', { exact: true })).toBeVisible();
    await expect(page.getByText(/HD2Lab_FilmStudio\.png/)).toBeVisible();
  });

  test('EXP-05 — Web Share API integration handles share and clean user cancellation', async ({ page }) => {
    // Inject mock navigator.share and canShare before page load
    await page.addInitScript(() => {
      let shareCalls: any[] = [];
      (window as any).__shareCalls = shareCalls;
      (window.navigator as any).canShare = (_data: any) => true;
      (window.navigator as any).share = async (data: any) => {
        shareCalls.push(data);
        if ((window as any).__simulateAbort) {
          const err = new Error('The user aborted a request.');
          err.name = 'AbortError';
          throw err;
        }
        return Promise.resolve();
      };
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Export' }).filter({ visible: true }).first().click();

    // Prepare photo
    await page.getByRole('button', { name: /Prepare Photo/i }).click();
    await expect(page.getByText('Stage B: Save & Share')).toBeVisible({ timeout: 10000 });

    // Verify "Save to Photos / Share" button is present and active
    const shareBtn = page.getByRole('button', { name: /Save to Photos \/ Share/i });
    await expect(shareBtn).toBeVisible();

    // Trigger share
    await shareBtn.click();

    // Verify success feedback
    await expect(page.getByText('Shared successfully!')).toBeVisible();

    // Check share call parameters
    const shareCalls = await page.evaluate(() => (window as any).__shareCalls);
    expect(shareCalls.length).toBe(1);
    expect(shareCalls[0].title).toContain('HD2Lab_FilmStudio.jpg');

    // Test AbortError handling (cancellation)
    await page.evaluate(() => {
      (window as any).__simulateAbort = true;
    });

    await shareBtn.click();

    // Cancellation should not display an error banner
    await expect(page.locator('.bg-red-950\\/70')).not.toBeVisible();
  });
});
