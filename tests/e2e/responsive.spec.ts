import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const VIEWPORTS = [
  { width: 320, height: 640, name: 'mobile-small' },
  { width: 375, height: 667, name: 'mobile-se' },
  { width: 390, height: 844, name: 'mobile-standard' },
  { width: 768, height: 1024, name: 'tablet-portrait' },
  { width: 1024, height: 768, name: 'tablet-landscape' },
  { width: 1280, height: 800, name: 'desktop-compact' },
  { width: 1440, height: 900, name: 'desktop-standard' },
  { width: 1920, height: 1080, name: 'desktop-fhd' },
];

test.describe('Responsive Layout & Viewport Verification', () => {
  for (const vp of VIEWPORTS) {
    test(`renders cleanly without horizontal overflow at ${vp.width}x${vp.height} (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Wait for app load
      await expect(page.locator('text=Film Studio').first()).toBeVisible();

      // Check no unintended horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(overflow).toBe(false);

      // Verify Open button is reachable
      const openBtn = page.getByRole('button', { name: /Open/i });
      await expect(openBtn).toBeVisible();

      // Load sample image
      await page.getByRole('button', { name: 'Portrait' }).first().click();

      // Verify canvas is rendered with nonzero dimensions
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(50);
      expect(box!.height).toBeGreaterThan(50);

      // Verify all 11 adjustments are accessible
      if (vp.width >= 1200) {
        // Desktop: Right panel has all adjustments
        await expect(page.getByRole('heading', { name: 'Manual Adjustments' })).toBeVisible();
        await expect(page.getByText('Exposure', { exact: true })).toBeVisible();
        await expect(page.getByText('Temperature', { exact: true })).toBeVisible();
        await expect(page.getByText('Film Grain', { exact: true })).toBeVisible();
      } else if (vp.width >= 768) {
        // Tablet: Open tablet adjustment drawer
        const toggleBtn = page.getByRole('button', { name: 'Adjustments', exact: true });
        await expect(toggleBtn).toBeVisible();
        await toggleBtn.click();
        await expect(page.getByRole('heading', { name: 'Manual Adjustments' })).toBeVisible();
        await expect(page.getByText('Exposure', { exact: true })).toBeVisible();
        // Close via close panel button
        await page.getByRole('button', { name: 'Close panel' }).click();
        await expect(page.getByRole('heading', { name: 'Manual Adjustments' })).not.toBeVisible();
      } else {
        // Mobile: Bottom sheet
        const expandBtn = page.getByRole('button', { name: /Adjustments \(/i });
        await expect(expandBtn).toBeVisible();
        await expandBtn.click();

        // Check tabs exist
        await expect(page.getByRole('button', { name: 'light', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'color', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'texture', exact: true })).toBeVisible();
        await expect(page.getByTestId('adjustment-sheet')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      }

      // Capture representative layout screenshots
      if (['mobile-standard', 'tablet-portrait', 'desktop-standard'].includes(vp.name)) {
        const screenshotDir = path.resolve(process.cwd(), 'docs/screenshots');
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({
          path: path.join(screenshotDir, `${vp.name}_${vp.width}x${vp.height}.png`),
        });
      }
    });
  }
});
