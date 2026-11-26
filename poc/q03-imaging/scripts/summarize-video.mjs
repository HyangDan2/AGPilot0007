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
add('| File | Container | Duration s | Video codec | Codec string | canDecode | px | fps | pkts | Audio codec | Audio canDecode |');
add('|---|---|---|---|---|---|---|---|---|---|---|');
for (const a of analysis) {
  add(`| ${a.key} | ${a.format?.name ?? a.error ?? '—'} | ${fmt(a.duration)} | ${a.video?.codec ?? '—'} | ${a.video?.codecString ?? '—'} | ${mark(a.video?.canDecode)} | ${a.video ? `${a.video.displayWidth}×${a.video.displayHeight}` : '—'} | ${fmt(a.video?.packetStats?.averagePacketRate)} | ${fmt(a.video?.packetStats?.packetCount, 0)} | ${a.audio?.codec ?? '—'} | ${a.audio ? mark(a.audio.canDecode) : '—'} |`);
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
add('## LUT transcode + mux');
add();
add('| File | ok | codec | frames | fps | wall ms | per-frame median ms | p95 ms | encode await median ms | audio pkts copied | peak heap Δ MB | output | output bytes | duration s | A/V start offset ms | A/V end delta ms | out video pkts | out audio pkts |');
add('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of transcode) {
  add(`| ${t.key} | ${mark(t.ok)} | ${t.videoCodec ?? '—'} | ${fmt(t.frames, 0)} | ${fmt(t.timing?.fps)} | ${fmt(t.timing?.wallMs, 0)} | ${fmt(t.timing?.perFrameMs?.median)} | ${fmt(t.timing?.perFrameMs?.p95)} | ${fmt(t.timing?.encodeAwaitMs?.median)} | ${fmt(t.audioPacketsCopied, 0)} | ${fmt(t.peakHeapDeltaMB)} | ${t.outputSavedAs ?? '—'} | ${fmt(t.output?.bytes, 0)} | ${fmt(t.output?.duration)} | ${fmt(t.output?.avStartOffsetMs)} | ${fmt(t.output?.avEndDeltaMs)} | ${fmt(t.output?.outputVideoPacketCount, 0)} | ${fmt(t.output?.outputAudioPacketCount, 0)} |`);
}
add();
add('## Failures (expected unsupported cases are recorded, never faked)');
add();
for (const t of transcode) if (!t.ok) add(`- **${t.key}**: ${t.error}`);
for (const b of bench) if (!b.ok) add(`- bench **${b.key}**/${b.mode}: ${b.error}`);
add();
add('Generated from results/video/*.json by scripts/summarize-video.mjs');
add();
await writeFile(path.join(OUT, 'TABLE.md'), L.join('\n'));
console.log('wrote', path.join(OUT, 'TABLE.md'));
