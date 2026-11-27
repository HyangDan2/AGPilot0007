import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

const CHROME = '/Users/jaehyukshim/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'raw');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

const FILES = [
  { key: 'cr3_canon_r6m3', path: 'cr3/IMG_4243.CR3' },
  { key: 'cr2_canon_1000d', path: 'cr2/IMG_9406.CR2' },
  { key: 'raf_fuji_xt4', path: 'raf/DSCF0268.RAF' },
  { key: 'nef_nikon_z6', path: 'nef/DSC_0757.NEF' },
  { key: 'arw_sony_a7m3', path: 'arw/_DSC0009.ARW' },
  { key: 'orf_olympus_em10', path: 'orf/P3180165.ORF' },
  { key: 'dng_ricoh_gr3', path: 'dng/R0000357.DNG' },
];

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

async function makeCorruptFixtures() {
  const dir = path.join(ROOT, 'testdata', 'corrupt');
  await mkdir(dir, { recursive: true });
  const cuts = [
    { src: 'cr3/IMG_4243.CR3', dst: 'truncated.CR3', keep: 0.9 },
    { src: 'raf/DSCF0268.RAF', dst: 'truncated.RAF', keep: 0.9 },
    { src: 'dng/R0000357.DNG', dst: 'truncated.DNG', keep: 0.995 },
  ];
  for (const cut of cuts) {
    const srcPath = path.join(ROOT, 'testdata', cut.src);
    const dstPath = path.join(dir, cut.dst);
    if (!existsSync(srcPath)) continue;
    const buf = await readFile(srcPath);
    const keep = Math.floor(buf.length * cut.keep);
    await writeFile(dstPath, buf.subarray(0, keep));
    console.log(`corrupt fixture ${cut.dst}: ${keep}/${buf.length} bytes`);
  }
  const randomPath = path.join(dir, 'random.CR3');
  if (!existsSync(randomPath)) {
    const fh = await open(randomPath, 'w');
    await fh.write(randomBytes(1024 * 1024));
    await fh.close();
  }
}

async function saveDataURL(dir, name, dataUrl) {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const buf = Buffer.from(b64, 'base64');
  await writeFile(path.join(dir, name), buf);
  return buf.length;
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`chromium not found: ${CHROME}`);
  await mkdir(OUT, { recursive: true });
  await mkdir(path.join(OUT, 'images'), { recursive: true });
  await makeCorruptFixtures();

  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[vite:err] ${d}`));

  let browser;
  try {
    await waitPort(PORT);
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--js-flags=--expose-gc'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);
    page.on('console', (msg) => console.log(`[page] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));
    await page.goto(`${BASE}/raw.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__poc);
    await page.evaluate(() => window.__poc.ready);

    const caps = await page.evaluate(() => window.__poc.capabilities());
    await writeFile(path.join(OUT, 'capabilities.json'), JSON.stringify(caps, null, 2));
    console.log(`capabilities: ${JSON.stringify(caps.build)}`);

    const unsupported = await page.evaluate(() => window.__poc.probeUnsupported('notraw.jpg'));
    await writeFile(path.join(OUT, 'unsupported_probe.json'), JSON.stringify(unsupported, null, 2));
    console.log(`unsupported probe: ${JSON.stringify(unsupported)}`);

    const only = process.env.RAW_FILES?.split(',').filter(Boolean);
    const files = only?.length ? FILES.filter((f) => only.includes(f.key)) : FILES;
    const summary = [];
    for (const file of process.env.RAW_SKIP_MAIN ? [] : files) {
      const t0 = Date.now();
      console.log(`=== ${file.key} (${file.path}) ===`);
      const result = await page.evaluate(
        ([p, k]) => window.__poc.runFile(p, k, { maxImageWidth: 1024 }),
        [file.path, file.key],
      );
      const images = result.images ?? {};
      delete result.images;
      for (const [name, img] of Object.entries(images)) {
        if (!img?.url) continue;
        const bytes = await saveDataURL(path.join(OUT, 'images'), `${file.key}_${name}.jpg`, img.url);
        img.savedAs = `images/${file.key}_${name}.jpg`;
        img.fileBytes = bytes;
        delete img.url;
      }
      result.images = images;
      if (process.env.RAW_LIBRAW !== '0') {
        console.log(`libraw reference decode: ${file.key}`);
        result.libraw = await page.evaluate((p) => window.__poc.runLibRaw(p, 1024), file.path);
        if (result.libraw?.image?.url) {
          const bytes = await saveDataURL(path.join(OUT, 'images'), `${file.key}_libraw.jpg`, result.libraw.image.url);
          result.libraw.image.savedAs = `images/${file.key}_libraw.jpg`;
          result.libraw.image.fileBytes = bytes;
          delete result.libraw.image.url;
        }
      }
      result.totalWallSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
      await writeFile(path.join(OUT, `${file.key}.json`), JSON.stringify(result, null, 2));
      const d = result.decode ?? {};
      summary.push({
        key: file.key,
        format: result.format,
        detectFormat: result.detectFormat,
        layout: d.linear_rgb_f32?.summary?.layout,
        cfa: d.raw_u16?.summary?.cfa?.pattern ?? null,
        width: d.rgba8?.summary?.width ?? null,
        height: d.rgba8?.summary?.height ?? null,
        inputMB: Number((result.fileBytes / 1048576).toFixed(1)),
        rgba8: { wallMs: d.rgba8?.wallMsMedian, outputMB: d.rgba8?.outputMB, peakHeapDeltaMB: d.rgba8?.peakHeapDeltaMB },
        linearF32: { wallMs: d.linear_rgb_f32?.wallMsMedian, outputMB: d.linear_rgb_f32?.outputMB, peakHeapDeltaMB: d.linear_rgb_f32?.peakHeapDeltaMB },
        linearF16: { wallMs: d.linear_rgb_f16?.wallMsMedian, outputMB: d.linear_rgb_f16?.outputMB },
        rawU16: { wallMs: d.raw_u16?.wallMsMedian, outputMB: d.raw_u16?.outputMB },
        f16VsF32Display8: result.precision?.f16VsF32?.display8 ?? null,
        linearRgb16VsF32Display8: result.precision?.linearRgb16VsF32?.display8 ?? null,
        demosaic: Object.fromEntries(Object.entries(result.demosaic ?? {}).map(([k, v]) => [k, v.ok ? { wallMs: v.wallMsMedian, meanAbsCodeVsAuto: v.diffVsAuto?.display8?.meanAbsCode, differingFracVsAuto: v.diffVsAuto?.display8?.differingFrac } : { error: v.error?.message }])),
        highlights: Object.fromEntries(Object.entries(result.highlights ?? {}).map(([k, v]) => [k, v.ok ? { wallMs: v.wallMsMedian, meanAbsCodeVsClip: v.diffVsClip?.display8?.meanAbsCode, maxCodeVsClip: v.diffVsClip?.display8?.maxCode } : { error: v.error?.message }])),
        whiteBalance: Object.fromEntries(Object.entries(result.whiteBalance ?? {}).map(([k, v]) => [k, v.ok ? { wallMs: v.wallMsMedian, meanLinearRGB: v.meanLinearRGB, meanAbsCodeVsAsShot: v.diffVsAsShot?.display8?.meanAbsCode } : { error: v.error?.message }])),
        region: result.region,
        libraw: result.libraw ? { ok: result.libraw.ok, openMs: result.libraw.openMs, imageMs: result.libraw.imageMs, width: result.libraw.width, height: result.libraw.height, bits: result.libraw.bits, colors: result.libraw.colors, error: result.libraw.error ?? null } : null,
        warnings: d.rgba8?.summary?.warnings ?? [],
        incomplete: d.rgba8?.summary?.incomplete ?? null,
        source: d.rgba8?.summary?.source ?? null,
        backend: d.rgba8?.summary?.backend?.decode ?? null,
        totalWallSeconds: result.totalWallSeconds,
        rawJson: `${file.key}.json`,
      });
      console.log(`done ${file.key} in ${result.totalWallSeconds}s`);
    }
    // IMG-01: colour pipeline contract (scene-linear vs SDR, camera matrix + WB order, exposure, primaries)
    const deepKeys = new Set(['cr3_canon_r6m3', 'raf_fuji_xt4']);
    const contracts = [];
    for (const file of process.env.RAW_SKIP_CONTRACT ? [] : files) {
      console.log(`=== color contract ${file.key} ===`);
      const c = await page.evaluate(
        ([p, o]) => window.__poc.runColorContract(p, o),
        [file.path, { exposure: deepKeys.has(file.key), p3: deepKeys.has(file.key) }],
      );
      await writeFile(path.join(OUT, `color_contract_${file.key}.json`), JSON.stringify(c, null, 2));
      contracts.push({ key: file.key, ...c });
      const s = summary.find((x) => x.key === file.key);
      if (s) {
        s.colorContract = {
          ok: c.ok,
          bridgeMaxCode: c.sdrBridge?.bridgeVsDecoder?.maxCode ?? null,
          bridgeMeanAbsCode: c.sdrBridge?.bridgeVsDecoder?.meanAbsCode ?? null,
          bridgeDifferingFrac: c.sdrBridge?.bridgeVsDecoder?.differingFrac ?? null,
          wbOrderPreMatrix: c.whiteBalanceOrder?.preMatrix ?? null,
          wbOrderResidualP99: c.whiteBalanceOrder?.residual?.p99 ?? null,
          wbOrderGreenBlueChangedFrac: c.whiteBalanceOrder?.greenBlueChangedFrac ?? null,
          linearOver1Frac: c.asShot?.stats?.over1Frac ?? null,
          linearMax: c.asShot?.stats?.max ?? null,
          atOneFrac: c.asShot?.stats?.atOneFrac ?? null,
          exposurePlus1ChannelRatio: c.exposure?.plus1EV?.medianChannelRatio ?? null,
          exposureMinus1ChannelRatio: c.exposure?.minus1EV?.medianChannelRatio ?? null,
          workingSpaceHonored: c.workingSpace?.requestedP3Honored ?? null,
          resolution: c.resolution ?? null,
        };
      }
      console.log(`contract ${file.key}: ok=${c.ok} bridgeMax=${c.sdrBridge?.bridgeVsDecoder?.maxCode} wbPreMatrix=${c.whiteBalanceOrder?.preMatrix}`);
    }
    if (contracts.length) await writeFile(path.join(OUT, 'color_contract.json'), JSON.stringify(contracts, null, 2));

    // IMG-06: corrupt/unsupported/limit handling and resource release on failure paths.
    const robustness = [];
    const failureProbes = process.env.RAW_SKIP_ROBUSTNESS ? [] : [
      { label: 'jpeg-as-raw', path: 'notraw.jpg', opts: {} },
      { label: 'truncated-cr3-strict', path: 'corrupt/truncated.CR3', opts: { decode: { output: 'rgba8', corruptionPolicy: 'strict' } } },
      { label: 'truncated-cr3-recover', path: 'corrupt/truncated.CR3', opts: { decode: { output: 'rgba8', corruptionPolicy: 'recover' } } },
      { label: 'truncated-raf-strict', path: 'corrupt/truncated.RAF', opts: { decode: { output: 'rgba8', corruptionPolicy: 'strict' } } },
      { label: 'truncated-raf-recover', path: 'corrupt/truncated.RAF', opts: { decode: { output: 'rgba8', corruptionPolicy: 'recover' } } },
      { label: 'truncated-dng-strict', path: 'corrupt/truncated.DNG', opts: { decode: { output: 'rgba8', corruptionPolicy: 'strict' } } },
      { label: 'truncated-dng-recover', path: 'corrupt/truncated.DNG', opts: { decode: { output: 'rgba8', corruptionPolicy: 'recover' } } },
      { label: 'random-bytes', path: 'corrupt/random.CR3', opts: {} },
      { label: 'max-dimension-limit', path: 'cr3/IMG_4243.CR3', opts: { openLimits: { maxDimension: 1000 } } },
      { label: 'max-samples-limit', path: 'cr3/IMG_4243.CR3', opts: { openLimits: { maxSamples: 2_000_000 } } },
    ];
    for (const probe of failureProbes) {
      console.log(`=== robustness ${probe.label} ===`);
      const r = await page.evaluate(([p, o]) => window.__poc.probeFailure(p, o), [probe.path, probe.opts]);
      robustness.push({ label: probe.label, ...r });
    }
    if (robustness.length) await writeFile(path.join(OUT, 'robustness.json'), JSON.stringify(robustness, null, 2));

    // IMG-06: repeated open/decode and cooperative cancellation release resources.
    if (!process.env.RAW_SKIP_RELEASE) {
      // Reload first so the heap baseline is not polluted by earlier decodes.
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__poc);
      await page.evaluate(() => window.__poc.ready);
      const release = [];
      const releaseFiles = files.filter((f) => ['cr3_canon_r6m3', 'arw_sony_a7m3', 'raf_fuji_xt4'].includes(f.key));
      for (const file of (releaseFiles.length ? releaseFiles : files.slice(0, 1))) {
        console.log(`=== release ${file.key} ===`);
        const r = await page.evaluate((p) => window.__poc.repeatOpenDecode(p, 4), file.path);
        release.push({ key: file.key, ...r });
      }
      const cancel = await page.evaluate((p) => window.__poc.runCancelProbe(p, 0), 'cr3/IMG_4243.CR3');
      release.push({ key: 'cancel_cr3', ...cancel });
      if (release.length) await writeFile(path.join(OUT, 'release.json'), JSON.stringify(release, null, 2));
    }

    if (summary.length) await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    else console.log('summary.json kept (main phase skipped)');
    console.log('RAW PoC complete');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
