import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'video');

const caps = JSON.parse(await readFile(path.join(OUT, 'capabilities.json'), 'utf8'));
const analysis = JSON.parse(await readFile(path.join(OUT, 'analysis.json'), 'utf8'));
const bench = JSON.parse(await readFile(path.join(OUT, 'bench.json'), 'utf8'));
const transcode = JSON.parse(await readFile(path.join(OUT, 'transcode.json'), 'utf8'));

const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : typeof v === 'number' ? String(Number(v.toFixed(d))) : String(v));
const mark = (ok) => (ok ? '✅' : '❌');

const L = [];
const add = (s = '') => L.push(s);

add('# Q03 Video PoC — generated result tables');
add();
add('## Environment');
add();
add('| 항목 | 값 |');
add('|---|---|');
add(`| Browser | ${caps.userAgent} |`);
add(`| WebCodecs APIs | ${Object.entries(caps.apis).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(', ')} |`);
add(`| hardwareConcurrency | ${caps.hardwareConcurrency} |`);
add(`| JS heap limit | ${caps.heapLimitMB} MB |`);
add(`| WebGL2 / renderer | ${caps.webgl2} / ${caps.webgl2Renderer ?? '—'} |`);
add(`| mediabunny encodable video | ${JSON.stringify(caps.mediabunny.encodableVideo)} |`);
add(`| mediabunny encodable audio | ${JSON.stringify(caps.mediabunny.encodableAudio)} |`);
add();
add('## WebCodecs capability probes');
add();
for (const kind of ['videoDecode', 'audioDecode', 'videoEncode', 'audioEncode']) {
  add(`### ${kind}`);
  add();
  add('| codec | supported | notes |');
  add('|---|---|---|');
  for (const p of caps.probes[kind]) add(`| ${p.codec} | ${p.supported ? 'yes' : 'no'} | ${p.error ?? ''} |`);
  add();
}
add('## Input analysis');
add();
add('| File | Container | Duration s | Video codec | Codec string | canDecode | coded px | display px | rotation | VFR | fps | pkts | Audio codec | Audio canDecode |');
add('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const a of analysis) {
  const v = a.video;
  add(`| ${a.key} | ${a.format?.name ?? a.error ?? '—'} | ${fmt(a.duration)} | ${v?.codec ?? '—'} | ${v?.codecString ?? '—'} | ${mark(v?.canDecode)} | ${v ? `${v.codedWidth}×${v.codedHeight}` : '—'} | ${v ? `${v.displayWidth}×${v.displayHeight}` : '—'} | ${fmt(v?.rotation, 0)} | ${v?.timing ? (v.timing.variableFrameRate ? 'yes' : 'no') : '—'} | ${fmt(v?.packetStats?.averagePacketRate)} | ${fmt(v?.packetStats?.packetCount, 0)} | ${a.audio?.codec ?? '—'} | ${a.audio ? mark(a.audio.canDecode) : '—'} |`);
}
add();
add('## Decode / grade benchmarks (all frames, no encode)');
add();
add('| File | mode | ok | frames | fps | wall ms | per-frame median ms | p95 ms | max ms | peak heap Δ MB |');
add('|---|---|---|---|---|---|---|---|---|---|');
for (const b of bench) {
  add(`| ${b.key} | ${b.mode} | ${mark(b.ok)} | ${fmt(b.frames, 0)} | ${fmt(b.fps)} | ${fmt(b.wallMs, 0)} | ${fmt(b.perFrameMs?.median)} | ${fmt(b.perFrameMs?.p95)} | ${fmt(b.perFrameMs?.max)} | ${fmt(b.peakHeapDeltaMB)} |`);
}
add();
const checkActual = (t, prefix) => {
  const c = (t.outputVerification?.checks ?? []).find((x) => x.name.startsWith(prefix));
  return c ? (c.pass === false ? `❌ ${c.actual}` : c.actual) : '—';
};
const verifySummary = (t) => {
  const checks = t.outputVerification?.checks ?? [];
  if (!checks.length) return '—';
  return `${checks.filter((c) => c.pass !== false).length}/${checks.length} ${t.outputVerification?.ok ? '✅' : '❌'}`;
};
const snapSummary = (t) => {
  const s = t.snapshotVerification;
  if (!s) return '—';
  return `${s.sameFrameVerified ? 'same' : 'diff'}/${s.gradingApplied ? 'graded' : 'raw'} ${s.gradedDiffFromIndependentDecode ?? '—'}`;
};

add('## LUT transcode + mux (streaming target, no Base64)');
add();
add('| File | ok | codec | codec string | frames | fps | wall ms | peak heap Δ MB | audio pkts copied | output bytes | duration s | A/V start ms | A/V end ms | out video pkts | verify | snapshot | base64 |');
add('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of transcode) {
  add(`| ${t.key} | ${mark(t.ok)} | ${t.videoCodec ?? '—'} | ${t.encoder?.codecString ?? '—'} | ${fmt(t.frames, 0)} | ${fmt(t.timing?.fps)} | ${fmt(t.timing?.wallMs, 0)} | ${fmt(t.peakHeapDeltaMB)} | ${fmt(t.audioPacketsCopied, 0)} | ${fmt(t.output?.bytes, 0)} | ${fmt(t.output?.duration)} | ${checkActual(t, 'A/V start')} | ${checkActual(t, 'A/V end')} | ${checkActual(t, 'video packet count')} | ${verifySummary(t)} | ${snapSummary(t)} | ${t.outputBase64 ?? '—'} |`);
}
add();

const budgetPath = path.join(OUT, 'budget_probes.json');
try {
  const budget = JSON.parse(await readFile(budgetPath, 'utf8'));
  add('## Output target / memory budget probes');
  add();
  add('| probe | ok | mode | estimate MB | budget MB | chunks | result | peak heap Δ MB |');
  add('|---|---|---|---|---|---|---|---|');
  for (const b of budget) {
    add(`| ${b.probe} | ${mark(b.ok)} | ${b.targetInfo?.mode ?? '—'} | ${fmt(b.targetInfo?.estimateMB)} | ${fmt(b.targetInfo?.budgetMB, 0)} | ${fmt(b.targetInfo?.chunks, 0)} | ${b.error ?? (b.assertions?.pass ? 'output verified' : '—')} | ${fmt(b.peakHeapDeltaMB)} |`);
  }
  add();
} catch {}

const cancelPath = path.join(OUT, 'cancel.json');
try {
  const cancel = JSON.parse(await readFile(cancelPath, 'utf8'));
  add('## Cancel / rerun');
  add();
  add('| probe | aborted | ok | frames | verification | error | peak heap Δ MB |');
  add('|---|---|---|---|---|---|---|');
  for (const c of cancel) {
    const checks = c.verification?.checks ?? [];
    add(`| ${c.probe} | ${c.aborted ? 'yes' : 'no'} | ${mark(c.ok)} | ${fmt(c.frames, 0)} | ${checks.length ? `${checks.filter((x) => x.pass !== false).length}/${checks.length} ${c.verification?.pass ? '✅' : '❌'}` : '—'} | ${c.error ?? '—'} | ${fmt(c.peakHeapDeltaMB)} |`);
  }
  add();
} catch {}

const longPath = path.join(OUT, 'long_export.json');
try {
  const long = JSON.parse(await readFile(longPath, 'utf8'));
  add('## Long export (45 s)');
  add();
  add('| frames | wall ms | fps | per-frame median/p95/max ms | heap slope MB/min | peak heap Δ MB | output bytes | verification |');
  add('|---|---|---|---|---|---|---|---|');
  const pf = long.timing?.perFrameMs ?? {};
  const checks = long.verification?.checks ?? [];
  add(`| ${fmt(long.frames, 0)} | ${fmt(long.timing?.wallMs, 0)} | ${fmt(long.timing?.fps)} | ${fmt(pf.median)}/${fmt(pf.p95)}/${fmt(pf.max)} | ${fmt(long.heapSlopeMBPerMinute)} | ${fmt(long.peakHeapDeltaMB)} | ${fmt(long.output?.bytes, 0)} | ${checks.length ? `${checks.filter((x) => x.pass !== false).length}/${checks.length} ${long.verification?.pass ? '✅' : '❌'}` : '—'} |`);
  add();
} catch {}

const assertionsPath = path.join(OUT, 'assertions.json');
try {
  const a = JSON.parse(await readFile(assertionsPath, 'utf8'));
  add('## Automated assertions');
  add();
  add(a.pass ? '- **ALL PASSED**' : `- **FAILED** (${a.failures?.length ?? 0})`);
  for (const f of a.failures ?? []) add(`- ${f.name}: ${typeof f.detail === 'string' ? f.detail : JSON.stringify(f.detail)}`);
  add();
} catch {}
add('## Failures (expected unsupported cases are recorded, never faked)');
add();
for (const t of transcode) if (!t.ok) add(`- **${t.key}**: ${t.error}`);
for (const b of bench) if (!b.ok) add(`- bench **${b.key}**/${b.mode}: ${b.error}`);
add();
add('Generated from results/video/*.json by scripts/summarize-video.mjs');
add();
await writeFile(path.join(OUT, 'TABLE.md'), L.join('\n'));
console.log('wrote', path.join(OUT, 'TABLE.md'));
