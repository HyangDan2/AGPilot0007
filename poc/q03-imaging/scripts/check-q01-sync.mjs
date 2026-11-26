#!/usr/bin/env node
// Verifies that src/shared/q01/imageBuffer.ts is still the byte-identical Q01 contract
// mirror. The expected digest is the one recorded in src/shared/q01/SOURCE.md; a sibling
// Q01 worktree is compared too when present (otherwise the remote half is SKIPPED).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localPath = join(here, '..', 'src', 'shared', 'q01', 'imageBuffer.ts');
const upstreamPath =
  process.env.Q01_CONTRACT_PATH ??
  join(here, '..', '..', '..', '..', 'AGPilot0007-phase1', 'src', 'engine', 'contracts', 'imageBuffer.ts');
const expected = 'b986313c9bf4cd79fae35e1b19cf4d987e65a0ea136c95aa03a3ba0a82294c4b';

const digest = (buf) => createHash('sha256').update(buf).digest('hex');

const local = digest(await readFile(localPath));
if (local !== expected) {
  console.error(`FAIL mirror drift: ${localPath}\n  expected ${expected}\n  actual   ${local}`);
  process.exit(1);
}
console.log(`OK mirror ${local}`);

try {
  const upstream = digest(await readFile(upstreamPath));
  if (upstream !== local) {
    console.error(`FAIL upstream drift: ${upstreamPath}\n  mirror   ${local}\n  upstream ${upstream}`);
    process.exit(1);
  }
  console.log(`OK upstream ${upstreamPath}`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  console.log(`SKIPPED upstream (${upstreamPath} not present); mirror matches recorded digest`);
}
