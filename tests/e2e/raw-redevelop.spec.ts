import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local-only RAW fixture (git-ignored). Run with E2E_PORT=5373.
const FIXTURE = resolve(process.cwd(), 'poc/q03-imaging/testdata/dng/R0000357.DNG');
const hasFixture = existsSync(FIXTURE);

type RedevelopSummary = {
  asShotTemperatureK: number | null;
  preview: { width: number; height: number };
  neutralSkipped: boolean;
  previewDeltaExposure: number;
  previewDeltaWb: number;
  exportDeltaExposure: number;
  exportDeltaWb: number;
  cancel: { firstWasNull: boolean; commits: number; exposure: number; staleFree: boolean };
};

test.describe('CP4-07 RAW re-develop engine', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'RAW develop path validated on Chromium');
  test.setTimeout(240_000);

  test('develop EV and custom WB change preview and export pixels; stale decodes never land', async ({ page }) => {
    test.skip(!hasFixture, 'local RAW fixture missing');
    await page.goto('/');
    await page.evaluate(async () => {
      try {
        await import('/src/engine/raw/index' + '.ts');
      } catch {
        // first import may tear the context down for Vite's optimizer reload
      }
    }).catch(() => undefined);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);

    const summary = await page.evaluate(async (): Promise<RedevelopSummary> => {
      const raw: any = await import('/src/engine/raw/index' + '.ts');
      const res = await fetch('/poc/q03-imaging/testdata/dng/R0000357.DNG');
      if (!res.ok) throw new Error(`fixture fetch failed ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength < 1024) throw new Error('fixture fetch returned no file (SPA fallback?)');
      const opened = await raw.openRawForEditing(
        { data: bytes, name: 'R0000357.DNG', type: 'image/x-adobe-dng', size: bytes.byteLength },
        { id: 'e2e-redevelop-dng' },
      );
      const neutral = { wb: { mode: 'as-shot' }, exposureEV: 0, highlightRecovery: 0 };
      const evState = { ...neutral, exposureEV: 1 };
      const wbState = { ...neutral, wb: { mode: 'custom', temperatureK: 7200, tint: 12 } };

      const scratch = document.createElement('canvas');
      scratch.width = opened.image.previewWidth;
      scratch.height = opened.image.previewHeight;
      const ctx = scratch.getContext('2d')!;

      const sample = (canvas: HTMLCanvasElement) => {
        ctx.drawImage(canvas, 0, 0, scratch.width, scratch.height);
        return ctx.getImageData(0, 0, scratch.width, scratch.height).data;
      };
      const meanDelta = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < a.length; i += 64) {
          const pixel = i - (i % 4);
          sum += Math.abs(a[pixel] - b[pixel]) + Math.abs(a[pixel + 1] - b[pixel + 1]) + Math.abs(a[pixel + 2] - b[pixel + 2]);
          count += 3;
        }
        return count ? sum / count : 0;
      };
      const exportPixels = async () => {
        const image = await raw.resolveRawOriginal(opened.source);
        return sample(image);
      };

      const neutralPixels = sample(opened.image.previewCanvas);
      const neutralExport = await exportPixels();

      const neutralCommit = await raw.redevelopRawPreview(opened.source, neutral);
      const evCommit = await raw.redevelopRawPreview(opened.source, evState);
      const evPixels = sample(evCommit.preview);
      const evExport = await exportPixels();

      const wbCommit = await raw.redevelopRawPreview(opened.source, wbState);
      const wbPixels = sample(wbCommit.preview);
      const wbExport = await exportPixels();

      // Latest-wins: start -1 EV, supersede with -2 EV before it can commit.
      const commits: any[] = [];
      const red = raw.createRawRedeveloper(opened.source, {
        debounceMs: 5,
        onCommit: (decoded: any) => commits.push(decoded),
      });
      red.request({ ...neutral, exposureEV: -1 });
      const first = red.flush();
      red.request({ ...neutral, exposureEV: -2 });
      const second = await red.flush();
      const firstResult = await first;
      const cancel = {
        firstWasNull: firstResult === null,
        commits: commits.length,
        exposure: second?.settings.exposureEv ?? 0,
        staleFree: commits.every((entry) => entry.settings.exposureEv === -2),
      };
      red.dispose();

      return {
        asShotTemperatureK: opened.report.asShotTemperatureK ?? null,
        preview: { width: wbCommit.previewWidth, height: wbCommit.previewHeight },
        neutralSkipped: neutralCommit.skipped,
        previewDeltaExposure: meanDelta(neutralPixels, evPixels),
        previewDeltaWb: meanDelta(neutralPixels, wbPixels),
        exportDeltaExposure: meanDelta(neutralExport, evExport),
        exportDeltaWb: meanDelta(neutralExport, wbExport),
        cancel,
      };
    });

    console.log('cp4-07-redevelop', JSON.stringify(summary));
    expect(summary.neutralSkipped).toBe(true);
    expect(summary.asShotTemperatureK).toBeGreaterThan(3000);
    expect(summary.previewDeltaExposure).toBeGreaterThan(10);
    expect(summary.previewDeltaWb).toBeGreaterThan(1);
    expect(summary.exportDeltaExposure).toBeGreaterThan(10);
    expect(summary.exportDeltaWb).toBeGreaterThan(1);
    expect(summary.cancel.firstWasNull).toBe(true);
    expect(summary.cancel.commits).toBe(1);
    expect(summary.cancel.exposure).toBe(-2);
    expect(summary.cancel.staleFree).toBe(true);
  });
});