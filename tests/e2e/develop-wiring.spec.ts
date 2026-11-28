import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local-only RAW fixtures (git-ignored); skip when neither copy exists.
const CANDIDATES = [
  { file: '.private/raw-samples/R0000357.DNG', url: '/.private/raw-samples/R0000357.DNG' },
  { file: 'poc/q03-imaging/testdata/dng/R0000357.DNG', url: '/poc/q03-imaging/testdata/dng/R0000357.DNG' },
];
const fixture = CANDIDATES.find((candidate) => existsSync(resolve(process.cwd(), candidate.file)));
const FIXTURE = fixture ? resolve(process.cwd(), fixture.file) : '';

const channelDelta = (a: number[], b: number[]) =>
  (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;

test.describe('CP4-07 develop wiring through the editor', () => {
  test.setTimeout(300_000);
  test.skip(({ browserName }) => browserName !== 'chromium', 'RAW develop wiring runs on Chromium');

  const openFixture = async (page: import('@playwright/test').Page) => {
    await page.goto('/');
    await page.locator('input[type=file]').first().setInputFiles(FIXTURE);
    await expect(page.getByTestId('develop-panel')).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(1500);
  };

  const flushDevelop = async (page: import('@playwright/test').Page) => {
    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/stores/editorStore' + '.ts');
      await useEditorStore.getState().flushDevelop();
    });
    await page.waitForTimeout(1500);
  };

  const storeMean = (page: import('@playwright/test').Page) =>
    page.evaluate(async () => {
      const { useEditorStore } = await import('/src/stores/editorStore' + '.ts');
      const image = useEditorStore.getState().image!;
      const canvas = document.createElement('canvas');
      canvas.width = image.previewWidth;
      canvas.height = image.previewHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image.previewCanvas, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const count = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      return { mean: [r / count, g / count, b / count], width: canvas.width, height: canvas.height };
    });

  const canvasMean = async (page: import('@playwright/test').Page) => {
    const shot = await page
      .locator('[data-testid="image-workspace"] canvas:not([data-detail-loupe])')
      .first()
      .screenshot();
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const count = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      return { mean: [r / count, g / count, b / count], width: canvas.width, height: canvas.height };
    }, shot.toString('base64'));
  };

  test('develop EV and WB edits change preview and export pixels; drags settle on the latest state', async ({ page }) => {
    test.skip(!fixture, 'local RAW fixture missing');
    await openFixture(page);

    const neutralStore = await storeMean(page);
    const neutralCanvas = await canvasMean(page);
    expect(neutralCanvas.width).toBeGreaterThan(200);

    // EV edit through the real panel.
    await page.getByTestId('develop-exposure').fill('1');
    await flushDevelop(page);
    const evStore = await storeMean(page);
    const evCanvas = await canvasMean(page);
    expect(evStore.width).toBe(neutralStore.width);
    expect(channelDelta(evStore.mean, neutralStore.mean)).toBeGreaterThan(10);
    expect(channelDelta(evCanvas.mean, neutralCanvas.mean)).toBeGreaterThan(3);

    // Custom WB edit through the real panel.
    await page.getByTestId('develop-wb-custom').click();
    await page.getByTestId('develop-temperature').fill('7200');
    await page.getByTestId('develop-tint').fill('12');
    await flushDevelop(page);
    const wbStore = await storeMean(page);
    const wbCanvas = await canvasMean(page);
    expect(channelDelta(wbStore.mean, evStore.mean)).toBeGreaterThan(2);
    expect(channelDelta(wbCanvas.mean, evCanvas.mean)).toBeGreaterThan(1);

    // Rapid drag: three edits inside one debounce window, only the last may land.
    await page.getByTestId('develop-exposure').fill('0.4');
    await page.getByTestId('develop-exposure').fill('1.6');
    await page.getByTestId('develop-exposure').fill('1.0');
    const latest = await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/stores/editorStore' + '.ts');
      const raw: any = await import('/src/engine/raw/index' + '.ts');
      await useEditorStore.getState().flushDevelop();
      const state = useEditorStore.getState();
      const expected = await raw.decodeRawRedevelop(state.rawSource, state.develop);
      const actual = state.image!;
      const w = actual.previewWidth;
      const h = actual.previewHeight;
      const read = (source: CanvasImageSource) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(source, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const a = read(actual.previewCanvas);
      const b = read(expected.preview);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < a.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          sum += d;
          max = Math.max(max, d);
        }
      }
      return { mean: sum / ((a.length / 4) * 3), max, exposure: state.develop!.exposureEV };
    });
    expect(latest.exposure).toBeCloseTo(1.0, 6);
    expect(latest.mean).toBeLessThan(1);
    expect(latest.max).toBeLessThan(8);

    // Export uses the real resolver: developed export first, then a panel Reset
    // to neutral, flush, and a second export as the baseline.
    const exportCurrent = () =>
      page.evaluate(async () => {
        const { useEditorStore } = await import('/src/stores/editorStore' + '.ts');
        const { prepareExportImage } = await import('/src/engine/export/imageExporter' + '.ts');
        const { loadCubeLut } = await import('/src/engine/color/lutLoader' + '.ts');
        const { DEFAULT_ADJUSTMENTS } = await import('/src/types/film' + '.ts');
        const { composeDevelop } = await import('/src/engine/contracts/develop' + '.ts');

        const state = useEditorStore.getState();
        // developBaked stays true: user exposure is untouched by the develop state.
        const guarded = composeDevelop(
          { adjustments: { ...DEFAULT_ADJUSTMENTS, exposure: 0.3 }, filmId: 'FS-001' as const },
          state.develop!,
          { developBaked: true },
        );

        const lut = await loadCubeLut('luts/FS-001_VAERN.cube');
        const prepared: { blob: Blob; objectUrl: string } = await prepareExportImage(
          state.image!,
          lut,
          { filmId: 'FS-001', adjustments: { ...DEFAULT_ADJUSTMENTS } },
          { format: 'image/png', quality: 1, scale: 0.25 },
        );
        const bitmap = await createImageBitmap(prepared.blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        bitmap.close();
        URL.revokeObjectURL(prepared.objectUrl);
        let r = 0;
        let g = 0;
        let b = 0;
        const count = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        return {
          mean: [r / count, g / count, b / count],
          width: canvas.width,
          height: canvas.height,
          guardedExposure: guarded.adjustments.exposure,
          exposureEV: state.develop!.exposureEV,
        };
      });

    const developed = await exportCurrent();
    expect(developed.guardedExposure).toBeCloseTo(0.3, 6);
    expect(developed.exposureEV).toBeCloseTo(1.0, 6);

    await page.getByTestId('develop-reset').click();
    await flushDevelop(page);
    const neutralExport = await exportCurrent();
    expect(neutralExport.exposureEV).toBeCloseTo(0, 6);
    expect(neutralExport.width).toBe(developed.width);
    expect(neutralExport.height).toBe(developed.height);
    const exportDelta = channelDelta(developed.mean, neutralExport.mean);
    expect(exportDelta).toBeGreaterThan(10);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        preview: {
          ev: channelDelta(evStore.mean, neutralStore.mean),
          wb: channelDelta(wbStore.mean, evStore.mean),
          canvasEv: channelDelta(evCanvas.mean, neutralCanvas.mean),
          canvasWb: channelDelta(wbCanvas.mean, evCanvas.mean),
        },
        latestWins: { mean: latest.mean, max: latest.max },
        exportDelta,
      }),
    );
  });
});
