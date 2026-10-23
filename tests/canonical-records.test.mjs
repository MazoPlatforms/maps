import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCanonicalRecord, prepareCanonicalEdit, prepareCanonicalDeletion } from '../assets/js/canonical-records.js';
const id = '6763e377-ecea-4bea-aef4-5ac6ad8a978b';
const record = { schemaVersion: 2, id, revision: 1, status: 'active', properties: { name: 'Fixture' } };
const body = new TextEncoder().encode(JSON.stringify(record));
const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const entry = { file: `api/features/${id.slice(0, 2)}/${id}.json`, sha256, revision: 1, status: 'active' };

test('editor loads exact canonical record and prepares optimistic offline edits and tombstones', async () => {
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url.href);
    return new Response(url.pathname.endsWith('/index.json') ? JSON.stringify({ [id]: entry }) : body);
  };
  const snapshot = await fetchCanonicalRecord('https://example.org/canonical/', id, fetcher);
  assert.deepEqual(snapshot.record, record);
  assert.deepEqual(prepareCanonicalEdit(snapshot, { properties: { name: 'Edited' } }),
    { id, expected: sha256, patch: { properties: { name: 'Edited' } } });
  assert.deepEqual(prepareCanonicalDeletion(snapshot), { id, expected: sha256, command: 'delete' });
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.startsWith('https://example.org/canonical/')));
  assert.throws(() => prepareCanonicalEdit(snapshot, { id: 'replace-id' }), /Only geometry/);
  assert.throws(() => prepareCanonicalDeletion({ record: { ...record, status: 'removed' } }), /Tombstones/);
});

test('editor rejects stale or altered records and unsafe API paths', async () => {
  for (const changed of [{ ...entry, sha256: '0'.repeat(64) }, { ...entry, revision: 2 },
    { ...entry, file: 'https://upstream.example/feature' }]) {
    await assert.rejects(fetchCanonicalRecord('https://example.org/canonical/', id, async (url) =>
      new Response(url.pathname.endsWith('/index.json') ? JSON.stringify({ [id]: changed }) : body)),
      /checksum|identity|unavailable/);
  }
  await assert.rejects(fetchCanonicalRecord('https://example.org/canonical/', '../escape'), /Invalid/);
});

test('canonical styles resolve archives under the dataset location', async () => {
  const { prepareCanonicalStyle } = await import('../assets/js/canonical-records.js');
  const file = `mazo.${'a'.repeat(64)}.pmtiles`;
  const style = { sources: { mazo: { type: 'vector', url: `pmtiles://${file}` } } };
  assert.equal(prepareCanonicalStyle(style, 'https://example.org/maps/canonical/').sources.mazo.url,
    `pmtiles://https://example.org/maps/canonical/${file}`);
  assert.equal(style.sources.mazo.url, `pmtiles://${file}`);
  assert.throws(() => prepareCanonicalStyle({ sources: { overture: {} } }, 'https://example.org/'), /canonical/);
});
