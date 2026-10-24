import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('offline glyph bundle covers every normalized canonical label and verifies its licensed inputs', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/fonts/manifest.json'), 'utf8'));
  assert.equal(manifest.fontstack, 'Noto Sans Regular');
  assert.equal(manifest.generatedBy, 'MapLibre font-maker WASM');
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(manifest.generatorCommit, /^[0-9a-f]{40}$/);
  const generatorLicense = await readFile(path.join(root, manifest.generatorLicense), 'utf8');
  assert.match(generatorLicense, /Redistribution and use in source and binary forms/);
  for (const [name, expected] of Object.entries(manifest.generatorHashes)) {
    const bytes = await readFile(path.join(root, 'scripts/vendor/maplibre-font-maker', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
  const fontNames = new Set(manifest.sources.map(({ name }) => name));
  assert.deepEqual(fontNames, new Set(['Noto Sans Regular', 'Noto Sans Tamil Regular', 'Noto Sans Sinhala Regular']));
  const ranges = new Set(manifest.ranges);
  const shards = (await readdir(path.join(root, 'data/canonical'))).filter((name) => /^records-.*\.jsonl\.gz$/.test(name));
  let labels = 0;
  for (const shard of shards) {
    const contents = gunzipSync(await readFile(path.join(root, 'data/canonical', shard))).toString('utf8');
    for (const line of contents.split('\n')) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (record.status !== 'active') continue;
      const props = record.properties ?? {};
      const label = props['@name'] ?? props.names?.primary;
      if (typeof label !== 'string' || !label) continue;
      labels += 1;
      for (const char of label.normalize('NFKC')) {
        const cp = char.codePointAt(0);
        if (cp <= 0xffff) {
          const start = Math.floor(cp / 256) * 256;
          assert.ok(ranges.has(`${start}-${start + 255}`), `missing glyph range for U+${cp.toString(16)}`);
        }
      }
    }
  }
  assert.equal(labels, manifest.labelCount);
  for (const source of manifest.sources) {
    const bytes = await readFile(path.join(root, source.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    const license = await readFile(path.join(root, source.license), 'utf8');
    assert.match(license, /SIL OPEN FONT LICENSE/i);
  }
  for (const item of manifest.files) {
    const bytes = await readFile(path.join(root, item.file));
    assert.equal(bytes.length, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    assert.ok(bytes.length > 1000, `${item.file} contains encoded glyphs`);
  }
});
