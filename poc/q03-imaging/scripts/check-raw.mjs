import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'results', 'raw');
const EXPECTED_KEYS = ['cr3_canon_r6m3', 'cr2_canon_1000d', 'raf_fuji_xt4', 'nef_nikon_z6', 'arw_sony_a7m3', 'orf_olympus_em10', 'dng_ricoh_gr3'];
const VARIANT_LABELS = ['exposure+1', 'exposure+2', 'whiteBalance-daylight', 'highlights-blend'];

const checks = [];
function check(name, pass, actual) {
  checks.push({ name, pass: !!pass, actual });
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(OUT, name), 'utf8'));
}

function errorName(probe) {
  return probe?.error?.name ?? probe?.open?.error?.split(':')[0] ?? null;
}

for (const key of EXPECTED_KEYS) {
  const file = await readJson(`${key}.json`);
  const contract = await readJson(`color_contract_${key}.json`);
  check(`${key}: detected format`, !!file.detectFormat, file.detectFormat);
  check(`${key}: color contract accepted`, file.colorContract?.accepted === true && contract.ok === true, { accepted: file.colorContract?.accepted, contract: contract.ok });
  check(`${key}: scene-linear f32 buffer contract`, file.colorContract?.buffer?.channels === 3 && file.colorContract?.buffer?.dataType === 'f32' && file.colorContract?.buffer?.transfer === 'linear', file.colorContract?.buffer);
  check(`${key}: sRGB bridge within 2 codes of decoder`, contract.sdrBridge?.bridgeVsDecoder?.maxCode !== null && contract.sdrBridge?.bridgeVsDecoder?.maxCode <= 2, contract.sdrBridge?.bridgeVsDecoder?.maxCode);
  check(`${key}: orientation applied + sensor source`, contract.resolutionCheck?.orientationApplied === true && contract.resolutionCheck?.sourceIsSensor === true, contract.resolutionCheck);
  check(`${key}: WB applied before camera matrix`, contract.whiteBalanceOrder?.preMatrix === true, { preMatrix: contract.whiteBalanceOrder?.preMatrix, evidence: contract.whiteBalanceOrder?.orderEvidence, best: contract.whiteBalanceOrder?.bestModel });
  check(`${key}: no early clipping of linear values`, contract.exposure ? contract.exposure.plus2EV?.preservesOverOne === true && contract.exposure.plus2EV?.clippedAtOneFrac < 1e-3 : true, contract.exposure?.plus2EV ?? null);
  const prec = file.precisionAfterAdjustments ?? {};
  for (const label of VARIANT_LABELS) {
    check(`${key}: f16 vs f32 after ${label}`, !!prec[label] && !prec[label].error && prec[label].full?.samples > 0, prec[label]?.full ?? prec[label]?.error);
  }
  check(`${key}: f16 display-8 diff after adjustments is small`, VARIANT_LABELS.every((l) => (prec[l]?.full?.display8?.meanAbsCode ?? 0) <= 1), VARIANT_LABELS.map((l) => prec[l]?.full?.display8?.meanAbsCode ?? null));
  if (file.colorContract?.resolution?.displayWidth >= 6000) {
    check(`${key}: >=24MP memory measured`, typeof file.decode?.linear_rgb_f32?.peakHeapDeltaMB === 'number' && typeof file.decode?.rgba8?.peakHeapDeltaMB === 'number', { linear: file.decode?.linear_rgb_f32?.peakHeapDeltaMB, rgba8: file.decode?.rgba8?.peakHeapDeltaMB });
  }
}

const robustness = await readJson('robustness.json');
const robust = Object.fromEntries(robustness.map((r) => [r.label, r]));
const expectError = {
  'jpeg-as-raw': 'UnsupportedFormatError',
  'random-bytes': 'UnsupportedFormatError',
  'truncated-cr3-strict': 'CorruptFileError',
  'truncated-raf-strict': 'CorruptFileError',
  'max-dimension-limit': 'LimitExceededError',
  'max-samples-limit': 'LimitExceededError',
};
for (const [label, name] of Object.entries(expectError)) {
  check(`robustness ${label}: ${name}`, errorName(robust[label]) === name, robust[label]?.error ?? robust[label]?.open);
}
for (const label of ['truncated-cr3-recover', 'truncated-raf-recover', 'truncated-dng-strict', 'truncated-dng-recover']) {
  const r = robust[label];
  check(`robustness ${label}: decoded or rejected with CorruptFileError`, !!r && (r.decoded === true || errorName(r) === 'CorruptFileError'), r?.error ?? { decoded: r?.decoded });
}
for (const r of robustness) {
  check(`robustness ${r.label}: file handle released`, r.released !== false, r.released);
}

const release = await readJson('release.json');
for (const entry of release.filter((r) => r.iterations)) {
  check(`release ${entry.key}: no heap growth across repeats (<=16MB, gc-aware)`, entry.settledGrowthMB === null || entry.settledGrowthMB <= 16, { settledGrowthMB: entry.settledGrowthMB, series: entry.series });
  check(`release ${entry.key}: all frames/files closed`, entry.allClosed === true, entry.allClosed);
}
for (const entry of release.filter((r) => r.cancelled !== undefined)) {
  check(`release ${entry.key}: cancel fires and resources are released`, entry.cancelled === true && entry.released === true, entry);
}

const failures = checks.filter((c) => !c.pass);
await writeFile(path.join(OUT, 'assertions.json'), JSON.stringify({ pass: failures.length === 0, total: checks.length, failures, checks }, null, 2));
console.log(`RAW assertions: ${checks.length - failures.length}/${checks.length} passed`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
