import { test, expect } from '@playwright/test';

test.describe('Navigation & External Hub Integration (Work Order v1.4)', () => {
  test('NAV-01 — Logo/Home Navigation preserves editing session and parameters', async ({ page }) => {
    await page.goto('/');

    // 1. Initial load starts on Home Screen
    await expect(page.locator('text=The Northern Palette').filter({ visible: true }).first()).toBeVisible();

    // 2. Open a sample photograph (Portrait)
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();

    // Verify canvas is now rendered in editor view
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // 3. Select non-default film: SKELD
    const skeldBtn = page.locator('button', { hasText: 'SKELD' }).filter({ visible: true }).first();
    await skeldBtn.click();
    await expect(page.getByText('Editorial Chrome').filter({ visible: true }).first()).toBeVisible();

    // 4. Change an adjustment value (Exposure)
    let exposureSlider = page.locator('input[data-testid="slider-exposure"]').filter({ visible: true }).first();
    if (!(await exposureSlider.isVisible())) {
      // Mobile drawer toggle
      await page.locator('button', { hasText: /Adjustments/i }).filter({ visible: true }).first().click();
      await page.waitForTimeout(200);
      exposureSlider = page.locator('input[data-testid="slider-exposure"]').filter({ visible: true }).first();
    }
    await exposureSlider.fill('1.5');
    await page.waitForTimeout(200);

    // 5. Click top-left branding to navigate to home screen
    const homeBtn = page.getByRole('button', { name: 'Go to Film Studio home' });
    await expect(homeBtn).toBeVisible();
    await homeBtn.click();

    // 6. Verify Home Screen is displayed
    await expect(page.locator('text=The Northern Palette').filter({ visible: true }).first()).toBeVisible();
    const continueBtn = page.getByTestId('continue-editing-btn').filter({ visible: true }).first();
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toContainText('Continue Editing');

    // Verify active session summary shows SKELD
    await expect(page.getByText('SKELD').filter({ visible: true }).first()).toBeVisible();

    // 7. Click Continue Editing
    await continueBtn.click();

    // 8. Verify returned to editor view with same image, SKELD film, and +1.5 Exposure
    await expect(canvas).toBeVisible();
    await expect(page.getByText('Editorial Chrome').filter({ visible: true }).first()).toBeVisible();

    let restoredSlider = page.locator('input[data-testid="slider-exposure"]').filter({ visible: true }).first();
    if (!(await restoredSlider.isVisible())) {
      await page.locator('button', { hasText: /Adjustments/i }).filter({ visible: true }).first().click();
      await page.waitForTimeout(200);
      restoredSlider = page.locator('input[data-testid="slider-exposure"]').filter({ visible: true }).first();
    }
    expect(await restoredSlider.inputValue()).toBe('1.5');
  });

  test('NAV-02 — External Hub Links configured with target=_blank and rel=noopener noreferrer', async ({ page }) => {
    await page.goto('/');

    // 1. Open the three-dot menu
    const menuBtn = page.locator('#main-nav-menu-button');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // 2. Locate HD2Lab Web-HQ link
    const hd2labLink = page.locator('a[href="https://hyangdan2.github.io/"]');
    await expect(hd2labLink).toBeVisible();
    await expect(hd2labLink).toContainText('HD2Lab Web-HQ');
    await expect(hd2labLink).toHaveAttribute('target', '_blank');
    await expect(hd2labLink).toHaveAttribute('rel', 'noopener noreferrer');

    // 3. Locate ApplicationHub link
    const applicationHubLink = page.locator('a[href="https://hyangdan2.github.io/ApplicationHub/"]');
    await expect(applicationHubLink).toBeVisible();
    await expect(applicationHubLink).toContainText('ApplicationHub');
    await expect(applicationHubLink).toHaveAttribute('target', '_blank');
    await expect(applicationHubLink).toHaveAttribute('rel', 'noopener noreferrer');

    // 4. Verify opening an external link does not replace the current Film Studio tab
    expect(page.url()).toMatch(/localhost|AGPilot0007/);
    expect(page.url()).not.toBe('https://hyangdan2.github.io/');
  });

  const VIEWPORTS = [
    { width: 320, height: 640, name: 'mobile-small' },
    { width: 375, height: 667, name: 'mobile-se' },
    { width: 390, height: 844, name: 'mobile-standard' },
    { width: 768, height: 1024, name: 'tablet-portrait' },
    { width: 1024, height: 768, name: 'tablet-landscape' },
    { width: 1440, height: 900, name: 'desktop-standard' },
  ];

  for (const vp of VIEWPORTS) {
    test(`NAV-03 — Responsive Menu at ${vp.width}x${vp.height} (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Check no unintended horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(overflow).toBe(false);

      // Verify Open and Export buttons are present and not blocked
      const openBtn = page.getByRole('button', { name: /Open/i });
      await expect(openBtn).toBeVisible();
      const exportBtn = page.getByRole('button', { name: /Export/i });
      await expect(exportBtn).toBeVisible();

      // Verify Three-dot button is visible
      const menuBtn = page.locator('#main-nav-menu-button');
      await expect(menuBtn).toBeVisible();

      // Open menu
      await menuBtn.click();
      const dropdown = page.locator('div[role="menu"]');
      await expect(dropdown).toBeVisible();

      // Ensure menu stays within viewport bounds (no right or left clipping)
      const menuBox = await dropdown.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(vp.width + 4);
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);

      // Verify external links are reachable inside menu
      await expect(page.locator('a[href="https://hyangdan2.github.io/"]')).toBeVisible();
      await expect(page.locator('a[href="https://hyangdan2.github.io/ApplicationHub/"]')).toBeVisible();

      // Close menu with Escape
      await page.keyboard.press('Escape');
      await expect(dropdown).not.toBeVisible();
    });
  }

  test('NAV-04 — Keyboard Accessibility and Focus Restoration', async ({ page }) => {
    await page.goto('/');

    // 1. Branding is accessible via keyboard
    const homeBtn = page.getByRole('button', { name: 'Go to Film Studio home' });
    await homeBtn.focus();
    await expect(homeBtn).toBeFocused();

    // 2. Menu trigger exposes aria-expanded
    const menuBtn = page.locator('#main-nav-menu-button');
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');

    await menuBtn.click();
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    const dropdown = page.locator('div[role="menu"]');
    await expect(dropdown).toBeVisible();

    // 3. Escape closes menu and restores focus to menu trigger
    await page.keyboard.press('Escape');
    await expect(dropdown).not.toBeVisible();
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(menuBtn).toBeFocused();
  });

  test('NAV-05 — Regression: editing, film selection, zoom, export remain intact', async ({ page }) => {
    await page.goto('/');

    // Load sample image
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Switch film
    await page.locator('button', { hasText: 'SOLVIK' }).filter({ visible: true }).first().click();
    await expect(page.getByText('Vivid Nature').filter({ visible: true }).first()).toBeVisible();

    // Split comparison mode
    await page.getByRole('button', { name: 'Split' }).filter({ visible: true }).first().click();

    // Zoom in
    await page.keyboard.press('+');

    // Open export modal
    const exportBtn = page.getByRole('button', { name: /Export/i });
    await exportBtn.click();
    await expect(page.getByText('Export Final Image')).toBeVisible();

    // Close export modal
    await page.keyboard.press('Escape');
    await expect(page.getByText('Export Final Image')).not.toBeVisible();
  });
});
