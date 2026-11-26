#!/usr/bin/env node
// Verifies that src/shared/q01/imageBuffer.ts is still the byte-identical Q01 contract
// mirror. The expected digest is the one recorded in src/shared/q01/SOURCE.md.
// Upstream candidates, in order: Q01_CONTRACT_PATH (explicit override), then this
// repo's merged src/engine/contracts/imageBuffer.ts. No sibling-checkout paths are
// assumed, so the check runs in CI and on any Q05 clone.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localPath = join(here, '..', 'src', 'shared', 'q01', 'imageBuffer.ts');
const repoRoot = join(here, '..', '..', '..');
const candidates = [
  process.env.Q01_CONTRACT_PATH,
  join(repoRoot, 'src', 'engine', 'contracts', 'imageBuffer.ts'),
].filter(Boolean);
const expected = 'b986313c9bf4cd79fae35e1b19cf4d987e65a0ea136c95aa03a3ba0a82294c4b';

const digest = (buf) => createHash('sha256').update(buf).digest('hex');

const local = digest(await readFile(localPath));
if (local !== expected) {
  console.error(`FAIL mirror drift: ${localPath}\n  expected ${expected}\n  actual   ${local}`);
  process.exit(1);
}
console.log(`OK mirror ${local}`);

let compared = 0;
for (const candidate of candidates) {
  try {
    const upstream = digest(await readFile(candidate));
    compared++;
    if (upstream !== local) {
      console.error(`FAIL upstream drift: ${candidate}\n  mirror   ${local}\n  upstream ${upstream}`);
      process.exit(1);
    }
    console.log(`OK upstream ${candidate}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    console.log(`SKIPPED upstream (${candidate} not present)`);
  }
}
if (compared === 0) {
  console.log('SKIPPED upstream comparison; mirror matches recorded digest');
}
