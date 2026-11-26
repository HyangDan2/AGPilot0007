#!/usr/bin/env node
// Q04 CP1 benchmark: drives the PoC batch export pipeline (decode -> shared
// WebGL export -> encode) on public sample photos inside headless Chromium.
// Everything runs locally; no image leaves the machine.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const path = require('node:path');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = Number(process.env.Q04_BENCH_PORT ?? 5197);
const BASE = `http://127.0.0.1:${PORT}`;
const JSON_OUT = process.env.Q04_BENCH_JSON !== '0';

function startServer() {
  const vite = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite dev server did not start on ${BASE}`);
}

async function runBenchmark(page) {
  return page.evaluate(async () => {
    const { BatchQueue } = await import('/src/poc/q04/batchQueue.ts');
    const { createExportProcessor } = await import('/src/poc/q04/batchExport.ts');
    const { createEditState } = await import('/src/poc/q04/editState.ts');
    const { decodeImageFile } = await import('/src/engine/image/decoder.ts');
    const { detectDeviceProfile, recommendedConcurrency } = await import('/src/poc/q04/resources.ts');

    const SAMPLE_URLS = [
      '/samples/film_test_portrait.jpg',
      '/samples/portrait_test.png',
      '/samples/landscape_test.png',
      '/samples/about_preview.jpg',
    ];
    const films = ['FS-001', 'FS-002', 'FS-003'];

    const samples = [];
    for (const url of SAMPLE_URLS) {
      const response = await fetch(url);
      const blob = await response.blob();
      const name = url.split('/').at(-1);
      samples.push({ url, name, file: new File([blob], name, { type: blob.type }), bytes: blob.size });
    }

    const memory = performance.memory;
    const heapMB = () => (memory ? memory.usedJSHeapSize / (1024 * 1024) : null);

    const decodePass = [];
    for (const sample of samples) {
      const start = performance.now();
      const image = await decodeImageFile(sample.file, sample.name);
      const ms = performance.now() - start;
      decodePass.push({
        name: sample.name,
        bytes: sample.bytes,
        width: image.originalWidth,
        height: image.originalHeight,
        ms,
      });
      if (image.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(image.sourceUrl);
    }

    const handle = createExportProcessor({
      exportOptions: { format: 'image/jpeg', quality: 0.85, scale: 0.5 },
    });
    const fullHandle = createExportProcessor({
      exportOptions: { format: 'image/jpeg', quality: 0.9, scale: 1 },
    });

    const coldSample = samples[0];
    const coldEntry = { id: 'cold', name: coldSample.name, path: coldSample.name, getFile: async () => coldSample.file };
    const coldStart = performance.now();
    const coldResult = await handle.processor(
      { id: 'cold', meta: { entry: coldEntry, edit: createEditState({ activeFilmId: 'FS-001' }) } },
      { id: 'cold', signal: new AbortController().signal, report: () => {} },
    );
    const cold = {
      ms: performance.now() - coldStart,
      width: coldResult.width,
      height: coldResult.height,
      bytes: coldResult.fileSize,
    };
    URL.revokeObjectURL(coldResult.objectUrl);

    async function runQueue(label, concurrency, jobCount, processor = handle.processor) {
      const jobs = [];
      for (let i = 0; i < jobCount; i++) {
        const sample = samples[i % samples.length];
        const entry = {
          id: `${label}-${i}`,
          name: sample.name,
          path: sample.name,
          getFile: async () => sample.file,
        };
        jobs.push({
          id: `${label}-${i}`,
          meta: { entry, edit: createEditState({ activeFilmId: films[i % films.length] }) },
        });
      }

      const durations = [];
      let failed = 0;
      let output = null;
      const outputs = [];
      let peakHeap = heapMB();
      const sampler = memory ? setInterval(() => {
        const current = heapMB();
        if (current !== null) peakHeap = Math.max(peakHeap, current);
      }, 100) : null;

      const queue = new BatchQueue({
        concurrency,
        processor,
        onSettled: (job, outcome) => {
          if (outcome.status === 'succeeded') {
            durations.push(job.finishedAt - job.startedAt);
            outputs.push({ width: outcome.result.width, height: outcome.result.height, bytes: outcome.result.fileSize });
            output ??= outputs.at(-1);
            URL.revokeObjectURL(outcome.result.objectUrl);
          } else {
            failed++;
          }
          const current = heapMB();
          if (current !== null) peakHeap = Math.max(peakHeap, current);
        },
      });

      const wallStart = performance.now();
      queue.add(jobs);
      const snapshot = await queue.drain();
      const wallMs = performance.now() - wallStart;
      if (sampler) clearInterval(sampler);
      queue.destroy();

      return {
        label,
        concurrency,
        jobs: jobCount,
        succeeded: snapshot.counts.succeeded,
        failed,
        wallMs,
        perJobMs: wallMs / Math.max(1, snapshot.counts.succeeded),
        avgJobMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
        peakHeapMB: peakHeap,
        output,
      };
    }

    const profile = detectDeviceProfile();
    const recommended = recommendedConcurrency(profile);
    const warmup = await runQueue('warmup-concurrency-2', 2, 4);
    const atTwo = await runQueue('concurrency-2', 2, 8);
    const atThree = await runQueue('concurrency-3', 3, 8);
    const fullScale = await runQueue(`full-scale-concurrency-${recommended}`, recommended, 4, fullHandle.processor);

    handle.clearLutCache();
    fullHandle.clearLutCache();

    return {
      environment: {
        userAgent: navigator.userAgent,
        deviceProfile: profile,
        recommendedConcurrency: recommendedConcurrency(profile),
        heapLimitMB: memory ? memory.jsHeapSizeLimit / (1024 * 1024) : null,
        webgl2: !!document.createElement('canvas').getContext('webgl2'),
      },
      samples: samples.map(({ name, bytes }) => ({ name, bytes })),
      decodePass: {
        images: decodePass,
        totalMs: decodePass.reduce((a, d) => a + d.ms, 0),
      },
      cold,
      warmup,
      runs: [atTwo, atThree, fullScale],
    };
  });
}

function formatTable(result) {
  const lines = [];
  lines.push('Q04 CP1 batch export benchmark (Playwright Chromium, local samples)');
  lines.push(`chromium: ${result.environment.userAgent}`);
  lines.push(
    `device profile: deviceMemory=${result.environment.deviceProfile.deviceMemory ?? '?'}GB cores=${result.environment.deviceProfile.hardwareConcurrency} mobile=${result.environment.deviceProfile.mobile} -> recommended concurrency ${result.environment.recommendedConcurrency}, webgl2=${result.environment.webgl2}`,
  );
  lines.push('');
  lines.push('sample images:');
  for (const s of result.samples) lines.push(`  ${s.name.padEnd(28)} ${(s.bytes / 1024).toFixed(0).padStart(7)} KB`);
  lines.push('');
  lines.push('decode only (createImageBitmap):');
  for (const d of result.decodePass.images) {
    lines.push(`  ${d.name.padEnd(28)} ${String(d.width).padStart(5)}x${String(d.height).padEnd(5)} ${d.ms.toFixed(1).padStart(8)} ms`);
  }
  lines.push('');
  lines.push(`cold first export (shader compile + LUT load): ${result.cold.ms.toFixed(0)} ms -> ${result.cold.width}x${result.cold.height}, ${(result.cold.bytes / 1024).toFixed(0)} KB`);
  lines.push('');
  lines.push('queue runs (scale 0.5, JPEG q0.85, real WebGL export):');
  for (const run of result.runs) {
    const heap = run.peakHeapMB === null ? 'n/a' : `${run.peakHeapMB.toFixed(0)} MB`;
    const out = run.output
      ? ` out=${run.output.width}x${run.output.height} ${(run.output.bytes / 1024).toFixed(0)} KB`
      : '';
    lines.push(
      `  ${run.label.padEnd(28)} jobs=${run.jobs} ok=${run.succeeded} fail=${run.failed} wall=${run.wallMs.toFixed(0)} ms per-job=${run.perJobMs.toFixed(0)} ms avg-job=${(run.avgJobMs ?? 0).toFixed(0)} ms peak-heap=${heap}${out}`,
    );
  }
  return lines.join('\n');
}

async function main() {
  const server = startServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      // Q04_BENCH_GPU=1 asks headless Chromium for the real GPU (ANGLE Metal
      // on macOS). Without it exports run on SwiftShader, i.e. a slow floor.
      args: process.env.Q04_BENCH_GPU === '1'
        ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
        : [],
    });
    const page = await browser.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const result = await runBenchmark(page);
    const table = formatTable(result);
    console.log(table);
    if (JSON_OUT) {
      console.log('\n--- json ---');
      console.log(JSON.stringify(result, null, 2));
    }
    const failed = result.runs.some((run) => run.failed > 0);
    if (failed) {
      process.exitCode = 1;
      console.error('benchmark reported failed exports');
    }
  } finally {
    await browser?.close().catch(() => {});
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
