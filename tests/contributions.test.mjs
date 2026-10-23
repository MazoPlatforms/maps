import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  fetchContributions,
  prepareContributions,
} from '../assets/js/contributions.js';

const style = {
  version: 8,
  metadata: { 'mazo:theme': 'light' },
  sources: { places: { type: 'vector' } },
  layers: [
    {
      id: 'places',
      type: 'circle',
      source: 'places',
      'source-layer': 'place',
      filter: ['has', '@name'],
      paint: { 'circle-radius': 4 },
    },
  ],
};
const data = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'permanent-id',
      geometry: { type: 'Point', coordinates: [80, 7] },
      properties: { _mazoType: 'place', '@name': 'Changed' },
    },
  ],
};
const manifest = {
  schemaVersion: 1,
  release: '2026-10-21.0',
  basemap: { places: 'b'.repeat(64) },
  features: 1,
  suppressions: { places: { place: ['source-edit', 'source-delete'] } },
  attribution: ['<unsafe>'],
};

test('source suppression and replacement layers preserve both themes and the original style', () => {
  for (const theme of ['light', 'dark']) {
    const original = structuredClone(style);
    original.metadata['mazo:theme'] = theme;
    const prepared = prepareContributions(original, { manifest, data });
    assert.deepEqual(prepared.layers[0].filter, [
      'all',
      ['has', '@name'],
      [
        '!',
        ['in', ['get', 'id'], ['literal', ['source-edit', 'source-delete']]],
      ],
    ]);
    assert.equal(prepared.layers[1].source, 'contributions');
    assert.equal(prepared.layers[1]['source-layer'], undefined);
    assert.deepEqual(prepared.layers[1].filter, [
      'all',
      ['==', ['get', '_mazoType'], 'place'],
      ['has', '@name'],
    ]);
    assert.equal(prepared.sources.contributions.attribution, '&lt;unsafe&gt;');
    assert.deepEqual(original.layers, style.layers);
  }
});

test('empty contributions preserve the viewer and boundary features receive an outline', () => {
  assert.deepEqual(prepareContributions(style, null), style);
  const boundary = structuredClone(data);
  boundary.features[0].properties._mazoType = 'administrative_boundary';
  const result = prepareContributions(style, { manifest, data: boundary });
  assert.ok(
    result.layers.some(
      (l) => l.id === 'contribution-administrative-boundary-outline',
    ),
  );
});

test('contribution fetch checks content integrity, release and basemap identity', async () => {
  const body = Buffer.from(JSON.stringify(data));
  const sha256 = createHash('sha256').update(body).digest('hex');
  const m = {
    ...manifest,
    layer: { file: `features.${sha256}.geojson`, sha256, bytes: body.length },
  };
  const basemap = {
    release: m.release,
    archives: { places: { sha256: m.basemap.places } },
    sourceIdentity: { property: 'id', allZooms: true },
  };
  let tamper = false;
  const fetcher = async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes('contributions/manifest') ? m : basemap,
    arrayBuffer: async () =>
      Uint8Array.from(tamper ? Buffer.from('corrupt') : body).buffer,
  });
  assert.deepEqual(
    (await fetchContributions('https://example.org/maps/', fetcher)).data,
    data,
  );
  tamper = true;
  await assert.rejects(
    fetchContributions('https://example.org/maps/', fetcher),
    /checksum mismatch/,
  );
  tamper = false;
  basemap.release = 'changed';
  await assert.rejects(
    fetchContributions('https://example.org/maps/', fetcher),
    /another basemap/,
  );
});
