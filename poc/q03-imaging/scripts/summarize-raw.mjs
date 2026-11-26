import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'raw');

const summary = JSON.parse(await readFile(path.join(OUT, 'summary.json'), 'utf8'));
const caps = JSON.parse(await readFile(path.join(OUT, 'capabilities.json'), 'utf8'));
const unsupported = JSON.parse(await readFile(path.join(OUT, 'unsupported_probe.json'), 'utf8'));

const fmt = (v, d = 1) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Number(v.toFixed(d)));
  return String(v);
};
const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(2)}%`);

const lines = [];
const add = (s = '') => lines.push(s);

add('# Q03 RAW PoC — generated result tables');
add();
add('## Environment');
add();
add('| 항목 | 값 |');
add('|---|---|');
add(`| Browser | ${caps.userAgent} |`);
add(`| flashraw | ${caps.build.version} (simd=${caps.build.simd}, threads=${caps.build.threads}, binary=${caps.build.binary}) |`);
add(`| threads reason | ${caps.build.threadsReason ?? '—'} |`);
add(`| crossOriginIsolated / SharedArrayBuffer | ${caps.crossOriginIsolated} / ${caps.sharedArrayBuffer} |`);
add(`| WebGL2 / maxTexture | ${caps.webgl2} / ${caps.webgl2MaxTexture} |`);
add(`| hardwareConcurrency | ${caps.hardwareConcurrency} |`);
add(`| JS heap limit | ${caps.heapLimitMB} MB |`);
add();
add('## Non-RAW input honesty probe');
add();
add('```json');
add(JSON.stringify(unsupported, null, 2));
add('```');
add();
add('## Full-frame decode matrix (median of 3 for linear f32 / rgba8, single run otherwise)');
add();
add('| File | Format | Sensor layout | CFA | Output px | Input MB | raw-u16 ms | normalized ms | linear f32 ms (out MB) | linear f16 ms | linear-rgb16 ms | rgba8 ms (out MB) | display rgb16 ms | region 1200×800 ms | Backend | Warnings |');
add('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summary) {
  add(`| ${s.key} | ${s.format} | ${s.layout ?? '—'} | ${s.cfa ?? '—'} | ${s.width}×${s.height} | ${fmt(s.inputMB)} | ${fmt(s.rawU16?.wallMs)} | ${fmt(s.normalized?.wallMs)} | ${fmt(s.linearF32?.wallMs)} (${fmt(s.linearF32?.outputMB)}) | ${fmt(s.linearF16?.wallMs)} | ${fmt(s.linear16?.wallMs)} | ${fmt(s.rgba8?.wallMs)} (${fmt(s.rgba8?.outputMB)}) | ${fmt(s.rgb16?.wallMs)} | ${fmt(s.region?.wallMs)} | ${s.backend ?? '—'} | ${(s.warnings ?? []).length} |`);
}
add();
add('## Precision vs f32');
add();
add('| File | f32 output MB | f16 output MB | f16 MAE | f16 maxAbs | f16 >0.01 px | f16 >0.05 px | f16 sRGB8 differing px | f16 mean code diff | linear-rgb16 MAE | linear-rgb16 maxAbs | linear-rgb16 >0.01 px | linear-rgb16 >0.05 px | linear-rgb16 sRGB8 differing px | linear-rgb16 max code diff |');
add('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summary) {
  const pq = s.precision;
  add(`| ${s.key} | ${fmt(pq?.f32MB)} | ${fmt(pq?.f16MB)} | ${fmt(pq?.f16?.mae, 6)} | ${fmt(pq?.f16?.maxAbs, 6)} | ${fmt(pq?.f16?.over001, 0)} | ${fmt(pq?.f16?.over005, 0)} | ${pct(pq?.f16?.differingFrac)} | ${fmt(pq?.f16?.meanAbsCode)} | ${fmt(pq?.lin16?.mae, 6)} | ${fmt(pq?.lin16?.maxAbs, 6)} | ${fmt(pq?.lin16?.over001, 0)} | ${fmt(pq?.lin16?.over005, 0)} | ${pct(pq?.lin16?.differingFrac)} | ${fmt(pq?.lin16?.maxCode, 0)} |`);
}
add();
add('## Demosaic variants (linear-rgb f32, diff vs `auto`)');
add();
add('| File | bilinear ms | half-size ms | edge-aware ms | ahd ms | ppg ms | rcd ms | edge-aware differing px | edge-aware mean code Δ | ahd differing px | ahd mean code Δ | bilinear vs auto | notes |');
add('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of summary) {
  const d = s.demosaic ?? {};
  add(`| ${s.key} | ${fmt(d.bilinear?.wallMs)} | ${fmt(d['half-size']?.wallMs)} | ${fmt(d['edge-aware']?.wallMs)} | ${fmt(d.ahd?.wallMs)} | ${fmt(d.ppg?.wallMs)} | ${fmt(d.rcd?.wallMs)} | ${pct(d['edge-aware']?.diffVsAuto?.differingFrac)} | ${fmt(d['edge-aware']?.diffVsAuto?.meanAbsCode)} | ${pct(d.ahd?.diffVsAuto?.differingFrac)} | ${fmt(d.ahd?.diffVsAuto?.meanAbsCode)} | ${d.bilinear?.diffVsAuto ? (d.bilinear.diffVsAuto.differingFrac === 0 ? 'identical' : 'differs') : '—'} | ${[d['edge-aware']?.note, d.ahd?.note, d.ppg?.note, d.rcd?.note].filter(Boolean).join('; ') || ''} |`);
}
add();
add('## Highlight recovery (linear-rgb f32, diff vs `clip`)');
add();
add('| File | neutral ms | blend ms | reconstruct ms | clip max linear | clipped px | neutral differing px | blend differing px | reconstruct differing px |');
add('|---|---|---|---|---|---|---|---|---|');
for (const s of summary) {
  const h = s.highlights ?? {};
  add(`| ${s.key} | ${fmt(h.neutral?.wallMs)} | ${fmt(h.blend?.wallMs)} | ${fmt(h.reconstruct?.wallMs)} | ${fmt(s.clipMaxLinear, 4)} | ${fmt(s.clippedPixels, 0)} | ${pct(h.neutral?.diffVsClip?.differingFrac)} | ${pct(h.blend?.diffVsClip?.differingFrac)} | ${pct(h.reconstruct?.diffVsClip?.differingFrac)} |`);
}
add();
add('## White balance variants (linear-rgb f32, mean linear RGB)');
add();
add('| File | as-shot ms | daylight ms | auto ms | as-shot mean RGB | daylight mean RGB | auto mean RGB | daylight differing px | auto differing px |');
add('|---|---|---|---|---|---|---|---|---|');
for (const s of summary) {
  const w = s.whiteBalance ?? {};
  const m = (v) => (Array.isArray(v) ? v.map((x) => x.toFixed(3)).join(', ') : '—');
  add(`| ${s.key} | ${fmt(w['as-shot']?.wallMs)} | ${fmt(w.daylight?.wallMs)} | ${fmt(w.auto?.wallMs)} | ${m(w['as-shot']?.meanLinearRGB)} | ${m(w.daylight?.meanLinearRGB)} | ${m(w.auto?.meanLinearRGB)} | ${pct(w.daylight?.diffVsAsShot?.differingFrac)} | ${pct(w.auto?.diffVsAsShot?.differingFrac)} |`);
}
add();
add('## LibRaw-Wasm reference decode (LibRaw defaults: camera WB, sRGB, 8-bit)');
add();
add('| File | flashraw rgba8 ms | LibRaw open ms | LibRaw imageData ms | LibRaw px | Bits | Result |');
add('|---|---|---|---|---|---|---|');
for (const s of summary) {
  const l = s.libraw ?? {};
  add(`| ${s.key} | ${fmt(s.rgba8?.wallMs)} | ${fmt(l.openMs)} | ${fmt(l.imageMs)} | ${l.width ? `${l.width}×${l.height}` : '—'} | ${l.bits ?? '—'} | ${l.ok ? 'ok' : l.error ?? '—'} |`);
}
add();
add('## Warnings / source integrity');
add();
for (const s of summary) {
  add(`- **${s.key}**: incomplete=${s.incomplete}, source=${s.source}, warnings=${JSON.stringify(s.warnings)}`);
}
add();
add('Generated from results/raw/*.json by scripts/summarize-raw.mjs');
add();
await writeFile(path.join(OUT, 'TABLE.md'), lines.join('\n'));
console.log('wrote', path.join(OUT, 'TABLE.md'));
