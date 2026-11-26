import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/Users/jaehyukshim/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'video');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

const FILES = [
  { key: 'h264_aac_720p', path: 'video/h264_aac_720p_6s.mp4' },
  { key: 'h264_aac_1080p', path: 'video/h264_aac_1080p_10s.mp4' },
  { key: 'vp9_opus_720p', path: 'video/vp9_opus_720p_6s.webm' },
  { key: 'hevc_aac_360p', path: 'video/hevc_aac_360p_3s.mp4' },
  { key: 'av1_opus_360p', path: 'video/av1_opus_360p_4s.webm' },
  { key: 'h264_silent_720p', path: 'video/h264_silent_720p_6s.mp4' },
  { key: 'h264_portrait', path: 'video/h264_portrait_720x1280_4s.mp4' },
  { key: 'h264_rot90', path: 'video/h264_rot90_720p_6s.mp4' },
  { key: 'h264_vfr', path: 'video/h264_vfr_360p_6s.mp4' },
];
const LONG = { key: 'h264_aac_720p_45s', path: 'video/h264_aac_720p_45s.mp4' };

function waitPort(port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ port, host: 'localhost' });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error('vite did not start'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function saveDataURL(dir, name, dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  await writeFile(path.join(dir, name), Buffer.from(b64, 'base64'));
}

const hardFailures = [];
function assert(name, pass, detail) {
  if (!pass) hardFailures.push({ name, detail });
  return pass;
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`chromium not found: ${CHROME}`);
  await mkdir(OUT, { recursive: true });
  await mkdir(path.join(OUT, 'images'), { recursive: true });
  await mkdir(path.join(OUT, 'out'), { recursive: true });

  const only = process.env.VIDEO_FILES?.split(',').filter(Boolean);
  const files = only?.length ? FILES.filter((f) => only.includes(f.key)) : FILES;

  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[vite:err] ${d}`));

  // Harness-only streaming sink: mirrors a product file target, but writes through Node fs.
  // The product path itself never captures the whole file; this is automation glue.
  const sinks = new Map();
  const sinkFor = async (dst) => {
    let fh = sinks.get(dst);
    if (!fh) { fh = await open(dst, 'w'); sinks.set(dst, fh); }
    return fh;
  };

  let browser;
  try {
    await waitPort(PORT);
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--js-flags=--expose-gc'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(900000);
    page.on('console', (msg) => console.log(`[page] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

    await page.exposeFunction('__q03Sink', async (b64, position, file) => {
      const dst = path.join(OUT, 'out', path.basename(file));
      const fh = await sinkFor(dst);
      const buf = Buffer.from(b64, 'base64');
      await fh.write(buf, 0, buf.length, position);
    });

    await page.goto(`${BASE}/video.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__poc && typeof window.__poc.capabilities === 'function');

    const caps = await page.evaluate(() => window.__poc.capabilities());
    await writeFile(path.join(OUT, 'capabilities.json'), JSON.stringify(caps, null, 2));
    console.log(`capabilities apis: ${JSON.stringify(caps.apis)}`);
    console.log(`output targets: ${JSON.stringify(caps.outputTargets)}`);
    assert('runtime detects harness stream target', caps.outputTargets?.harnessSink === true, caps.outputTargets);

    const analysis = [];
    for (const file of [...files, ...(process.env.VIDEO_SKIP_LONG ? [] : [LONG])]) {
      console.log(`=== analyze ${file.key} ===`);
      const a = await page.evaluate((p) => window.__poc.analyze(p), file.path);
      await writeFile(path.join(OUT, `analysis_${file.key}.json`), JSON.stringify(a, null, 2));
      analysis.push({ key: file.key, ...a });
    }
    await writeFile(path.join(OUT, 'analysis.json'), JSON.stringify(analysis, null, 2));

    if (!process.env.VIDEO_SKIP_BENCH) {
      const benches = [];
      for (const file of files) {
        for (const mode of ['decode-draw', 'decode-grade']) {
          console.log(`=== bench ${file.key} ${mode} ===`);
          const b = await page.evaluate(([p, m]) => window.__poc.bench(p, m), [file.path, mode]);
          benches.push({ key: file.key, mode, ...b });
          console.log(`bench ${file.key} ${mode}: ${b.ok ? `${b.fps} fps (${b.frames} frames)` : b.error}`);
        }
      }
      await writeFile(path.join(OUT, 'bench.json'), JSON.stringify(benches, null, 2));
    }

    // ---- streaming transcode + independent output verification (IMG-02/04/05/07/08)
    const transcodes = [];
    for (const file of files) {
      console.log(`=== transcode ${file.key} ===`);
      const outName = `out_${file.key}`;
      const t = await page.evaluate(
        ([p, name]) => window.__poc.transcode(p, { strength: 0.85, snapshotAt: 1.0, target: 'harness', outputName: name }),
        [file.path, outName],
      );
      const images = t.images ?? {};
      delete t.images;
      for (const [name, img] of Object.entries(images)) {
        if (!img?.url) continue;
        await saveDataURL(path.join(OUT, 'images'), `${file.key}_${name}.jpg`, img.url);
        img.savedAs = `images/${file.key}_${name}.jpg`;
        delete img.url;
      }
      t.images = images;
      t.outputBase64 = t.outputBase64 === undefined ? 'absent' : 'present';
      const verifyPath = t.outputFile ? `results/video/${t.outputFile}` : null;
      if (t.ok && verifyPath && t.snapshot) {
        const inInfo = t.inputInfo ?? {};
        const expect = { frames: t.frames, expectedWidth: inInfo.displayWidth ?? null, expectedHeight: inInfo.displayHeight ?? null };
        const v = await page.evaluate(([op, ip, ex]) => window.__poc.verifyOutput(op, ip, ex), [verifyPath, file.path, expect]);
        await writeFile(path.join(OUT, `output_verify_${file.key}.json`), JSON.stringify(v, null, 2));
        t.outputVerification = { ok: v.ok, checks: v.assertions?.checks ?? [] };
        assert(`${file.key}: output verification`, v.ok === true, v.assertions?.checks);
        for (const c of v.assertions?.checks ?? []) assert(`${file.key}: ${c.name}`, c.pass !== false, c);

        const sv = await page.evaluate(
          ([ip, ts, og, gg]) => window.__poc.verifySnapshot(ip, ts, og, gg),
          [file.path, t.snapshot.timestamp, t.snapshot.originalGrid, t.snapshot.gradedGrid],
        );
        t.snapshotVerification = sv;
        assert(`${file.key}: snapshot is the same frame as independent decode`, sv.sameFrameVerified === true, sv);
        assert(`${file.key}: grading changes the graded snapshot`, sv.gradingApplied === true, sv);
        assert(`${file.key}: no base64 in product path`, t.outputBase64 === 'absent', null);
        assert(`${file.key}: aborted flag not set`, t.aborted !== true, t.aborted);
      }
      transcodes.push({ key: file.key, ...t });
      console.log(`transcode ${file.key}: ${t.ok ? `${t.frames} frames, ${t.timing?.fps} fps, ${t.output?.bytes} bytes` : t.error}`);
    }
    await writeFile(path.join(OUT, 'transcode.json'), JSON.stringify(transcodes, null, 2));

    // ---- memory budget and target-mode probes (IMG-02)
    const budgetProbes = [];
    if (!process.env.VIDEO_SKIP_BUDGET) {
      const budgetTight = await page.evaluate((p) => window.__poc.transcode(p, { target: 'buffer', memoryBudgetMB: 1, maxSeconds: 2 }), 'video/h264_aac_1080p_10s.mp4');
      budgetProbes.push({ probe: 'buffer-budget-overflow', ...budgetTight });
      assert('budget overflow raises MemoryBudgetExceeded', budgetTight.ok === false && /MemoryBudgetError|MemoryBudgetExceeded/.test(budgetTight.error ?? ''), budgetTight.error);
      console.log(`budget overflow: ${budgetTight.error}`);

      const fileTarget = await page.evaluate((p) => window.__poc.transcode(p, { target: 'file', maxSeconds: 1 }), 'video/h264_aac_720p_6s.mp4');
      budgetProbes.push({ probe: 'file-picker-unsupported', ...fileTarget });
      const fileExpected = fileTarget.ok === true || (fileTarget.ok === false && /OutputTargetError|file picker (unavailable|dismissed)/.test(fileTarget.error ?? ''));
      assert('file target handled per runtime capability', fileExpected, fileTarget.error);
      console.log(`file target: ${fileTarget.ok ? 'picker wrote output' : fileTarget.error}`);

      const bufferSmall = await page.evaluate((p) => window.__poc.transcode(p, { target: 'buffer', maxSeconds: 3, snapshotAt: 0.5 }), 'video/h264_vfr_360p_6s.mp4');
      budgetProbes.push({ probe: 'buffer-under-budget', ok: bufferSmall.ok, aborted: bufferSmall.aborted, error: bufferSmall.error, assertions: bufferSmall.assertions, heapSlopeMBPerMinute: bufferSmall.heapSlopeMBPerMinute, peakHeapDeltaMB: bufferSmall.peakHeapDeltaMB, outputBase64: bufferSmall.outputBase64 === undefined ? 'absent' : 'present' });
      assert('buffer target under budget verifies output', bufferSmall.ok === true && bufferSmall.assertions?.pass === true, bufferSmall.error);
      await writeFile(path.join(OUT, 'budget_probes.json'), JSON.stringify(budgetProbes, null, 2));
    }

    // ---- cancel (AbortSignal) and rerun (IMG-07)
    const cancelRuns = [];
    if (!process.env.VIDEO_SKIP_CANCEL) {
      console.log('=== cancel internal (abortAfterMs) ===');
      const internal = await page.evaluate((p) => window.__poc.transcode(p, { target: 'harness', outputName: 'cancel_internal', abortAfterMs: 250 }), 'video/h264_aac_1080p_10s.mp4');
      cancelRuns.push({ probe: 'internal-abort', aborted: internal.aborted, ok: internal.ok, error: internal.error, peakHeapDeltaMB: internal.peakHeapDeltaMB, frames: internal.frames });
      assert('internal abort cancels the run', internal.aborted === true && internal.ok === false, internal.error);

      console.log('=== cancel external (cancelRun) ===');
      await page.evaluate(([p, id]) => { window.__cancelRunPromise = window.__poc.transcode(p, { target: 'harness', outputName: 'cancel_external', runId: id }); }, ['video/h264_aac_720p_45s.mp4', 'cancel-external']);
      await new Promise((r) => setTimeout(r, 600));
      const cancelled = await page.evaluate((id) => window.__poc.cancelRun(id), 'cancel-external');
      const external = await page.evaluate(() => window.__cancelRunPromise);
      cancelRuns.push({ probe: 'external-cancel', cancelRunReturned: cancelled, aborted: external.aborted, ok: external.ok, error: external.error, peakHeapDeltaMB: external.peakHeapDeltaMB, frames: external.frames });
      assert('external cancelRun aborts the run', cancelled === true && external.aborted === true, external.error);

      console.log('=== rerun after cancel ===');
      const rerun = await page.evaluate((p) => window.__poc.transcode(p, { target: 'harness', outputName: 'rerun_after_cancel', snapshotAt: 1.0 }), 'video/h264_aac_1080p_10s.mp4');
      const rerunVerify = rerun.ok
        ? await page.evaluate(([op, ip, ex]) => window.__poc.verifyOutput(op, ip, ex), [`results/video/${rerun.outputFile}`, 'video/h264_aac_1080p_10s.mp4', { frames: rerun.frames, expectedWidth: rerun.inputInfo?.displayWidth, expectedHeight: rerun.inputInfo?.displayHeight }])
        : null;
      cancelRuns.push({ probe: 'rerun-after-cancel', ok: rerun.ok, frames: rerun.frames, error: rerun.error, verification: rerunVerify?.assertions ?? null });
      assert('rerun after cancel succeeds and verifies', rerun.ok === true && rerunVerify?.ok === true, rerun.error);
      await writeFile(path.join(OUT, 'cancel.json'), JSON.stringify(cancelRuns, null, 2));
    }

    // ---- long-export memory stress (IMG-02)
    if (!process.env.VIDEO_SKIP_LONG) {
      console.log('=== long export 45s ===');
      const long = await page.evaluate((p) => window.__poc.transcode(p, { target: 'harness', outputName: 'long_45s', snapshotAt: 1.5 }), LONG.path);
      const longVerify = long.ok
        ? await page.evaluate(([op, ip, ex]) => window.__poc.verifyOutput(op, ip, ex), [`results/video/${long.outputFile}`, LONG.path, { frames: long.frames, expectedWidth: long.inputInfo?.displayWidth, expectedHeight: long.inputInfo?.displayHeight }])
        : null;
      const longReport = {
        ok: long.ok,
        frames: long.frames,
        error: long.error,
        timing: long.timing,
        heapSlopeMBPerMinute: long.heapSlopeMBPerMinute,
        peakHeapDeltaMB: long.peakHeapDeltaMB,
        heapSeries: long.heapSeries,
        output: long.output,
        verification: longVerify?.assertions ?? null,
      };
      await writeFile(path.join(OUT, 'long_export.json'), JSON.stringify(longReport, null, 2));
      assert('long export completes', long.ok === true, long.error);
      assert('long export verifies independently', longVerify?.ok === true, longVerify?.assertions);
      assert('long export frame count ~= 45s * fps', long.ok && Math.abs(long.frames - 45 * 30) <= 2, long.frames);
      assert('long export heap slope bounded (<64 MB/min)', long.heapSlopeMBPerMinute === null || Math.abs(long.heapSlopeMBPerMinute) < 64, long.heapSlopeMBPerMinute);
      console.log(`long export: ${long.frames} frames, slope ${long.heapSlopeMBPerMinute} MB/min, peak +${long.peakHeapDeltaMB} MB`);
    }

    await writeFile(path.join(OUT, 'assertions.json'), JSON.stringify({ pass: hardFailures.length === 0, failures: hardFailures }, null, 2));
    console.log(hardFailures.length ? `ASSERTION FAILURES: ${JSON.stringify(hardFailures, null, 2)}` : 'all assertions passed');
    console.log('VIDEO PoC complete');
    if (hardFailures.length) process.exitCode = 1;
  } finally {
    for (const fh of sinks.values()) { try { await fh.close(); } catch {} }
    await browser?.close();
    server.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
