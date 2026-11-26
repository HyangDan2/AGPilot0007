import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'raw');

const KEYS = [
  'cr3_canon_r6m3',
  'cr2_canon_1000d',
  'raf_fuji_xt4',
  'nef_nikon_z6',
  'arw_sony_a7m3',
  'orf_olympus_em10',
  'dng_ricoh_gr3',
];

const num = (v, d = 2) => (typeof v === 'number' ? Number(v.toFixed(d)) : null);
const brief = (c) => (c ? { differingFrac: c.display8?.differingFrac ?? null, meanAbsCode: c.display8?.meanAbsCode ?? null, maxCode: c.display8?.maxCode ?? null } : null);

const summary = [];
for (const key of KEYS) {
  let r;
  try {
    r = JSON.parse(await readFile(path.join(OUT, `${key}.json`), 'utf8'));
  } catch {
    console.warn(`missing ${key}.json — skipped`);
    continue;
  }
  const d = r.decode ?? {};
  const p = r.precision ?? {};
  const demosaic = {};
  for (const [k, v] of Object.entries(r.demosaic ?? {})) {
    demosaic[k] = v.ok
      ? { wallMs: v.wallMsMedian, totalMs: v.totalMs, diffVsAuto: brief(v.diffVsAuto), note: v.note ?? null }
      : { error: v.error?.message };
  }
  const highlights = {};
  for (const [k, v] of Object.entries(r.highlights ?? {})) {
    highlights[k] = v.ok
      ? { wallMs: v.wallMsMedian, totalMs: v.totalMs, diffVsClip: brief(v.diffVsClip) }
      : { error: v.error?.message };
  }
  const whiteBalance = {};
  for (const [k, v] of Object.entries(r.whiteBalance ?? {})) {
    whiteBalance[k] = v.ok
      ? { wallMs: v.wallMsMedian, meanLinearRGB: v.meanLinearRGB, diffVsAsShot: brief(v.diffVsAsShot) }
      : { error: v.error?.message };
  }
  summary.push({
    key,
    format: r.format,
    detectFormat: r.detectFormat,
    supportsFile: r.supportsFile,
    layout: d.raw_u16?.summary?.layout ?? null,
    cfa: d.raw_u16?.summary?.cfa?.pattern ?? null,
    cfaObject: d.raw_u16?.summary?.cfa ?? null,
    blackLevel: d.raw_u16?.summary?.blackLevel ?? null,
    whiteLevel: d.raw_u16?.summary?.whiteLevel ?? null,
    whiteBalanceMultipliers: d.raw_u16?.summary?.whiteBalance ?? null,
    width: d.rgba8?.summary?.width ?? null,
    height: d.rgba8?.summary?.height ?? null,
    bitsPerSample: d.raw_u16?.summary?.bitsPerSample ?? null,
    inputMB: num(r.fileBytes / 1048576, 1),
    rawU16: { wallMs: d.raw_u16?.wallMsMedian, totalMs: d.raw_u16?.totalMs, outputMB: num(d.raw_u16?.outputMB ?? null, 1), peakHeapDeltaMB: d.raw_u16?.peakHeapDeltaMB ?? null },
    normalized: { wallMs: d.normalized?.wallMsMedian, totalMs: d.normalized?.totalMs, outputMB: num(d.normalized?.outputMB ?? null, 1) },
    linearF32: { wallMs: d.linear_rgb_f32?.wallMsMedian, totalMs: d.linear_rgb_f32?.totalMs, outputMB: num(d.linear_rgb_f32?.outputMB ?? null, 1), peakHeapDeltaMB: d.linear_rgb_f32?.peakHeapDeltaMB ?? null, meanLinearRGB: d.linear_rgb_f32?.meanLinearRGB ?? null },
    linearF16: { wallMs: d.linear_rgb_f16?.wallMsMedian, totalMs: d.linear_rgb_f16?.totalMs, outputMB: num(d.linear_rgb_f16?.outputMB ?? null, 1) },
    linear16: { wallMs: d.linear_rgb16?.wallMsMedian, totalMs: d.linear_rgb16?.totalMs, outputMB: num(d.linear_rgb16?.outputMB ?? null, 1) },
    rgba8: { wallMs: d.rgba8?.wallMsMedian, totalMs: d.rgba8?.totalMs, outputMB: num(d.rgba8?.outputMB ?? null, 1), peakHeapDeltaMB: d.rgba8?.peakHeapDeltaMB ?? null },
    rgb16: { wallMs: d.rgb16?.wallMsMedian, totalMs: d.rgb16?.totalMs, outputMB: num(d.rgb16?.outputMB ?? null, 1) },
    precision: p.f16VsF32
      ? {
          f32MB: num(p.f32Bytes / 1048576, 1),
          f16MB: num(p.f16Bytes / 1048576, 1),
          lin16MB: p.linearRgb16Bytes ? num(p.linearRgb16Bytes / 1048576, 1) : null,
          f16: { mae: p.f16VsF32.mae, maxAbs: p.f16VsF32.maxAbs, over001: p.f16VsF32.over001, over005: p.f16VsF32.over005, ...brief(p.f16VsF32) },
          lin16: p.linearRgb16VsF32 ? { mae: p.linearRgb16VsF32.mae, maxAbs: p.linearRgb16VsF32.maxAbs, over001: p.linearRgb16VsF32.over001, over005: p.linearRgb16VsF32.over005, ...brief(p.linearRgb16VsF32) } : null,
        }
      : null,
    clipMaxLinear: d.linear_rgb_f32?.linearStats?.max ?? null,
    clippedPixels: d.linear_rgb_f32?.linearStats?.clippedGreatherThan1 ?? null,
    demosaic,
    highlights,
    whiteBalance,
    region: r.region,
    libraw: r.libraw ? { ok: r.libraw.ok, openMs: r.libraw.openMs, imageMs: r.libraw.imageMs, width: r.libraw.width, height: r.libraw.height, bits: r.libraw.bits, colors: r.libraw.colors, error: r.libraw.error ?? null } : null,
    previewDescriptor: r.previewDescriptor ?? null,
    images: r.images ?? {},
    warnings: d.rgba8?.summary?.warnings ?? [],
    incomplete: d.rgba8?.summary?.incomplete ?? null,
    source: d.rgba8?.summary?.source ?? null,
    backend: d.rgba8?.summary?.backend?.decode ?? null,
    totalWallSeconds: r.totalWallSeconds,
    rawJson: `${key}.json`,
  });
}
await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`wrote summary.json for ${summary.length} files`);
