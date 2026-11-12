import { test, expect } from '@playwright/test';

test.describe('Film Studio E2E Workflow', () => {
  test('loads application and displays branding and controls', async ({ page }) => {
    await page.goto('/');

    // Check title and branding
    await expect(page).toHaveTitle(/Film Studio \| HD2Lab/);
    await expect(page.locator('text=HD2Lab').first()).toBeVisible();
    await expect(page.locator('text=Film Studio').first()).toBeVisible();

    // Check all 9 film profiles are listed
    const filmNames = ['VÆRN', 'SKELD', 'AURVEN', 'VESTRA', 'VEYRA', 'SOLVIK', 'LYSEN', 'MYRVEL', 'RIMVA'];
    for (const name of filmNames) {
      await expect(page.locator(`text=${name}`).filter({ visible: true }).first()).toBeVisible();
    }
  });

  test('interacts with film selection and adjustment sliders', async ({ page }) => {
    await page.goto('/');

    // Load Portrait sample image to activate editing controls
    await page.getByRole('button', { name: 'Portrait' }).filter({ visible: true }).first().click();

    // Click on SKELD film profile
    await page.locator('button', { hasText: 'SKELD' }).filter({ visible: true }).first().click();

    // Check active film tag updates
    await expect(page.getByText('Editorial Chrome').filter({ visible: true }).first()).toBeVisible();

    // Toggle split mode
    await page.getByRole('button', { name: 'Split' }).filter({ visible: true }).first().click();

    // Open Recipe dialog
    const desktopRecipeBtn = page.getByRole('button', { name: 'Recipes' }).filter({ visible: true });
    if (await desktopRecipeBtn.isVisible()) {
      await desktopRecipeBtn.click();
    } else {
      await page.locator('button[aria-label="More options"]').click();
      await page.getByRole('button', { name: 'Recipes' }).filter({ visible: true }).click();
    }
    await expect(page.getByText('Film Recipe Manager')).toBeVisible();

    // Close modal by pressing Escape
    await page.keyboard.press('Escape');
    await expect(page.getByText('Film Recipe Manager')).not.toBeVisible();

    // Open Export dialog
    await page.getByRole('button', { name: 'Export' }).filter({ visible: true }).first().click();
    await expect(page.getByText('Export Final Image')).toBeVisible();
    await expect(page.getByText('Output Format')).toBeVisible();

    // Close export dialog
    await page.keyboard.press('Escape');
    await expect(page.getByText('Export Final Image')).not.toBeVisible();
  });
});
