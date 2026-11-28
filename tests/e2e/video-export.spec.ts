import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local-only ffmpeg fixtures (git-ignored). PORT for this spec: E2E_PORT=5373.
const FIXTURE_DIR = resolve(process.cwd(), 'poc/q03-imaging/testdata/video');
const fixture = (name: string) => resolve(FIXTURE_DIR, name);
const hasFixture = (name: string) => existsSync(fixture(name));

type ExportSummary = {
  ok: boolean;
  errorName?: string;
  errorCode?: string;
  frames?: number;
  width?: number;
  height?: number;
  durationSec?: number;
  bytes?: number;
  audioMode?: string;
  audioPackets?: number;
  audioWarning?: string | null;
  sourceHash?: string | null;
  outputHash?: string | null;
  rotationDeg?: number;
  metaWidth?: number;
  metaHeight?: number;
  progressLast?: number;
  progressTotal?: number;
  rendererPath?: string;
  gradingWarning?: string | null;
};

async function openApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  // First import of mediabunny (and the CP4 renderer graph it now pulls in)
  // triggers Vite's dependency optimizer, which full-reloads the page once;
  // warm both entries and the LUTs, then let the reload settle.
  await page.evaluate(async () => {
    try {
      const enginePath = '/src/engine/video/index.ts';
      await import(enginePath);
      await import('/src/engine/renderer/frameRenderer' + '.ts');
      const lut: any = await import('/src/engine/color/lutLoader' + '.ts');
      await lut.loadCubeLut('luts/identity.cube').catch(() => undefined);
      await lut.loadCubeLut('luts/FS-001_VAERN.cube').catch(() => undefined);
    } catch {
      // optimizer reload tears the context down; handled by the wait below
    }
  }).catch(() => undefined);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
}

async function runInPage(
  page: import('@playwright/test').Page,
  fixtureName: string,
  settings: Record<string, unknown>,
  opts: { cancelAfterMs?: number; retry?: boolean; grading?: Record<string, unknown> } = {},
): Promise<ExportSummary> {
  const attempt = () => page.evaluate(
    async ({ fixtureName, settings, opts }) => {
      const url = `/poc/q03-imaging/testdata/video/${fixtureName}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fixture fetch failed ${res.status} for ${url}`);
      const blob = await res.blob();
      const enginePath = '/src/engine/video/index.ts';
      const engine: any = await import(enginePath);
      const film: any = await import('/src/types/film' + '.ts');
      const meta = await engine.inspectVideo(blob);
      const file = new File([blob], fixtureName, { type: res.headers.get('content-type') || 'video/mp4' });
      const grading = opts.grading
        ? { ...opts.grading, adjustments: { ...film.DEFAULT_ADJUSTMENTS, ...(opts.grading.adjustments ?? {}) } }
        : undefined;

      const run = async (cancelAfterMs?: number) => {
        const progress: number[] = [];
        const handle = engine.startVideoExport(file, { settings, grading });
        handle.onProgress((p: { framesDone: number }) => progress.push(p.framesDone));
        if (cancelAfterMs) {
          setTimeout(() => handle.cancel(), cancelAfterMs);
        }
        try {
          const result = await handle.promise;
          return { result, progress };
        } catch (error: any) {
          return { error, progress };
        }
      };

      const first = await run(opts.cancelAfterMs);
      if (opts.cancelAfterMs && !opts.retry) {
        return {
          ok: false,
          errorName: first.error?.name ?? null,
          rotationDeg: meta.rotationDeg,
          metaWidth: meta.width,
          metaHeight: meta.height,
          progressLast: first.progress.at(-1) ?? 0,
        };
      }
      if (opts.cancelAfterMs && opts.retry) {
        if (first.error?.name !== 'AbortError') {
          return { ok: false, errorName: `first-run:${first.error?.name ?? 'no-error'}` };
        }
        const second = await run();
        return second.error
          ? { ok: false, errorName: second.error.name, errorCode: second.error.code }
          : {
              ok: true,
              frames: second.result!.frames,
              width: second.result!.width,
              height: second.result!.height,
              durationSec: second.result!.durationSec,
              bytes: second.result!.bytes,
              audioMode: second.result!.audio.mode,
              audioPackets: second.result!.audio.packets,
              audioWarning: second.result!.audio.warning ?? null,
              sourceHash: second.result!.audio.sourceHash ?? null,
              outputHash: second.result!.audio.outputHash ?? null,
              progressLast: second.progress.at(-1) ?? 0,
              rotationDeg: meta.rotationDeg,
              rendererPath: second.result!.rendererPath,
              gradingWarning: second.result!.gradingWarning ?? null,
            };
      }
      if (first.error) {
        return { ok: false, errorName: first.error.name, errorCode: first.error.code };
      }
      return {
        ok: true,
        frames: first.result!.frames,
        width: first.result!.width,
        height: first.result!.height,
        durationSec: first.result!.durationSec,
        bytes: first.result!.bytes,
        audioMode: first.result!.audio.mode,
        audioPackets: first.result!.audio.packets,
        audioWarning: first.result!.audio.warning ?? null,
        sourceHash: first.result!.audio.sourceHash ?? null,
        outputHash: first.result!.audio.outputHash ?? null,
        progressLast: first.progress.at(-1) ?? 0,
        rotationDeg: meta.rotationDeg,
        metaWidth: meta.width,
        metaHeight: meta.height,
        rendererPath: first.result!.rendererPath,
        gradingWarning: first.result!.gradingWarning ?? null,
      } as ExportSummary;
    },
    { fixtureName, settings, opts },
  );
  try {
    return await attempt();
  } catch (error) {
    if (!String((error as Error).message).includes('Execution context was destroyed')) throw error;
    await openApp(page);
    return attempt();
  }
}

const baseSettings = {
  container: 'mp4',
  videoCodec: 'avc',
  audioMode: 'passthrough',
  resolution: '1080p',
  bitrateMbps: 8,
  fps: 30,
  trim: { startSec: 0, endSec: 2 },
};

test.describe('CP4-03 video export engine', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebCodecs H.264 encoder validated on Chromium');
  test.setTimeout(240_000);

  test('graded 1080p export keeps AAC packets SHA-identical and reports progress', async ({ page }) => {
    test.skip(!hasFixture('h264_aac_1080p_10s.mp4'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(
      page,
      'h264_aac_1080p_10s.mp4',
      { ...baseSettings },
      { grading: { filmId: 'FS-001', adjustments: { grain: 25, filmStrength: 90 } } },
    );
    expect(summary.ok).toBe(true);
    console.log('graded-1080p', JSON.stringify(summary));
    expect(summary.rendererPath).toBe('graded');
    expect(summary.gradingWarning).toBeNull();
    expect(summary.width).toBe(1920);
    expect(summary.height).toBe(1080);
    expect(summary.frames).toBeGreaterThanOrEqual(59);
    expect(summary.frames).toBeLessThanOrEqual(61);
    expect(summary.bytes).toBeGreaterThan(100_000);
    expect(summary.audioMode).toBe('passthrough');
    expect(summary.audioPackets).toBeGreaterThan(0);
    expect(summary.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.outputHash).toBe(summary.sourceHash);
    expect(summary.progressLast).toBeGreaterThanOrEqual(summary.frames! - 1);
  });

  test('cancel aborts with AbortError and a retry completes cleanly', async ({ page }) => {
    test.skip(!hasFixture('h264_aac_720p_45s.mp4'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(
      page,
      'h264_aac_720p_45s.mp4',
      { ...baseSettings, resolution: '720p', trim: { startSec: 0, endSec: 20 } },
      { cancelAfterMs: 400, retry: true },
    );
    expect(summary.ok).toBe(true);
    expect(summary.rendererPath).toBe('graded');
    expect(summary.width).toBe(1280);
    expect(summary.height).toBe(720);
    expect(summary.audioMode).toBe('passthrough');
    expect(summary.outputHash).toBe(summary.sourceHash);
  });

  test('rotation is applied to the encoded display orientation', async ({ page }) => {
    test.skip(!hasFixture('h264_rot90_720p_6s.mp4'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(page, 'h264_rot90_720p_6s.mp4', {
      ...baseSettings,
      resolution: 'source',
      trim: { startSec: 0, endSec: 1 },
    });
    expect(summary.ok).toBe(true);
    expect((summary.rotationDeg ?? 0) % 180).toBe(90);
    expect(summary.width).toBe(summary.metaWidth);
    expect(summary.height).toBe(summary.metaHeight);
  });

  test('trim window is exact within one frame', async ({ page }) => {
    test.skip(!hasFixture('h264_aac_720p_6s.mp4'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(page, 'h264_aac_720p_6s.mp4', {
      ...baseSettings,
      resolution: '720p',
      trim: { startSec: 1.5, endSec: 4 },
    });
    expect(summary.ok).toBe(true);
    expect(summary.frames).toBeGreaterThanOrEqual(74);
    expect(summary.frames).toBeLessThanOrEqual(76);
    expect(Math.abs(summary.durationSec! - 2.5)).toBeLessThanOrEqual(1 / 30);
  });

  test('unsupported container/codec pairing fails fast with a capability error', async ({ page }) => {
    test.skip(!hasFixture('h264_silent_720p_6s.mp4'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(page, 'h264_silent_720p_6s.mp4', {
      ...baseSettings,
      container: 'mp4',
      videoCodec: 'vp9',
    });
    expect(summary.ok).toBe(false);
    expect(summary.errorName).toBe('VideoCapabilityError');
    expect(summary.errorCode).toBe('unsupported-container');
  });

  test('silent source degrades audio to none without a warning-free lie', async ({ page }) => {
    test.skip(!hasFixture('h264_silent_720p_6s.mp4'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(page, 'h264_silent_720p_6s.mp4', {
      ...baseSettings,
      resolution: '720p',
      trim: { startSec: 0, endSec: 1 },
    });
    expect(summary.ok).toBe(true);
    expect(summary.audioMode).toBe('none');
    expect(summary.sourceHash).toBeNull();
  });

  test('VP9/WebM passthrough keeps Opus packets identical', async ({ page }) => {
    test.skip(!hasFixture('vp9_opus_720p_6s.webm'), 'local fixture missing');
    await openApp(page);
    const summary = await runInPage(page, 'vp9_opus_720p_6s.webm', {
      ...baseSettings,
      container: 'webm',
      videoCodec: 'vp9',
      resolution: 'source',
      fps: 30,
      trim: { startSec: 0, endSec: 2 },
    });
    expect(summary.ok).toBe(true);
    expect(summary.audioMode).toBe('passthrough');
    expect(summary.outputHash).toBe(summary.sourceHash);
  });
});
