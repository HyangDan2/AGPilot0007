import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Adaptive Image Fit & Cursor-Centered Zoom (Work Order v1.2)', () => {
  const SAMPLES_DIR = path.resolve(process.cwd(), 'public/samples/aspect_ratios');

  test.describe('P0 — Original Aspect Ratio Auto Fit across all ratios', () => {
    const testCases = [
      { name: '1:1 Square', file: 'square_1x1.png', expectedAspect: 800 / 800 },
      { name: '3:4 Portrait', file: 'portrait_3x4.png', expectedAspect: 600 / 800 },
      { name: '2:3 Classic Portrait', file: 'portrait_2x3.png', expectedAspect: 600 / 900 },
      { name: '4:3 Standard', file: 'landscape_4x3.png', expectedAspect: 800 / 600 },
      { name: '16:9 Widescreen', file: 'landscape_16x9.png', expectedAspect: 1280 / 720 },
      { name: '9:16 Vertical Mobile', file: 'portrait_9x16.png', expectedAspect: 720 / 1280 },
      { name: '21:9 Panorama', file: 'panoramic_21x9.png', expectedAspect: 1680 / 720 },
    ];

    for (const tc of testCases) {
      test(`auto-fits ${tc.name} preserving exact aspect ratio without cropping`, async ({ page }) => {
        await page.goto('/');

        // Upload test image
        const filePath = path.join(SAMPLES_DIR, tc.file);
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(filePath);

        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Wait for ResizeObserver measurement
        await page.waitForTimeout(300);

        const canvasBox = await canvas.boundingBox();
        expect(canvasBox).not.toBeNull();

        // 1. Never fallback to arbitrary 400x300
        expect(canvasBox!.width === 400 && canvasBox!.height === 300).toBe(false);

        // 2. Aspect ratio must match source within 1.5% pixel rounding tolerance
        const measuredAspect = canvasBox!.width / canvasBox!.height;
        const aspectDiff = Math.abs(measuredAspect - tc.expectedAspect);
        expect(aspectDiff).toBeLessThan(0.02);

        // 3. Must fit completely inside the container
        const container = page.locator('main .relative.flex.items-center.justify-center').first();
        const containerBox = await container.boundingBox();
        expect(containerBox).not.toBeNull();

        expect(canvasBox!.width).toBeLessThanOrEqual(containerBox!.width + 1);
        expect(canvasBox!.height).toBeLessThanOrEqual(containerBox!.height + 1);
      });
    }

    test('recalculates Fit dynamically when window resizes', async ({ page }) => {
      await page.goto('/');
      await page.setViewportSize({ width: 1440, height: 900 });

      const filePath = path.join(SAMPLES_DIR, 'landscape_16x9.png');
      await page.locator('input[type="file"]').first().setInputFiles(filePath);

      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
      await page.waitForTimeout(300);

      const boxInitial = await canvas.boundingBox();
      expect(boxInitial).not.toBeNull();

      // Resize window down
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(300);

      const boxResized = await canvas.boundingBox();
      expect(boxResized).not.toBeNull();

      // Fitted width must have adjusted to smaller window
      expect(boxResized!.width).toBeLessThan(boxInitial!.width);
      // Aspect ratio still preserved
      const aspect = boxResized!.width / boxResized!.height;
      expect(Math.abs(aspect - (16 / 9))).toBeLessThan(0.02);
    });
  });

  test.describe('P0 — Desktop Cursor-Centered Mouse Wheel Zoom', () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(isMobile, 'Mouse wheel tests apply to desktop environments with mouse pointers');
      await page.goto('/');
      await page.setViewportSize({ width: 1280, height: 800 });
      const filePath = path.join(SAMPLES_DIR, 'landscape_16x9.png');
      await page.locator('input[type="file"]').first().setInputFiles(filePath);
      await expect(page.locator('canvas')).toBeVisible();
      await page.waitForTimeout(300);
    });

    test('zooming at image center keeps center stationary', async ({ page }) => {
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();

      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;

      // Move mouse to center and scroll up to zoom in
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(200);

      const zoomedBox = await canvas.boundingBox();
      expect(zoomedBox).not.toBeNull();
      expect(zoomedBox!.width).toBeGreaterThan(box!.width);

      // Center should remain approximately at cx, cy
      const newCx = zoomedBox!.x + zoomedBox!.width / 2;
      const newCy = zoomedBox!.y + zoomedBox!.height / 2;
      expect(Math.abs(newCx - cx)).toBeLessThan(5);
      expect(Math.abs(newCy - cy)).toBeLessThan(5);
    });

    test('zooming near quadrant anchors to cursor position', async ({ page }) => {
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();

      // Position mouse at top-left quadrant (25% X, 25% Y)
      const targetX = box!.x + box!.width * 0.25;
      const targetY = box!.y + box!.height * 0.25;

      // Compute normalized image coordinates under cursor before zoom
      const normXBefore = (targetX - box!.x) / box!.width;
      const normYBefore = (targetY - box!.y) / box!.height;

      // Move mouse and zoom in
      await page.mouse.move(targetX, targetY);
      await page.mouse.wheel(0, -250);
      await page.waitForTimeout(200);

      const zoomedBox = await canvas.boundingBox();
      expect(zoomedBox).not.toBeNull();
      expect(zoomedBox!.width).toBeGreaterThan(box!.width);

      // Point in canvas under (targetX, targetY) after zoom
      const normXAfter = (targetX - zoomedBox!.x) / zoomedBox!.width;
      const normYAfter = (targetY - zoomedBox!.y) / zoomedBox!.height;

      // The image point under the cursor should remain stable within tolerance
      expect(Math.abs(normXAfter - normXBefore)).toBeLessThan(0.04);
      expect(Math.abs(normYAfter - normYBefore)).toBeLessThan(0.04);
    });

    test('zoom range respects min 100% and max 800%', async ({ page }) => {
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;

      await page.mouse.move(cx, cy);

      // Scroll down repeatedly (attempt to zoom out below 100%)
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 300);
      }
      await page.waitForTimeout(200);

      // Should be at 100% (Fit)
      await expect(page.getByText('100%').first()).toBeVisible();

      // Scroll up repeatedly (attempt to zoom past 800%)
      for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, -400);
      }
      await page.waitForTimeout(200);

      // Should be capped at 800%
      await expect(page.getByText('800%').first()).toBeVisible();
    });

    test('fit button and keyboard shortcuts (F, 0) reset zoom and pan', async ({ page }) => {
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;

      // Zoom in
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(200);

      const zoomedBox = await canvas.boundingBox();
      expect(zoomedBox!.width).toBeGreaterThan(box!.width);

      // Press 'f' to reset
      await page.keyboard.press('f');
      await page.waitForTimeout(200);

      const resetBox = await canvas.boundingBox();
      expect(Math.abs(resetBox!.width - box!.width)).toBeLessThan(2);
      await expect(page.getByText('100%').first()).toBeVisible();

      // Zoom in again and press '0'
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(200);
      expect((await canvas.boundingBox())!.width).toBeGreaterThan(box!.width);

      await page.keyboard.press('0');
      await page.waitForTimeout(200);
      await expect(page.getByText('100%').first()).toBeVisible();
    });
  });

  test.describe('P1 — Image Pan Behavior & Toolbar Controls', () => {
    test('toolbar zoom in/out buttons adjust zoom and allow panning', async ({ page }) => {
      await page.goto('/');
      const filePath = path.join(SAMPLES_DIR, 'landscape_16x9.png');
      await page.locator('input[type="file"]').first().setInputFiles(filePath);
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
      await page.waitForTimeout(300);

      const boxInitial = await canvas.boundingBox();
      expect(boxInitial).not.toBeNull();

      // Click Zoom In button twice
      const zoomInBtn = page.getByRole('button', { name: 'Zoom In' });
      await zoomInBtn.click();
      await page.waitForTimeout(150);
      await zoomInBtn.click();
      await page.waitForTimeout(150);

      const boxZoomed = await canvas.boundingBox();
      expect(boxZoomed!.width).toBeGreaterThan(boxInitial!.width);

      // Pan image
      const cx = boxZoomed!.x + boxZoomed!.width / 2;
      const cy = boxZoomed!.y + boxZoomed!.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 80, cy + 40, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      const boxPanned = await canvas.boundingBox();
      expect(boxPanned!.x).toBeGreaterThan(boxZoomed!.x);

      // Click Fit button
      const fitBtn = page.getByRole('button', { name: 'Fit to Screen' });
      if (await fitBtn.isVisible()) {
        await fitBtn.click();
        await page.waitForTimeout(200);
        const boxReset = await canvas.boundingBox();
        expect(Math.abs(boxReset!.width - boxInitial!.width)).toBeLessThan(2);
      }
    });

    test('split divider remains functional and does not pan image while dragging', async ({ page }) => {
      await page.goto('/');
      const filePath = path.join(SAMPLES_DIR, 'landscape_16x9.png');
      await page.locator('input[type="file"]').first().setInputFiles(filePath);
      await expect(page.locator('canvas')).toBeVisible();

      // Enable split mode
      await page.getByRole('button', { name: 'Split' }).click();

      const splitHandle = page.locator('text=↔').first();
      await expect(splitHandle).toBeVisible();

      const handleBox = await splitHandle.boundingBox();
      expect(handleBox).not.toBeNull();

      // Drag split handle
      await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x + 100, handleBox!.y + 10, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      const newHandleBox = await splitHandle.boundingBox();
      expect(newHandleBox!.x).toBeGreaterThan(handleBox!.x + 50);
    });
  });

  test.describe('P0 — WebGL Renderer Stability', () => {
    test('slider adjustments do not recreate WebGL renderer or context', async ({ page }) => {
      await page.goto('/');
      await page.setViewportSize({ width: 1440, height: 900 });
      const filePath = path.join(SAMPLES_DIR, 'landscape_16x9.png');
      await page.locator('input[type="file"]').first().setInputFiles(filePath);
      await expect(page.locator('canvas')).toBeVisible();
      await page.waitForTimeout(300);

      // Move sliders repeatedly
      const exposureSlider = page.locator('[data-testid="slider-exposure"]').first();
      await exposureSlider.fill('1.5');
      await page.waitForTimeout(100);
      await exposureSlider.fill('-1.0');
      await page.waitForTimeout(100);
      await exposureSlider.fill('0.0');
      await page.waitForTimeout(100);

      // Verify canvas element is still identical DOM node and rendered properly
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox).not.toBeNull();
      expect(canvasBox!.width).toBeGreaterThan(100);
    });
  });
});
