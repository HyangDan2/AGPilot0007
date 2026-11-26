import { FlashRaw, init, detectFormat, supportsFile } from 'flashraw';
import {
  IMAGING_CONTRACT_VERSION,
  assertSceneLinearFrame,
  compareSrgb8,
  XYZ_D65_TO_LINEAR_SRGB,
  halfToFloat,
  invert3x3,
  linearStats,
  matMul3,
  matVec3,
  resolutionContract,
  resolveCameraMatrix,
  sceneLinearToDisplaySrgb8,
  srgb8,
  type SceneLinearFrame,
} from '../shared/imagingContract';

const logEl = () => document.getElementById('log') as HTMLDivElement;
function log(msg: string) {
  const el = logEl();
  if (el) el.textContent += `${msg}\n`;
}

type AnyFrame = any;

function sanitize(value: any, depth = 0): any {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  }
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Float32Array || value instanceof Uint8ClampedArray || value instanceof Int32Array) {
    return `[${value.constructor.name} ${value.byteLength}B]`;
  }
  if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength}B]`;
  if (depth > 6) return '[depth-limit]';
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v, depth + 1);
    return out;
  }
  return String(value);
}

const heap = () => (performance as any).memory?.usedJSHeapSize ?? null;

interface SampleStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p01: number;
  p50: number;
  p99: number;
  clippedGreatherThan1: number;
  zeroFrac: number;
}

function percentile(sorted: Float64Array | Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function sampleStats(data: ArrayLike<number>, channels: number, opts: { isFloat: boolean; maxValue: number }): SampleStats | null {
  const pixels = Math.floor(data.length / channels);
  if (!pixels) return null;
  const stride = Math.max(1, Math.floor(pixels / 400000));
  const lum: number[] = [];
  let n = 0, min = Infinity, max = -Infinity, sum = 0, clip = 0, zero = 0;
  for (let px = 0; px < pixels; px += stride) {
    const o = px * channels;
    let l = 0;
    for (let ch = 0; ch < Math.min(channels, 3); ch++) {
      let v = data[o + ch] as number;
      if (!opts.isFloat) v = v / opts.maxValue;
      l += v / Math.min(channels, 3);
      if (v > 1.0) clip++;
    }
    lum.push(l);
    if (l < min) min = l;
    if (l > max) max = l;
    sum += l;
    if (l === 0) zero++;
    n++;
  }
  lum.sort((a, b) => a - b);
  return {
    count: n,
    min, max,
    mean: sum / n,
    p01: percentile(lum, 0.01),
    p50: percentile(lum, 0.5),
    p99: percentile(lum, 0.99),
    clippedGreatherThan1: clip,
    zeroFrac: n ? zero / n : 0,
  };
}

interface CompareResult {
  samples: number;
  mae: number;
  rmse: number;
  maxAbs: number;
  over001: number;
  over005: number;
  display8: { differingFrac: number; meanAbsCode: number; p99Code: number; maxCode: number };
}

function compareLinearBand(a: ArrayLike<number>, b: ArrayLike<number>, minValue: number) {
  let n = 0, abs = 0, sq = 0, mx = 0, diffCount = 0, diffSum = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    if (va < minValue) continue;
    n++;
    const d = va - b[i];
    const ad = Math.abs(d);
    abs += ad;
    sq += d * d;
    if (ad > mx) mx = ad;
    const cd = Math.abs(srgb8(Math.max(0, va)) - srgb8(Math.max(0, b[i])));
    if (cd > 0) { diffCount++; diffSum += cd; }
  }
  return {
    samples: n,
    mae: n ? abs / n : 0,
    rmse: n ? Math.sqrt(sq / n) : 0,
    maxAbs: mx,
    display8: { differingFrac: n ? diffCount / n : 0, meanAbsCode: diffCount ? diffSum / diffCount : 0 },
  };
}

function compareLinear(a: ArrayLike<number>, b: ArrayLike<number>): CompareResult | null {
  if (a.length !== b.length) return null;
  const n = a.length;
  let abs = 0, sq = 0, mx = 0, over001 = 0, over005 = 0;
  const diffs = new Uint8Array(256);
  let diffCount = 0, diffSum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    const ad = Math.abs(d);
    abs += ad;
    sq += d * d;
    if (ad > mx) mx = ad;
    if (ad > 0.01) over001++;
    if (ad > 0.05) over005++;
    const ca = srgb8(a[i]);
    const cb = srgb8(b[i]);
    const cd = Math.abs(ca - cb);
    if (cd > 0) {
      diffCount++;
      diffSum += cd;
      diffs[Math.min(255, cd)]++;
    }
  }
  // cumulative for p99
  let cum = 0, p99 = 0;
  for (let i = 0; i < 256; i++) {
    cum += diffs[i];
    if (cum >= diffCount * 0.99) { p99 = i; break; }
  }
  return {
    samples: n,
    mae: abs / n,
    rmse: Math.sqrt(sq / n),
    maxAbs: mx,
    over001,
    over005,
    display8: {
      differingFrac: diffCount / n,
      meanAbsCode: diffCount ? diffSum / diffCount : 0,
      p99Code: p99,
      maxCode: diffCount ? 255 - diffs.slice().reverse().findIndex((c) => c > 0) : 0,
    },
  };
}

function sRGB8Diff(pixelsA: ArrayLike<number>, pixelsB: ArrayLike<number>): { differingFrac: number; meanAbsCode: number; maxCode: number } | null {
  if (pixelsA.length !== pixelsB.length) return null;
  let n = 0, diffCount = 0, sum = 0, maxCode = 0;
  for (let i = 0; i < pixelsA.length; i++) {
    const d = Math.abs(pixelsA[i] - pixelsB[i]);
    n++;
    if (d > 0) { diffCount++; sum += d; if (d > maxCode) maxCode = d; }
  }
  return { differingFrac: diffCount / n, meanAbsCode: diffCount ? sum / diffCount : 0, maxCode };
}

function frameSummary(frame: AnyFrame) {
  return {
    width: frame.width,
    height: frame.height,
    channels: frame.channels,
    output: frame.output,
    dataType: frame.dataType,
    bitsPerSample: frame.bitsPerSample,
    cfa: sanitize(frame.cfa),
    layout: frame.layout,
    activeArea: sanitize(frame.activeArea),
    crop: sanitize(frame.crop),
    origin: sanitize(frame.origin),
    blackLevel: sanitize(frame.blackLevel),
    whiteLevel: sanitize(frame.whiteLevel),
    whiteBalance: sanitize(frame.whiteBalance),
    whiteBalanceApplied: frame.whiteBalanceApplied,
    colorMatrices: sanitize(frame.colorMatrices),
    orientation: frame.orientation,
    backend: sanitize(frame.backend),
    timings: sanitize(frame.timings),
    inputBytes: frame.inputBytes,
    outputBytes: frame.outputBytes,
    opcodes: sanitize(frame.opcodes),
    incomplete: frame.incomplete,
    warnings: sanitize(frame.warnings),
    source: frame.source,
    colorSpace: frame.colorSpace,
    hasIccProfile: !!frame.iccProfile,
  };
}

interface DecodeRun {
  label: string;
  options: Record<string, any>;
  reps?: number;
}

interface DecodeMeasurement {
  label: string;
  options: Record<string, any>;
  ok: boolean;
  error?: { name: string; message: string };
  wallMsMedian?: number;
  wallMsAll?: number[];
  totalMs?: number;
  stages?: Record<string, number>;
  copyMs?: number;
  outputMB?: number;
  peakHeapDeltaMB?: number | null;
  frame?: any;
  summary?: Record<string, any>;
  linearStats?: SampleStats | null;
  dataRef?: any;
}

function toDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function downscaleDataURL(source: Blob, maxW: number, quality: number, type = 'image/jpeg'): Promise<{ url: string; width: number; height: number }> {
  const bmp = await createImageBitmap(source);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), type, quality));
  const url = await toDataURL(blob);
  canvas.width = 1; canvas.height = 1;
  return { url, width: w, height: h };
}

async function rgbaFrameDataURL(frame: AnyFrame, maxW: number): Promise<{ url: string; width: number; height: number; sourceWidth: number; sourceHeight: number } | null> {
  if (frame.output !== 'rgba8') return null;
  const imageData = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
  const bmp = await createImageBitmap(imageData);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.88));
  const url = await toDataURL(blob);
  canvas.width = 1; canvas.height = 1;
  return { url, width: w, height: h, sourceWidth: frame.width, sourceHeight: frame.height };
}

async function runDecode(root: any, raw: any, run: DecodeRun): Promise<DecodeMeasurement> {
  const reps = run.reps ?? 1;
  const wallTimes: number[] = [];
  let frame: AnyFrame = null;
  const heapBefore = heap();
  let peak = heapBefore;
  const timer = window.setInterval(() => {
    const h = heap();
    if (h !== null && (peak === null || h > peak)) peak = h;
  }, 12);
  let lastError: any = null;
  try {
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      const next = await raw.decode(run.options);
      frame = next;
      const dt = performance.now() - t0;
      wallTimes.push(Number(dt.toFixed(2)));
      if (i < reps - 1) {
        // release intermediate copies before the next rep
        try { next.free?.(); } catch {}
        frame = null;
        await new Promise((r) => setTimeout(r, 30));
        const h = heap();
        if (h !== null) peak = Math.max(peak ?? 0, h);
      }
      await new Promise((r) => setTimeout(r, 0));
      const h = heap();
      if (h !== null) peak = Math.max(peak ?? 0, h);
    }
  } catch (err: any) {
    lastError = err;
  } finally {
    window.clearInterval(timer);
  }
  if (lastError || !frame) {
    return {
      label: run.label,
      options: sanitize(run.options),
      ok: false,
      error: { name: lastError?.name ?? 'Error', message: String(lastError?.message ?? lastError) },
    };
  }
  wallTimes.sort((a, b) => a - b);
  const median = wallTimes[Math.floor(wallTimes.length / 2)];
  const summary = frameSummary(frame);
  const stats = frame.dataType === 'f16'
    ? null
    : sampleStats(frame.data as any, frame.channels, {
        isFloat: frame.dataType === 'f32',
        maxValue: frame.dataType === 'f32' ? 1 : frame.dataType === 'u16' ? 65535 : 255,
      });
  const peakDelta = heapBefore !== null && peak !== null ? (peak - heapBefore) / (1024 * 1024) : null;
  const m: DecodeMeasurement = {
    label: run.label,
    options: sanitize(run.options),
    ok: true,
    wallMsMedian: median,
    wallMsAll: wallTimes,
    totalMs: frame.timings?.totalMs,
    stages: sanitize(frame.timings?.stages ?? {}),
    copyMs: frame.timings?.copyMs,
    outputMB: frame.outputBytes / (1024 * 1024),
    peakHeapDeltaMB: peakDelta === null ? null : Number(peakDelta.toFixed(1)),
    frame: frame,
    summary,
    linearStats: stats,
    dataRef: frame.data,
  };
  return m;
}

function meanLinearRGB(data: ArrayLike<number>, channels: number, strideTarget = 200000): number[] {
  const pixels = Math.floor(data.length / channels);
  const stride = Math.max(1, Math.floor(pixels / strideTarget));
  const sums = [0, 0, 0];
  let n = 0;
  for (let px = 0; px < pixels; px += stride) {
    for (let c = 0; c < 3; c++) sums[c] += data[px * channels + c];
    n++;
  }
  return sums.map((v) => Number((v / Math.max(1, n)).toFixed(5)));
}

function releaseFrame(m: DecodeMeasurement | null | undefined) {
  if (!m) return;
  try { m.frame?.free?.(); } catch {}
  m.frame = null;
  m.dataRef = null;
}

function f16ToFloatArray(data: Uint16Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = halfToFloat(data[i]);
  return out;
}

function u16ToFloatUnit(data: Uint16Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] / 65535;
  return out;
}

function rgba8Channels(frame: AnyFrame): Uint8ClampedArray {
  return frame.data as Uint8ClampedArray;
}

async function runFile(path: string, key: string, opts: { maxImageWidth?: number } = {}) {
  const url = `/testdata/${path}`;
  log(`fetch ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${url}`);
  const blob = await resp.blob();
  log(`${key}: ${(blob.size / 1024 / 1024).toFixed(1)} MB`);

  const detected = await detectFormat(blob);
  const supported = await supportsFile(blob);

  const tOpen = performance.now();
  const raw = await FlashRaw.open(blob);
  const openMs = performance.now() - tOpen;

  const result: Record<string, any> = {
    key,
    path,
    fileBytes: blob.size,
    detectFormat: detected,
    supportsFile: supported,
    openMs: Number(openMs.toFixed(1)),
    parseMs: raw.parseMs,
    format: raw.format,
    binary: raw.binary,
    capabilityFlags: sanitize(raw.capabilities),
    metadata: sanitize(raw.metadata),
    frameInfo: sanitize(raw.frameInfo),
    previews: sanitize(raw.previews),
    tiles: raw.tiles.length,
    decode: {},
    demosaic: {},
    highlights: {},
    whiteBalance: {},
    region: null,
    precision: null,
    precisionAfterAdjustments: {} as Record<string, any>,
    images: {},
    notes: [],
  };

  const runs: DecodeRun[] = [
    { label: 'raw_u16', options: { output: 'raw-u16' } },
    { label: 'raw_f32', options: { output: 'raw-f32' } },
    { label: 'normalized', options: { output: 'normalized' } },
    { label: 'linear_rgb_f32', options: { output: 'linear-rgb' }, reps: 3 },
    { label: 'linear_rgb_f16', options: { output: 'linear-rgb', sampleType: 'f16' } },
    { label: 'linear_rgb16', options: { output: 'linear-rgb16' } },
    { label: 'rgba8', options: { output: 'rgba8' }, reps: 3 },
    { label: 'rgb16', options: { output: 'rgb16' } },
  ];

  const measurements: Record<string, DecodeMeasurement> = {};
  const keepFrames = new Set(['linear_rgb_f32', 'linear_rgb_f16', 'linear_rgb16', 'rgba8']);
  for (const run of runs) {
    log(`${key}: decode ${run.label}`);
    const m = await runDecode(result, raw, run);
    measurements[run.label] = m;
    result.decode[run.label] = { ...m, frame: undefined, dataRef: undefined };
    if (!m.ok) log(`${key}: ${run.label} FAILED ${m.error?.message}`);
    if (m.ok && !keepFrames.has(run.label)) releaseFrame(m);
  }

  const f32 = measurements['linear_rgb_f32'];
  const f16 = measurements['linear_rgb_f16'];
  const lin16 = measurements['linear_rgb16'];
  const rgba8 = measurements['rgba8'];

  if (f32.ok && f32.frame) {
    result.decode['linear_rgb_f32'].meanLinearRGB = meanLinearRGB(f32.frame.data, f32.frame.channels);
  }

  // Demosaic comparison (linear-rgb f32)
  const demosaicVariants = ['bilinear', 'half-size', 'edge-aware', 'ahd', 'ppg', 'rcd'];
  for (const demosaic of demosaicVariants) {
    log(`${key}: demosaic ${demosaic}`);
    const m = await runDecode(result, raw, { label: demosaic, options: { output: 'linear-rgb', demosaic } });
    if (m.ok && f32.ok && m.dataRef && f32.dataRef && m.dataRef.length === f32.dataRef.length) {
      const cmp = compareLinear(f32.dataRef, m.dataRef);
      result.demosaic[demosaic] = { ...m, frame: undefined, dataRef: undefined, diffVsAuto: cmp };
    } else {
      result.demosaic[demosaic] = {
        ...m,
        frame: undefined,
        dataRef: undefined,
        diffVsAuto: null,
        note: m.ok ? `output dimensions differ from auto (${m.summary.width}x${m.summary.height} vs ${f32.summary?.width}x${f32.summary?.height}); no pixel diff computed` : undefined,
      };
    }
    releaseFrame(m);
  }

  // Highlight recovery variants
  for (const highlights of ['neutral', 'blend', 'reconstruct']) {
    log(`${key}: highlights ${highlights}`);
    const m = await runDecode(result, raw, { label: highlights, options: { output: 'linear-rgb', highlights } });
    if (m.ok && f32.ok && m.dataRef && f32.dataRef && m.dataRef.length === f32.dataRef.length) {
      result.highlights[highlights] = { ...m, frame: undefined, dataRef: undefined, diffVsClip: compareLinear(f32.dataRef, m.dataRef) };
    } else {
      result.highlights[highlights] = { ...m, frame: undefined, dataRef: undefined };
    }
    releaseFrame(m);
  }
  result.highlights['clip'] = { label: 'clip', ok: f32.ok, wallMsMedian: f32.wallMsMedian, options: { output: 'linear-rgb' }, note: 'default clip = linear_rgb_f32 baseline' };

  // White balance variants
  const wbRuns = ['daylight', 'auto'] as const;
  for (const whiteBalance of wbRuns) {
    log(`${key}: whiteBalance ${whiteBalance}`);
    const m = await runDecode(result, raw, { label: whiteBalance, options: { output: 'linear-rgb', whiteBalance } });
    if (m.ok && m.dataRef) {
      result.whiteBalance[whiteBalance] = {
        ...m,
        frame: undefined,
        dataRef: undefined,
        meanLinearRGB: meanLinearRGB(m.dataRef, m.frame.channels),
        diffVsAsShot: f32.ok && f32.dataRef && f32.dataRef.length === m.dataRef.length ? compareLinear(f32.dataRef, m.dataRef) : null,
      };
    } else {
      result.whiteBalance[whiteBalance] = { ...m, frame: undefined, dataRef: undefined };
    }
    releaseFrame(m);
  }
  result.whiteBalance['as-shot'] = {
    label: 'as-shot',
    ok: f32.ok,
    wallMsMedian: f32.wallMsMedian,
    meanLinearRGB: result.decode['linear_rgb_f32'].meanLinearRGB ?? null,
  };

  // Precision comparison: f16 and linear16 against f32 (only when dimensions match)
  if (f32.ok && f16.ok && f16.frame && f32.frame && f32.frame.data.length === f16.frame.data.length) {
    const f16Float = f16ToFloatArray(f16.frame.data);
    result.precision = {
      f16VsF32: compareLinear(f32.frame.data, f16Float),
      linearRgb16VsF32: lin16.ok && lin16.frame && lin16.frame.data.length === f32.frame.data.length ? compareLinear(f32.frame.data, u16ToFloatUnit(lin16.frame.data)) : null,
      f32Bytes: f32.frame.data.byteLength,
      f16Bytes: f16.frame.data.byteLength,
      linearRgb16Bytes: lin16.ok && lin16.frame ? lin16.frame.data.byteLength : null,
      displayReadyRgb16Bytes: measurements['rgb16'].outputMB ? Math.round(measurements['rgb16'].outputMB * 1048576) : null,
    };
  }
  releaseFrame(f16);
  releaseFrame(lin16);

  // IMG-10: f16 vs f32 precision after exposure / white balance / highlight recovery.
  if (f32.ok && f16.ok) {
    const precisionVariants = [
      { label: 'exposure+1', options: { output: 'linear-rgb', exposure: 1 } },
      { label: 'exposure+2', options: { output: 'linear-rgb', exposure: 2 } },
      { label: 'whiteBalance-daylight', options: { output: 'linear-rgb', whiteBalance: 'daylight' } },
      { label: 'highlights-blend', options: { output: 'linear-rgb', highlights: 'blend' } },
    ];
    for (const variant of precisionVariants) {
      log(`${key}: precision ${variant.label}`);
      const m32 = await runDecode(result, raw, { label: `${variant.label}_f32`, options: { ...variant.options } });
      const m16 = await runDecode(result, raw, { label: `${variant.label}_f16`, options: { ...variant.options, sampleType: 'f16' } });
      if (m32.ok && m16.ok && m32.frame && m16.frame && m32.frame.data.length === m16.frame.data.length) {
        const a = m32.frame.data as Float32Array;
        const b = f16ToFloatArray(m16.frame.data as Uint16Array);
        result.precisionAfterAdjustments[variant.label] = {
          full: compareLinear(a, b),
          highlightBand: compareLinearBand(a, b, 0.8),
          overOneBand: compareLinearBand(a, b, 1.0),
          wallMs: { f32: m32.wallMsMedian, f16: m16.wallMsMedian },
          outputMB: { f32: Number(m32.outputMB.toFixed(1)), f16: Number(m16.outputMB.toFixed(1)) },
        };
      } else {
        result.precisionAfterAdjustments[variant.label] = { error: m32.error?.message ?? m16.error?.message ?? 'dimension mismatch', f32: m32.summary ? `${m32.summary.width}x${m32.summary.height}` : null, f16: m16.summary ? `${m16.summary.width}x${m16.summary.height}` : null };
      }
      releaseFrame(m32);
      releaseFrame(m16);
    }
  }

  // IMG-01: contract check on the scene-linear buffer actually produced by the decoder.
  if (f32.ok && f32.frame) {
    try {
      const linearFrame: SceneLinearFrame = {
        width: f32.frame.width,
        height: f32.frame.height,
        channels: f32.frame.channels,
        dataType: f32.frame.dataType,
        layout: 'linear',
        transfer: 'linear',
        primaries: f32.frame.colorSpace ?? 'srgb',
        source: f32.frame.source,
        data: f32.frame.data,
      };
      assertSceneLinearFrame(linearFrame);
      const stats = linearStats(linearFrame, 100000);
      result.colorContract = {
        version: IMAGING_CONTRACT_VERSION,
        accepted: true,
        resolution: resolutionContract(raw.frameInfo, f32.frame),
        buffer: { channels: 3, dataType: 'f32', transfer: 'linear', primaries: linearFrame.primaries, source: f32.frame.source, orientation: f32.frame.orientation, bytes: f32.frame.data.byteLength },
        linearStats: stats,
        noEarlyClip: {
          over1ValuesPreserved: stats.max > 1 && stats.over1Frac > 0,
          atOneFrac: stats.atOneFrac,
          note: 'atOneFrac counts samples sitting exactly at 1.0; a linear buffer with >1 values cannot have been clipped to 8-bit',
        },
        embeddedPreviewSeparate: true,
      };
    } catch (err: any) {
      result.colorContract = { version: IMAGING_CONTRACT_VERSION, accepted: false, error: `${err?.name}: ${String(err?.message ?? err)}` };
    }
  }

  // IMG-09: region decode (interactive/preview path) pixel-compared against the full decode.
  try {
    log(`${key}: region decode`);
    const crop = raw.frameInfo?.crop ?? { x: 0, y: 0, width: raw.metadata.width, height: raw.metadata.height };
    const regionW = Math.min(1200, crop.width);
    const regionH = Math.min(800, crop.height);
    const centre = {
      x: crop.x + Math.floor((crop.width - regionW) / 2),
      y: crop.y + Math.floor((crop.height - regionH) / 2),
    };
    const corner = { x: crop.x + Math.min(157, crop.width - regionW), y: crop.y + Math.min(211, crop.height - regionH) };
    const regions = [
      { label: 'centre', x: centre.x, y: centre.y },
      { label: 'corner', x: corner.x, y: corner.y },
    ];
    const full = rgba8.ok && rgba8.frame ? rgba8.frame : null;
    const fullPixels = full ? rgba8Channels(full) : null;
    const fullW = full?.width ?? 0;
    const fullH = full?.height ?? 0;
    const entries: any[] = [];
    for (const r of regions) {
      const t0 = performance.now();
      const frame = await raw.decodeRegion({ x: r.x, y: r.y, width: regionW, height: regionH }, { output: 'rgba8' });
      const dt = performance.now() - t0;
      const entry: Record<string, any> = {
        label: r.label,
        ok: true,
        region: { x: r.x, y: r.y, w: frame.width, h: frame.height },
        wallMs: Number(dt.toFixed(2)),
        totalMs: frame.timings?.totalMs,
        outputMB: Number((frame.outputBytes / 1024 / 1024).toFixed(2)),
      };
      if (fullPixels) {
        const ox = r.x - crop.x;
        const oy = r.y - crop.y;
        const w = Math.min(frame.width, fullW - ox);
        const h = Math.min(frame.height, fullH - oy);
        const regionPixels = rgba8Channels(frame);
        const a: number[] = [];
        const b: number[] = [];
        const interiorA: number[] = [];
        const interiorB: number[] = [];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const ri = (y * frame.width + x) * 4;
            const fi = ((oy + y) * fullW + (ox + x)) * 4;
            for (let c = 0; c < 4; c++) {
              a.push(regionPixels[ri + c]);
              b.push(fullPixels[fi + c]);
              if (x >= 8 && y >= 8 && x < w - 8 && y < h - 8) {
                interiorA.push(regionPixels[ri + c]);
                interiorB.push(fullPixels[fi + c]);
              }
            }
          }
        }
        entry.vsFull = {
          width: w,
          height: h,
          offsetInFull: { x: ox, y: oy },
          all: compareSrgb8(a, b),
          interior8pxExcluded: compareSrgb8(interiorA, interiorB),
        };
        entry.vsFull.exactMatchInside = entry.vsFull.interior8pxExcluded?.maxCode === 0;
      }
      entries.push(entry);
      frame.free?.();
    }
    result.region = {
      ok: entries.every((e) => e.ok),
      coordinateSpace: 'sensor-buffer pixels; converted to full-decode space by subtracting the default crop origin',
      crop,
      decode: entries,
      note: 'border pixels may differ because the region decoder lacks full-frame demosaic context; the 8px-inset interior is compared separately',
    };
  } catch (err: any) {
    result.region = { ok: false, error: { name: err?.name, message: String(err?.message) } };
  }

  // Visual proofs: RAW-developed rgba8 vs embedded preview (kept separate, never substituted)
  if (rgba8.ok && rgba8.frame) {
    result.images.developed = await rgbaFrameDataURL(rgba8.frame, opts.maxImageWidth ?? 1024);
  }
  releaseFrame(rgba8);
  releaseFrame(f32);
  try {
    const preview = await raw.preview({ format: 'encoded' });
    if (preview) {
      result.previewDescriptor = sanitize({ mimeType: preview.mimeType, width: preview.width, height: preview.height, byteLength: preview.data.byteLength, orientation: preview.orientation });
      const blob = new Blob([preview.data], { type: preview.mimeType });
      if (preview.mimeType === 'image/jpeg' || preview.mimeType === 'image/png') {
        const scaled = await downscaleDataURL(blob, opts.maxImageWidth ?? 1024, 0.85);
        result.images.embeddedPreview = { ...scaled, usage: 'reference-only: not used as the RAW development result' };
      }
    }
  } catch (err: any) {
    result.notes.push(`preview extraction failed: ${String(err?.message ?? err)}`);
  }

  // Release all large buffers before returning
  for (const m of Object.values(measurements)) (m as DecodeMeasurement).dataRef = null;
  try { raw.close(); } catch {}
  result.notes.push('All decode outputs released (frames dropped, raw.close() called).');
  return sanitize(result);
}

function linearFrameView(frame: AnyFrame): SceneLinearFrame {
  return {
    width: frame.width,
    height: frame.height,
    channels: frame.channels,
    dataType: frame.dataType,
    layout: 'linear',
    transfer: 'linear',
    primaries: frame.colorSpace ?? 'srgb',
    source: frame.source,
    data: frame.data,
  };
}

function sampleLinearPixels(frame: SceneLinearFrame, target = 15000) {
  const pixels = frame.width * frame.height;
  const stride = Math.max(1, Math.floor(pixels / target));
  const indices: number[] = [];
  const values: number[] = [];
  for (let px = 0; px < pixels; px += stride) {
    const o = px * 3;
    const r = frame.data[o] as number, g = frame.data[o + 1] as number, b = frame.data[o + 2] as number;
    if (![r, g, b].every((v) => Number.isFinite(v) && v > 1e-4 && v < 0.95)) continue;
    indices.push(px);
    values.push(r, g, b);
  }
  return { indices, values };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function runColorContract(path: string, opts: { exposure?: boolean; p3?: boolean } = {}) {
  const resp = await fetch(`/testdata/${path}`);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${path}`);
  const blob = await resp.blob();
  const raw = await FlashRaw.open(blob);
  const out: Record<string, any> = { path, version: IMAGING_CONTRACT_VERSION, ok: false };
  try {
    // 1. As-shot scene-linear output + contract + display bridge (no 8-bit stage on the linear path).
    const asShot = await raw.decode({ output: 'linear-rgb' });
    try {
      const linear = linearFrameView(asShot);
      assertSceneLinearFrame(linear);
      const stats = linearStats(linear, 200000);
      const bridge = sceneLinearToDisplaySrgb8(linear);
      out.resolution = resolutionContract(raw.frameInfo, asShot);
      out.buffer = { channels: 3, dataType: 'f32', transfer: 'linear', primaries: asShot.colorSpace, source: asShot.source, orientation: asShot.orientation, width: asShot.width, height: asShot.height, bytesPerPixel: 12, bytes: asShot.data.byteLength };
      out.asShot = {
        stats,
        meanLinearRGB: meanLinearRGB(asShot.data, 3),
        warnings: sanitize(asShot.warnings),
        noEarlyClip: stats.max > 1 && stats.over1Frac > 0,
      };

      // 2. SDR display path: the decoder's own rgba8 (tone: linear) vs our linear->sRGB8 bridge.
      const rgbaLinear = await raw.decode({ output: 'rgba8', tone: 'linear' });
      try {
        out.sdrBridge = {
          decoderRgba8Linear: frameSummary(rgbaLinear),
          bridgeVsDecoder: compareSrgb8(bridge.data, rgbaLinear.data),
          bridgeBytes: bridge.data.byteLength,
          decoderBytes: rgbaLinear.data.byteLength,
          sameDimensions: bridge.width === rgbaLinear.width && bridge.height === rgbaLinear.height,
          note: 'bridge performs the sRGB transfer only; the decoder path is the SDR comparator',
        };
      } finally {
        rgbaLinear.free?.();
      }

      // 3. WB / camera matrix ordering. WhiteBalanceMultipliers are documented as camera-RGB
      // multipliers, so a 2x red multiplier must act before the 3x3 camera matrix.
      out.whiteBalanceOrder = { tested: false };
      const matrix = resolveCameraMatrix(asShot.colorMatrices ?? raw.frameInfo?.colorMatrices);
      out.cameraMatrix = { found: !!matrix, values: matrix ? matrix.map((v) => Number(v.toFixed(6))) : null, invertible: matrix ? !!invert3x3(matrix) : null };
      out.cameraMatrices = (asShot.colorMatrices?.color ?? []).map((c: any, i: number) => ({ index: i, illuminant: c?.illuminant ?? null, temperature: c?.temperature ?? null }));
      if (matrix) {
        const neutral = await raw.decode({ output: 'linear-rgb', whiteBalanceMultipliers: [1, 1, 1] });
        try {
          const neutralFrame = linearFrameView(neutral);
          const sample = sampleLinearPixels(neutralFrame, 12000);
          const baseVals = sample.values;
          const neutralMean = meanLinearRGB(neutral.data, 3);
          neutral.free?.();
          const variant = await raw.decode({ output: 'linear-rgb', whiteBalanceMultipliers: [2, 1, 1] });
          try {
            // DNG files may carry one matrix per calibration illuminant; evaluate all of them
            // so the order test is not pinned to color[0] (e.g. Ricoh GR III ships A + D65).
            const allMatrices = (asShot.colorMatrices?.color ?? []).map((c: any, i: number) => ({
              label: `color[${i}]${c?.illuminant ? `@${c.illuminant}` : ''}`,
              values: (Array.isArray(c?.values) ? c.values : []).flat().map(Number),
            })).filter((c) => c.values.length === 9);
            const matrixVariants = allMatrices.length ? allMatrices : [{ label: 'colorMatrix', values: matrix }];
            const candidates: { name: string; T: number[] | null }[] = [];
            for (const variantMatrix of matrixVariants) {
              const mv = variantMatrix.values;
              const inv = invert3x3(mv);
              candidates.push(
                { name: `${variantMatrix.label}: colorMatrix`, T: mv },
                { name: `${variantMatrix.label}: inverse(colorMatrix)`, T: inv },
                { name: `${variantMatrix.label}: xyzToSrgb * inverse(colorMatrix)`, T: inv ? matMul3(XYZ_D65_TO_LINEAR_SRGB, inv) : null },
                { name: `${variantMatrix.label}: inverse(xyzToSrgb * colorMatrix)`, T: inv ? invert3x3(matMul3(XYZ_D65_TO_LINEAR_SRGB, mv)) : null },
              );
            }
            const gbChanged: number[] = [];
            for (let si = 0; si < sample.indices.length; si++) {
              const o = sample.indices[si] * 3;
              const nv = [baseVals[si * 3], baseVals[si * 3 + 1], baseVals[si * 3 + 2]];
              const actual = [variant.data[o] as number, variant.data[o + 1] as number, variant.data[o + 2] as number];
              gbChanged.push(Math.max(Math.abs(actual[1] - nv[1]), Math.abs(actual[2] - nv[2])));
            }
            const models = candidates.filter((c) => c.T).map((cand) => {
              const T = cand.T!;
              const Tinv = invert3x3(T);
              const residuals: number[] = [];
              const cosines: number[] = [];
              let predictedOverOne = 0;
              if (Tinv) {
                for (let si = 0; si < sample.indices.length; si++) {
                  const o = sample.indices[si] * 3;
                  const nv = [baseVals[si * 3], baseVals[si * 3 + 1], baseVals[si * 3 + 2]];
                  const cam = matVec3(Tinv, nv);
                  const pred = matVec3(T, [cam[0] * 2, cam[1], cam[2]]);
                  const actual = [variant.data[o] as number, variant.data[o + 1] as number, variant.data[o + 2] as number];
                  let dot = 0, na = 0, np = 0;
                  for (let c = 0; c < 3; c++) {
                    residuals.push(Math.abs(pred[c] - actual[c]));
                    if (pred[c] > 1) predictedOverOne++;
                    const pd = pred[c] - nv[c];
                    const ad = actual[c] - nv[c];
                    dot += pd * ad;
                    na += ad * ad;
                    np += pd * pd;
                  }
                  if (na > 1e-12 && np > 1e-12) cosines.push(dot / Math.sqrt(na * np));
                }
              }
              residuals.sort((a, b) => a - b);
              cosines.sort((a, b) => a - b);
              const p99 = residuals.length ? residuals[Math.min(residuals.length - 1, Math.floor(residuals.length * 0.99))] : Infinity;
              const medianCosine = cosines.length ? cosines[Math.floor(cosines.length / 2)] : null;
              return {
                model: cand.name,
                invertible: !!Tinv,
                residualP99: Number.isFinite(p99) ? Number(p99.toExponential(3)) : null,
                residualMax: residuals.length ? Number(residuals[residuals.length - 1].toExponential(3)) : null,
                medianCosine: medianCosine === null ? null : Number(medianCosine.toFixed(5)),
                overOneSamplesPredicted: predictedOverOne,
              };
            });
            const usable = models.filter((m) => m.invertible && m.residualP99 !== null) as any[];
            usable.sort((a, b) => a.residualP99 - b.residualP99);
            const best = usable[0] ?? null;
            const gbFrac = gbChanged.filter((d) => d > 0.002).length / Math.max(1, gbChanged.length);
            const postResiduals: number[] = [];
            for (let si = 0; si < sample.indices.length; si++) {
              const o = sample.indices[si] * 3;
              const nv = [baseVals[si * 3], baseVals[si * 3 + 1], baseVals[si * 3 + 2]];
              const actual = [variant.data[o] as number, variant.data[o + 1] as number, variant.data[o + 2] as number];
              postResiduals.push(Math.abs(2 * nv[0] - actual[0]), Math.abs(nv[1] - actual[1]), Math.abs(nv[2] - actual[2]));
            }
            postResiduals.sort((a, b) => a - b);
            const postP99 = postResiduals[Math.min(postResiduals.length - 1, Math.floor(postResiduals.length * 0.99))];
            const postResidualP99 = Number.isFinite(postP99) ? Number(postP99.toExponential(3)) : null;
            const exactUnderBest = !!best && best.residualP99 !== null && best.residualP99 < 1e-3;
            const postMatrixRejected = postP99 > 1e-3;
            out.whiteBalanceOrder = {
              tested: true,
              hypothesis: 'if the multipliers act on camera RGB before the camera matrix, doubling red must also move green/blue through the matrix cross-terms',
              samples: sample.indices.length,
              prediction: 'out_variant = T * diag(2,1,1) * T^-1 * out_neutral, for each candidate interpretation T of colorMatrices.color[0]',
              candidateModels: models,
              bestModel: best?.model ?? null,
              bestResidualP99: best?.residualP99 ?? null,
              bestMedianCosine: best?.medianCosine ?? null,
              greenBlueChangedFrac: Number(gbFrac.toFixed(4)),
              neutralMeanRGB: neutralMean,
              variantMeanRGB: meanLinearRGB(variant.data, 3),
              postMatrixResidualP99: postResidualP99,
              postMatrixRejected,
              orderEvidence: exactUnderBest ? 'matrix-exact' : postMatrixRejected && gbFrac > 0.5 ? 'cross-term-response' : null,
              preMatrix: postMatrixRejected && (exactUnderBest || gbFrac > 0.5),
              postMatrixOnly: !exactUnderBest && postP99 <= 1e-3 && gbFrac === 0,
              matrixOrientationConsistent: !!best && best.medianCosine !== null && best.medianCosine > 0.98,
              matrixExactUnderBestModel: exactUnderBest,
            };
          } finally {
            variant.free?.();
          }
        } catch (e: any) {
          out.whiteBalanceOrder = { tested: true, error: `${e?.name}: ${String(e?.message ?? e)}` };
        }
      }

      // 4. Exposure is applied after the colour conversion and must not clamp linear output.
      if (opts.exposure) {
        const samples = sampleLinearPixels(linear, 8000);
        const ratios: { plus: number[][]; minus: number[][] } = { plus: [[], [], []], minus: [[], [], []] };
        const plus = await raw.decode({ output: 'linear-rgb', exposure: 1 });
        try {
          for (const dir of ['plus'] as const) {
            for (let si = 0; si < samples.indices.length; si++) {
              const o = samples.indices[si] * 3;
              for (let c = 0; c < 3; c++) {
                const base = samples.values[si * 3 + c];
                if (base > 1e-3) ratios[dir][c].push((plus.data[o + c] as number) / base);
              }
            }
          }
          out.exposure = {
            plus1EV: {
              stats: linearStats(linearFrameView(plus), 80000),
              medianChannelRatio: ratios.plus.map((r) => Number(median(r).toFixed(5))),
              clippedAtOneFrac: linearStats(linearFrameView(plus), 80000).atOneFrac,
            },
          };
        } finally {
          plus.free?.();
        }
        const minus = await raw.decode({ output: 'linear-rgb', exposure: -1 });
        try {
          for (let si = 0; si < samples.indices.length; si++) {
            const o = samples.indices[si] * 3;
            for (let c = 0; c < 3; c++) {
              const base = samples.values[si * 3 + c];
              if (base > 1e-3) ratios.minus[c].push((minus.data[o + c] as number) / base);
            }
          }
          out.exposure.minus1EV = { stats: linearStats(linearFrameView(minus), 80000), medianChannelRatio: ratios.minus.map((r) => Number(median(r).toFixed(5))) };
        } finally {
          minus.free?.();
        }
        const plus2 = await raw.decode({ output: 'linear-rgb', exposure: 2 });
        try {
          const stats2 = linearStats(linearFrameView(plus2), 120000);
          out.exposure.plus2EV = {
            stats: stats2,
            preservesOverOne: stats2.max > 1 && stats2.over1Frac > 0,
            clippedAtOneFrac: stats2.atOneFrac,
          };
        } finally {
          plus2.free?.();
        }
      }

      // 5. Working primaries are selectable; linear output keeps primaries and unbounded values.
      if (opts.p3) {
        try {
          const p3 = await raw.decode({ output: 'linear-rgb', colorSpace: 'display-p3' });
          try {
            out.workingSpace = {
              p3: { colorSpace: p3.colorSpace, stats: linearStats(linearFrameView(p3), 80000), meanLinearRGB: meanLinearRGB(p3.data, 3) },
              srgb: { colorSpace: asShot.colorSpace, stats, meanLinearRGB: out.asShot.meanLinearRGB },
              requestedP3Honored: p3.colorSpace === 'display-p3',
            };
          } finally {
            p3.free?.();
          }
        } catch (e: any) {
          out.workingSpace = { error: `${e?.name}: ${String(e?.message ?? e)}` };
        }
      }

      // 6. Decoded size/orientation contract.
      out.resolutionCheck = {
        decodedDimensionsMatchCrop: out.resolution.displayWidth === (raw.frameInfo?.crop?.width ?? -1) && out.resolution.displayHeight === (raw.frameInfo?.crop?.height ?? -1),
        orientationApplied: out.resolution.orientationApplied,
        fileOrientation: raw.frameInfo?.orientation ?? null,
        sourceIsSensor: asShot.source === 'sensor',
        channelsRGB: asShot.channels === 3,
      };
      const exposureOk = !opts.exposure || (out.exposure?.plus2EV?.preservesOverOne === true && out.exposure.plus2EV.clippedAtOneFrac < 1e-3);
      out.ok = !!out.sdrBridge?.bridgeVsDecoder && out.sdrBridge.bridgeVsDecoder.maxCode <= 2
        && out.resolutionCheck.orientationApplied && out.resolutionCheck.sourceIsSensor
        && (!out.whiteBalanceOrder.tested || (out.whiteBalanceOrder.preMatrix === true && (out.whiteBalanceOrder.matrixExactUnderBestModel !== true || out.whiteBalanceOrder.matrixOrientationConsistent === true)))
        && exposureOk;
      return sanitize(out);
    } finally {
      asShot.free?.();
    }
  } finally {
    try { raw.close(); } catch {}
  }
}

async function probeFailure(path: string, opts: { openLimits?: any; decode?: Record<string, any>; policy?: 'recover' | 'strict' } = {}) {
  const resp = await fetch(`/testdata/${path}`);
  if (!resp.ok) return { path, ok: false, fetchStatus: resp.status };
  const blob = await resp.blob();
  const before = heap();
  const out: Record<string, any> = { path, bytes: blob.size, openLimits: opts.openLimits ?? null, decodeOptions: opts.decode ?? null, policy: opts.policy ?? null };
  let raw: any = null;
  try {
    raw = await FlashRaw.open(blob, opts.openLimits ? { limits: opts.openLimits } : undefined);
    out.opened = true;
    const frame = await raw.decode(opts.decode ?? { output: 'linear-rgb' });
    try {
      out.decoded = true;
      out.frame = frameSummary(frame);
      out.incomplete = frame.incomplete;
      out.warnings = sanitize(frame.warnings);
    } finally {
      try { frame.free?.(); } catch {}
    }
  } catch (e: any) {
    out.error = { name: e?.name ?? 'Error', kind: e?.kind ?? null, code: e?.code ?? null, message: String(e?.message ?? e) };
    out.corrupt = e?.corrupt ? sanitize(e.corrupt) : null;
  } finally {
    try { raw?.close?.(); } catch {}
    const after = heap();
    out.heap = { beforeMB: before === null ? null : Number((before / 1048576).toFixed(1)), afterMB: after === null ? null : Number((after / 1048576).toFixed(1)) };
  }
  out.released = !raw || raw.closed !== false;
  return sanitize(out);
}

async function repeatOpenDecode(path: string, iterations = 4) {
  const resp = await fetch(`/testdata/${path}`);
  const blob = await resp.blob();
  const series: any[] = [];
  for (let i = 0; i < iterations; i++) {
    const gc = (globalThis as any).gc as undefined | (() => void);
    try { gc?.(); } catch {}
    const before = heap();
    let raw: any = null;
    let frame: any = null;
    try {
      raw = await FlashRaw.open(blob);
      frame = await raw.decode({ output: 'linear-rgb', sampleType: 'f16' });
      const entered = heap();
      series.push({ i, enteredMB: entered === null ? null : Number((entered / 1048576).toFixed(1)), outputMB: Number((frame.outputBytes / 1048576).toFixed(1)) });
    } finally {
      try { frame?.free?.(); } catch {}
      try { raw?.close?.(); } catch {}
    }
    await new Promise((r) => setTimeout(r, 120));
    const gcAfter = (globalThis as any).gc as undefined | (() => void);
    try { gcAfter?.(); } catch {}
    const settled = heap();
    series.push({ i, settledMB: settled === null ? null : Number((settled / 1048576).toFixed(1)), beforeMB: before === null ? null : Number((before / 1048576).toFixed(1)), gc: !!gcAfter });
  }
  const settled = series.filter((s) => s.settledMB !== undefined).map((s) => s.settledMB);
  const entered = series.filter((s) => s.enteredMB !== undefined).map((s) => s.enteredMB);
  return {
    path,
    iterations,
    series,
    settledGrowthMB: settled.length > 1 ? Number((settled[settled.length - 1] - settled[0]).toFixed(1)) : null,
    enteredGrowthMB: entered.length > 1 ? Number((entered[entered.length - 1] - entered[0]).toFixed(1)) : null,
    allClosed: true,
    note: 'FlashRaw free()/close() called in finally on every iteration; WASM linear memory is process-wide and does not shrink, so the JS heap is the reported figure.',
  };
}

async function runCancelProbe(path: string, cancelAfterMs = 120) {
  const resp = await fetch(`/testdata/${path}`);
  const blob = await resp.blob();
  const before = heap();
  const out: Record<string, any> = { path, cancelAfterMs, stagesCompleted: 0 };
  let raw: any = null;
  let frame: any = null;
  const abort = new AbortController();
  let timer = 0;
  try {
    raw = await FlashRaw.open(blob);
    // The cancel request is issued while the first decode is in flight; the signal is checked
    // cooperatively at the next stage boundary, then every resource is released in finally.
    timer = window.setTimeout(() => abort.abort(), Math.max(0, cancelAfterMs));
    frame = await raw.decode({ output: 'linear-rgb' });
    out.stagesCompleted = 1;
    frame.free?.();
    frame = null;
    await new Promise((r) => setTimeout(r, 0));
    if (abort.signal.aborted) throw new DOMException('cancelled between decode stages', 'AbortError');
    frame = await raw.decode({ output: 'linear-rgb', sampleType: 'f16' });
    out.stagesCompleted = 2;
    await new Promise((r) => setTimeout(r, 0));
    if (abort.signal.aborted) throw new DOMException('cancelled between decode stages', 'AbortError');
    out.completed = true;
  } catch (e: any) {
    out.cancelled = e?.name === 'AbortError';
    out.error = `${e?.name}: ${String(e?.message ?? e)}`;
  } finally {
    window.clearTimeout(timer);
    try { frame?.free?.(); } catch {}
    try { raw?.close?.(); } catch {}
    await new Promise((r) => setTimeout(r, 150));
    const gc = (globalThis as any).gc as undefined | (() => void);
    try { gc?.(); } catch {}
    const after = heap();
    out.heap = { beforeMB: before === null ? null : Number((before / 1048576).toFixed(1)), afterMB: after === null ? null : Number((after / 1048576).toFixed(1)), gc: !!gc };
    out.released = !raw || raw.closed !== false;
    out.note = 'FlashRaw cannot interrupt a decode in flight; cancellation is cooperative between stages and still releases the frame and the file.';
  }
  return out;
}

async function probeUnsupported(path: string) {
  const resp = await fetch(`/testdata/${path}`);
  const blob = await resp.blob();
  const out: Record<string, any> = { path, bytes: blob.size };
  try {
    out.detectFormat = await detectFormat(blob);
  } catch (e: any) {
    out.detectFormat = { error: String(e?.message ?? e) };
  }
  try {
    out.supportsFile = await supportsFile(blob);
  } catch (e: any) {
    out.supportsFile = { error: String(e?.message ?? e) };
  }
  try {
    const raw = await FlashRaw.open(blob);
    raw.close();
    out.open = 'opened';
  } catch (e: any) {
    out.open = { error: `${e?.name}: ${String(e?.message ?? e)}` };
  }
  return out;
}

let initPromise: Promise<any> | null = null;

async function ensureInit() {
  if (!initPromise) {
    initPromise = init({ threads: 'auto' }).then((info) => {
      log(`flashraw ${info.version} simd=${info.simd} threads=${info.threads} jpegxl=${info.jpegxl}`);
      return info;
    });
  }
  return initPromise;
}

async function capabilities() {
  const build = await ensureInit();
  await new Promise((r) => setTimeout(r, 150));
  const caps = (globalThis as any).FlashRawCapabilities ?? null;
  void caps;
  const probe = document.createElement('canvas').getContext('webgl2');
  const gl = probe as WebGL2RenderingContext | null;
  const info = {
    contractVersion: IMAGING_CONTRACT_VERSION,
    build: sanitize(build),
    userAgent: navigator.userAgent,
    platform: (navigator as any).userAgentData?.platform ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as any).deviceMemory ?? null,
    crossOriginIsolated: (globalThis as any).crossOriginIsolated ?? false,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    wasmSimd: (() => {
      try { return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])); } catch { return false; }
    })(),
    webgl2: !!gl,
    webgl2MaxTexture: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null,
    webgl2MaxRenderbuffer: gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) : null,
    webgl2Vendor: gl ? (() => { const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) : null; })() : null,
    heapLimitMB: (performance as any).memory?.jsHeapSizeLimit ? Math.round((performance as any).memory.jsHeapSizeLimit / 1048576) : null,
    totalHeapUsedMB: heap() !== null ? Number((heap() / 1048576).toFixed(1)) : null,
    crossOriginIsolatedRequiredForThreads: true,
  };
  if (gl) { const lose = gl.getExtension('WEBGL_lose_context'); lose?.loseContext(); }
  return info;
}

async function runLibRaw(path: string, maxImageWidth = 1024) {
  const resp = await fetch(`/testdata/${path}`);
  const blob = await resp.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { default: LibRaw } = await import('libraw-wasm');
  const libraw = new (LibRaw as any)();
  const out: Record<string, any> = {};
  try {
    const t0 = performance.now();
    await libraw.open(bytes, { outputBps: 8, outputColor: 1, userQual: 3, useCameraWb: true });
    out.openMs = Number((performance.now() - t0).toFixed(1));
    const t1 = performance.now();
    const img = await libraw.imageData();
    out.imageMs = Number((performance.now() - t1).toFixed(1));
    if (!img) {
      out.ok = false;
      out.error = 'imageData() returned nothing';
      return out;
    }
    out.ok = true;
    out.width = img.width;
    out.height = img.height;
    out.colors = img.colors;
    out.bits = img.bits;
    out.dataSize = img.dataSize;
    const channels = img.colors;
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    for (let i = 0, j = 0; i < img.width * img.height; i++, j += channels) {
      rgba[i * 4] = img.data[j];
      rgba[i * 4 + 1] = img.data[j + 1];
      rgba[i * 4 + 2] = img.data[j + 2];
      rgba[i * 4 + 3] = 255;
    }
    const imageData = new ImageData(rgba, img.width, img.height);
    const bmp = await createImageBitmap(imageData);
    const scale = Math.min(1, maxImageWidth / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const outBlob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.88));
    out.image = { url: await toDataURL(outBlob), width: w, height: h, sourceWidth: img.width, sourceHeight: img.height };
    canvas.width = 1; canvas.height = 1;
    return out;
  } catch (err: any) {
    out.ok = false;
    out.error = `${err?.name ?? 'Error'}: ${String(err?.message ?? err)}`;
    return out;
  } finally {
    try { libraw.dispose(); } catch {}
  }
}

(window as any).__poc = {
  capabilities,
  runFile,
  runLibRaw,
  runColorContract,
  probeFailure,
  repeatOpenDecode,
  runCancelProbe,
  probeUnsupported,
  contractVersion: IMAGING_CONTRACT_VERSION,
  ready: ensureInit().then(() => true, (e) => { throw e; }),
};
