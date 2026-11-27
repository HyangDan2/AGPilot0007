import { describe, expect, it } from 'vitest';
import { analyzePixels, type PixelSample } from '../src/poc/q04/analysis';
import { recommendFilms, featuresFromAnalysis, type RecommendationFeatures } from '../src/poc/q04/recommend';
import { computeVirtualWindow } from '../src/poc/q04/virtualization';
import { searchMetadata, type ImageMetadata } from '../src/poc/q04/metadata';
import { clickSelection } from '../src/poc/q04/selection';
import { BatchQueue } from '../src/poc/q04/batchQueue';

interface Measurement {
  label: string;
  iterations: number;
  totalMs: number;
  roundMs: number[];
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

const measurements: Measurement[] = [];

// Wall-clock micro-benchmarks drift when vitest runs test files on parallel
// worker threads. Each measurement is split into rounds; min/median/p95/max are
// all reported and assertions use the median so a single scheduler stall cannot
// flip a pass/fail while real regressions still raise the median.
const ROUNDS = 6;

function summarize(label: string, iterations: number, totalMs: number, roundMs: number[]): Measurement {
  const sorted = [...roundMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const result: Measurement = {
    label,
    iterations,
    totalMs,
    roundMs: sorted,
    minMs: sorted[0] ?? 0,
    medianMs: median,
    p95Ms: p95,
    maxMs: sorted.at(-1) ?? 0,
  };
  measurements.push(result);
  return result;
}

function measure(label: string, iterations: number, run: (iteration: number) => void): Measurement {
  const perRound = Math.max(1, Math.ceil(iterations / ROUNDS));
  run(0);
  let totalMs = 0;
  const roundMs: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    for (let i = 0; i < perRound; i++) run(round * perRound + i);
    const elapsed = performance.now() - start;
    totalMs += elapsed;
    roundMs.push(elapsed / perRound);
  }
  return summarize(label, perRound * ROUNDS, totalMs, roundMs);
}

function gradientSample(): PixelSample {
  const width = 192;
  const height = 192;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = Math.round((x / width) * 255);
      data[offset + 1] = Math.round((y / height) * 255);
      data[offset + 2] = Math.round(((x + y) / (width + height)) * 255);
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('Q04 large-folder PoC performance', () => {
  it('measures analysis, recommendation and virtualization throughput', () => {
    const sample = gradientSample();
    const analysis = analyzePixels(sample);
    const features: RecommendationFeatures = featuresFromAnalysis(analysis);

    const analysisResult = measure('analyzePixels 192x192', 200, () => analyzePixels(sample));
    const recommendResult = measure('recommendFilms x9 profiles', 2000, () => recommendFilms(features));
    const windowResult = measure('virtual window 100k entries', 10000, (i) => computeVirtualWindow({ count: 100000, viewportWidth: 1200, scrollLeft: (i * 7919) % (116 * 100000 - 1200) }));
    const ids = Array.from({ length: 10000 }, (_, i) => `photo-${i}`);
    const selectionResult = measure('shift-range selection 10k ids', 2000, (i) => clickSelection({ ids: [ids[0]], anchor: ids[0], active: ids[0] }, ids, ids[(i * 37) % ids.length], { shiftKey: true }));

    expect(analysisResult.medianMs).toBeLessThan(20);
    expect(recommendResult.medianMs).toBeLessThan(5);
    expect(windowResult.medianMs).toBeLessThan(1);
    expect(selectionResult.medianMs).toBeLessThan(1);
  });

  it('measures EXIF search over a 10k-photo index', () => {
    const records: ImageMetadata[] = Array.from({ length: 10000 }, (_, i) => ({
      id: `p${i}`,
      name: `IMG_${String(i).padStart(5, '0')}.jpg`,
      path: `trip/IMG_${String(i).padStart(5, '0')}.jpg`,
      captureDate: `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      cameraModel: i % 3 === 0 ? 'Canon EOS R5' : i % 3 === 1 ? 'Fujifilm X-T5' : 'Sony A7 IV',
      iso: [100, 200, 400, 800, 1600, 3200][i % 6],
      indexedAt: 1,
    }));
    const result = measure('search 10k records (text+iso+sort)', 256, () =>
      searchMetadata(records, { text: 'canon', isoMax: 1600, sort: 'date-desc', limit: 50 }),
    );
    expect(result.medianMs).toBeLessThan(20);
  }, 20000);

  it('measures batch queue job throughput with bounded concurrency', async () => {
    const roundMs: number[] = [];
    let totalMs = 0;
    let succeeded = 0;
    for (let round = 0; round < 3; round++) {
      const queue = new BatchQueue<number, number>({
        concurrency: 4,
        processor: async (input) => {
          await Promise.resolve();
          await Promise.resolve();
          return input.meta * 2;
        },
      });
      const start = performance.now();
      queue.add(Array.from({ length: 100 }, (_, i) => ({ id: `r${round}-${i}`, meta: i })));
      const snapshot = await queue.drain();
      const elapsed = performance.now() - start;
      totalMs += elapsed;
      roundMs.push(elapsed / 100);
      succeeded += snapshot.counts.succeeded;
      queue.destroy();
    }
    const result = summarize('batch queue 300 mock jobs (concurrency 4)', 300, totalMs, roundMs);
    expect(succeeded).toBe(300);
    expect(result.medianMs).toBeLessThan(50);
  });

  it('prints the measurement table', () => {
    const header = `${'measurement'.padEnd(42)} ${'min'.padStart(9)} ${'median'.padStart(9)} ${'p95'.padStart(9)} ${'max'.padStart(9)}  ms/op`;
    const lines = measurements.map(
      (m) =>
        `${m.label.padEnd(42)} ${m.minMs.toFixed(4).padStart(9)} ${m.medianMs.toFixed(4).padStart(9)} ${m.p95Ms
          .toFixed(4)
          .padStart(9)} ${m.maxMs.toFixed(4).padStart(9)}`,
    );
    console.log(['Q04 CP1 performance (vitest happy-dom, Node ' + process.version + ', 6 rounds)', header, ...lines].join('\n'));
    expect(measurements.length).toBeGreaterThanOrEqual(6);
  });
});
