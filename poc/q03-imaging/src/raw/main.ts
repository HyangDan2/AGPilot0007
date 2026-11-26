import { FlashRaw, init, detectFormat, supportsFile } from 'flashraw';

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

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * (f / 1024) * Math.pow(2, -14);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * Math.pow(2, e - 15);
}

const SRGB_ENCODE_LUT = (() => {
  const lut = new Float32Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const v = i / 4096;
    lut[i] = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  return lut;
})();

function srgb8(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v >= 1) return 255;
  const t = v * 4096;
  const i = t | 0;
  const f = t - i;
  const enc = SRGB_ENCODE_LUT[i] * (1 - f) + SRGB_ENCODE_LUT[Math.min(4096, i + 1)] * f;
  return Math.round(Math.max(0, Math.min(1, enc)) * 255);
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
      frame = await raw.decode(run.options);
      const dt = performance.now() - t0;
      wallTimes.push(Number(dt.toFixed(2)));
      if (i < reps - 1) {
        // release intermediate copies before the next rep
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

  // Region decode (interactive/preview path)
  try {
    log(`${key}: region decode`);
    const active = raw.frameInfo?.activeArea ?? raw.frameInfo?.crop;
    const regionW = 1200;
    const regionH = 800;
    const x0 = Math.max(0, Math.floor(((active?.x ?? 0) + (active?.width ?? raw.metadata.width)) / 2 - regionW / 2));
    const y0 = Math.max(0, Math.floor(((active?.y ?? 0) + (active?.height ?? raw.metadata.height)) / 2 - regionH / 2));
    const t0 = performance.now();
    const frame = await raw.decodeRegion({ x: x0, y: y0, width: regionW, height: regionH }, { output: 'rgba8' });
    const dt = performance.now() - t0;
    result.region = {
      ok: true,
      region: { x: x0, y: y0, w: frame.width, h: frame.height },
      wallMs: Number(dt.toFixed(2)),
      totalMs: frame.timings?.totalMs,
      outputMB: Number((frame.outputBytes / 1024 / 1024).toFixed(2)),
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
  probeUnsupported,
  ready: ensureInit().then(() => true, (e) => { throw e; }),
};
