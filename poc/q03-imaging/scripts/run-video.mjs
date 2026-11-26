import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/Users/jaehyukshim/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'video');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

const FILES = [
  { key: 'h264_aac_720p', path: 'video/h264_aac_720p_6s.mp4', container: 'mp4' },
  { key: 'h264_aac_1080p', path: 'video/h264_aac_1080p_10s.mp4', container: 'mp4' },
  { key: 'vp9_opus_720p', path: 'video/vp9_opus_720p_6s.webm', container: 'webm' },
  { key: 'hevc_aac_360p', path: 'video/hevc_aac_360p_3s.mp4', container: 'mp4' },
  { key: 'av1_opus_360p', path: 'video/av1_opus_360p_4s.webm', container: 'webm' },
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

async function saveDataURL(dir, name, dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  await writeFile(path.join(dir, name), Buffer.from(b64, 'base64'));
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`chromium not found: ${CHROME}`);
  await mkdir(OUT, { recursive: true });
  await mkdir(path.join(OUT, 'images'), { recursive: true });

  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[vite:err] ${d}`));

  let browser;
  try {
    await waitPort(PORT);
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);
    page.on('console', (msg) => console.log(`[page] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));
    await page.goto(`${BASE}/video.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__poc && typeof window.__poc.capabilities === 'function');

    const caps = await page.evaluate(() => window.__poc.capabilities());
    await writeFile(path.join(OUT, 'capabilities.json'), JSON.stringify(caps, null, 2));
    console.log(`capabilities apis: ${JSON.stringify(caps.apis)}`);

    const analysis = [];
    for (const file of FILES) {
      console.log(`=== analyze ${file.key} ===`);
      const a = await page.evaluate((p) => window.__poc.analyze(p), file.path);
      await writeFile(path.join(OUT, `analysis_${file.key}.json`), JSON.stringify(a, null, 2));
      analysis.push({ key: file.key, ...a });
    }
    await writeFile(path.join(OUT, 'analysis.json'), JSON.stringify(analysis, null, 2));

    const benches = [];
    for (const file of FILES) {
      for (const mode of ['decode-draw', 'decode-grade']) {
        console.log(`=== bench ${file.key} ${mode} ===`);
        const b = await page.evaluate(([p, m]) => window.__poc.bench(p, m), [file.path, mode]);
        benches.push({ key: file.key, mode, ...b });
        console.log(`bench ${file.key} ${mode}: ${b.ok ? `${b.fps} fps (${b.frames} frames)` : b.error}`);
      }
    }
    await writeFile(path.join(OUT, 'bench.json'), JSON.stringify(benches, null, 2));

    const transcodes = [];
    for (const file of FILES) {
      console.log(`=== transcode ${file.key} ===`);
      const t = await page.evaluate((p) => window.__poc.transcode(p, { strength: 0.85, snapshotAt: 1.0 }), file.path);
      const images = t.images ?? {};
      delete t.images;
      for (const [name, img] of Object.entries(images)) {
        if (!img?.url) continue;
        await saveDataURL(path.join(OUT, 'images'), `${file.key}_${name}.jpg`, img.url);
        img.savedAs = `images/${file.key}_${name}.jpg`;
        delete img.url;
      }
      t.images = images;
      if (t.outputBase64) {
        const outName = `out_${file.key}.${t.container === 'webm' ? 'webm' : 'mp4'}`;
        await writeFile(path.join(OUT, outName), Buffer.from(t.outputBase64, 'base64'));
        t.outputSavedAs = outName;
        delete t.outputBase64;
      }
      transcodes.push({ key: file.key, ...t });
      console.log(`transcode ${file.key}: ${t.ok ? `${t.frames} frames, ${t.timing?.fps} fps, ${t.output?.bytes} bytes` : t.error}`);
    }
    await writeFile(path.join(OUT, 'transcode.json'), JSON.stringify(transcodes, null, 2));
    console.log('VIDEO PoC complete');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
