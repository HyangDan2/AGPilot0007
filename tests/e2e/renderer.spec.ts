import { test, expect } from '@playwright/test';

test.describe('WebGL Renderer & Pixel Color Verification', () => {
  test('renders non-blank pixels and updates when film profile changes', async ({ page }) => {
    await page.goto('/');

    // Load Color Target calibration sample
    await page.getByRole('button', { name: 'Color Target' }).filter({ visible: true }).first().click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Helper to extract pixel colors from center of canvas using evaluate
    const getCenterPixels = async () => {
      return await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement;
        if (!c) return null;
        const gl = c.getContext('webgl2');
        if (!gl) return null;
        const w = c.width;
        const h = c.height;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);
        const buf = new Uint8Array(4);
        gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return Array.from(buf);
      });
    };

    // Wait a brief moment for WebGL initial draw
    await page.waitForTimeout(400);

    const initialPixels = await getCenterPixels();
    expect(initialPixels).not.toBeNull();
    // Verify non-blank (not all zeros)
    const isBlank = initialPixels!.every((val) => val === 0);
    expect(isBlank).toBe(false);

    // Switch film from VÆRN (FS-001) to SKELD (FS-002)
    const skeldBtn = page.locator('button', { hasText: 'SKELD' }).filter({ visible: true }).first();
    await skeldBtn.click();
    await page.waitForTimeout(400);

    const skeldPixels = await getCenterPixels();
    expect(skeldPixels).not.toBeNull();

    // Verify pixels are demonstrably different
    const pixelDiff = Math.abs(skeldPixels![0] - initialPixels![0]) +
                      Math.abs(skeldPixels![1] - initialPixels![1]) +
                      Math.abs(skeldPixels![2] - initialPixels![2]);
    expect(pixelDiff).toBeGreaterThanOrEqual(1);

    // Now switch to RIMVA (FS-009 monochrome)
    const rimvaBtn = page.locator('button', { hasText: 'RIMVA' }).filter({ visible: true }).first();
    await rimvaBtn.click();
    await page.waitForTimeout(400);

    const rimvaPixels = await getCenterPixels();
    expect(rimvaPixels).not.toBeNull();
    // RIMVA is pure monochrome: R == G == B
    expect(Math.abs(rimvaPixels![0] - rimvaPixels![1])).toBeLessThanOrEqual(2);
    expect(Math.abs(rimvaPixels![1] - rimvaPixels![2])).toBeLessThanOrEqual(2);
  });

  test('exposure adjustment directly alters rendered luminance', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const getCenterPixelLuminance = async () => {
      return await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement;
        const gl = c.getContext('webgl2');
        if (!gl) return 0;
        const cx = Math.floor(c.width / 2);
        const cy = Math.floor(c.height / 2);
        const buf = new Uint8Array(4);
        gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return 0.299 * buf[0] + 0.587 * buf[1] + 0.114 * buf[2];
      });
    };

    await page.waitForTimeout(400);
    const lumBase = await getCenterPixelLuminance();

    // Check if on mobile and expand adjustments drawer if needed
    const mobileAdjustToggle = page.locator('button', { hasText: 'Adjustments' }).filter({ visible: true }).first();
    if (await mobileAdjustToggle.isVisible()) {
      await mobileAdjustToggle.click();
      await page.waitForTimeout(200);
      // Select the Light tab on mobile where exposure is
      const lightTab = page.locator('button', { hasText: 'Light' }).filter({ visible: true }).first();
      if (await lightTab.isVisible()) {
        await lightTab.click();
        await page.waitForTimeout(100);
      }
    }

    // Increase exposure slider
    const exposureSlider = page.locator('[data-testid="slider-exposure"]:visible').first();
    await exposureSlider.fill('2.0');
    await page.waitForTimeout(300);

    const lumHigh = await getCenterPixelLuminance();
    // Higher exposure must increase luminance
    expect(lumHigh).toBeGreaterThan(lumBase);
  });

  test('image replacement updates canvas texture and renders properly', async ({ page }) => {
    await page.goto('/');
    // First load portrait
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();
    await page.waitForTimeout(300);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // If on desktop/tablet header sample buttons are visible, click Landscape.
    // If on mobile, open hamburger menu and click Landscape.
    const desktopLandscape = page.locator('header').getByRole('button', { name: 'Landscape' }).filter({ visible: true });
    if (await desktopLandscape.isVisible()) {
      await desktopLandscape.click();
    } else {
      // Mobile hamburger
      await page.locator('button[aria-label="More options"]').click();
      await page.getByRole('button', { name: /Landscape/i }).filter({ visible: true }).click();
    }
    await page.waitForTimeout(300);

    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
  });
});
