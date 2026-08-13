#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'config/chaintracks-checkpoint.json');
const outputDir = resolve(root, process.env.CHAINTRACKS_CHECKPOINT_OUTPUT || 'public/chaintracks');
const verifyManifestOnly = process.argv.includes('--verify-manifest-only');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.chain !== 'main' || !Array.isArray(manifest.files)) {
  throw new Error('Unsupported ChainTracks checkpoint manifest.');
}

let nextHeight = 0;
for (const file of manifest.files) {
  if (
    basename(file.fileName) !== file.fileName ||
    file.firstHeight !== nextHeight ||
    !Number.isSafeInteger(file.count) ||
    file.count < 1 ||
    typeof file.sha256Base64 !== 'string'
  ) {
    throw new Error(`Invalid checkpoint entry: ${JSON.stringify(file)}`);
  }
  nextHeight += file.count;
}
if (nextHeight - 1 !== manifest.checkpointHeight) {
  throw new Error(`Checkpoint ends at ${nextHeight - 1}, expected ${manifest.checkpointHeight}.`);
}
if (verifyManifestOnly) {
  console.log(`Verified checkpoint manifest through height ${manifest.checkpointHeight}.`);
  process.exit(0);
}
await mkdir(outputDir, { recursive: true });

const digestFile = async (path) => {
  const bytes = await readFile(path);
  return {
    bytes,
    digest: createHash('sha256').update(bytes).digest('base64'),
  };
};

for (const file of manifest.files) {
  const target = resolve(outputDir, file.fileName);
  const expectedBytes = file.count * 80;
  let valid = false;
  try {
    const existing = await stat(target);
    if (existing.size === expectedBytes) {
      valid = (await digestFile(target)).digest === file.sha256Base64;
    }
  } catch {
    valid = false;
  }
  if (valid) continue;

  const source = `${manifest.sourceUrl.replace(/\/$/, '')}/${encodeURIComponent(file.fileName)}`;
  const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Checkpoint download failed (${response.status}) for ${source}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('base64');
  if (bytes.byteLength !== expectedBytes || digest !== file.sha256Base64) {
    throw new Error(`Checkpoint validation failed for ${file.fileName}.`);
  }

  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, target).catch(async (error) => {
    await unlink(temporary).catch(() => {});
    throw error;
  });
  console.log(`Materialized ${file.fileName} (${bytes.byteLength} bytes).`);
}

await writeFile(
  resolve(outputDir, 'checkpoint.json'),
  JSON.stringify({ ...manifest, sourceUrl: undefined }, null, 2) + '\n'
);
console.log(`Checkpoint ready through height ${manifest.checkpointHeight}.`);
