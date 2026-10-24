import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

function varint(value) {
  const result = [];
  while (value > 127) {
    result.push((value & 127) | 128);
    value = Math.floor(value / 128);
  }
  return Buffer.from([...result, value]);
}
function field(number, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}
function integer(number, value) {
  return Buffer.concat([varint(number * 8), varint(value)]);
}
const sourceIds = ['source-keep', 'source-edit', 'source-delete'];
const positions = [
  [80.45, 7.95],
  [80.7, 7.95],
  [80.95, 7.95],
];
const features = positions.map(([lon, lat], index) => {
  const x = Math.round(((lon + 180) / 360) * 4096);
  const y = Math.round(
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 4096,
  );
  return field(
    2,
    Buffer.concat([
      integer(1, index + 1),
      field(2, Buffer.concat([varint(0), varint(index)])),
      integer(3, 1),
      field(4, Buffer.concat([varint(9), varint(x * 2), varint(y * 2)])),
    ]),
  );
});
const tile = field(
  3,
  Buffer.concat([
    field(1, 'place'),
    ...features,
    field(3, 'id'),
    ...sourceIds.map((id) => field(4, field(1, id))),
    integer(5, 4096),
    integer(15, 2),
  ]),
);
const directory = resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/fixture.pbf') {
      response.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
      response.end(tile);
      return;
    }
    if (path === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        '<!doctype html><html><head><link rel="stylesheet" href="/assets/vendor/maplibre-gl.css"></head><body style="margin:0"><div id="map" style="width:100vw;height:100vh"></div></body></html>',
      );
      return;
    }
    const file = resolve(directory, '.' + decodeURIComponent(path));
    if (!file.startsWith(directory + sep)) throw new Error('invalid path');
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type':
        {
          '.js': 'text/javascript',
          '.mjs': 'text/javascript',
          '.css': 'text/css',
        }[extname(file)] || 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
    : { channel: 'chrome' }),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const maplibre = await import('/assets/vendor/maplibre-gl.mjs');
    const { prepareContributions } = await import(
      '/assets/js/contributions.js'
    );
    const manifest = {
      suppressions: { places: { place: ['source-edit', 'source-delete'] } },
      attribution: ['Test fixture'],
    };
    const data = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'replacement',
          geometry: { type: 'Point', coordinates: [80.7, 7.95] },
          properties: { _mazoType: 'place', name: 'replacement' },
        },
        {
          type: 'Feature',
          id: 'addition',
          geometry: { type: 'Point', coordinates: [80.7, 8.2] },
          properties: { _mazoType: 'place', name: 'addition' },
        },
      ],
    };
    const styles = ['light', 'dark'].map((theme) =>
      prepareContributions(
        {
          version: 8,
          metadata: { 'mazo:theme': theme },
          sources: {
            places: {
              type: 'vector',
              tiles: [location.origin + '/fixture.pbf'],
              minzoom: 0,
              maxzoom: 0,
            },
          },
          layers: [
            {
              id: 'background',
              type: 'background',
              paint: {
                'background-color': theme === 'dark' ? '#182124' : '#f7f8f4',
              },
            },
            {
              id: 'places',
              type: 'circle',
              source: 'places',
              'source-layer': 'place',
              paint: { 'circle-radius': 8, 'circle-color': '#c99538' },
            },
          ],
        },
        { manifest, data },
      ),
    );
    const map = new maplibre.Map({
      container: 'map',
      center: [80.7, 8.05],
      zoom: 9,
      style: styles[0],
    });
    const mapErrors = [];
    map.on('error', (event) => mapErrors.push(String(event.error)));
    const snapshots = [];
    for (let index = 0; index < styles.length; index++) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                'Contribution rendering timeout: ' + mapErrors.join('; '),
              ),
            ),
          30000,
        );
        map.once('idle', () => {
          clearTimeout(timer);
          resolve();
        });
        if (index) map.setStyle(styles[index]);
      });
      const features = map
        .queryRenderedFeatures()
        .map((f) => ({
          source: f.source,
          id: f.properties.id,
          name: f.properties.name,
        }));
      snapshots.push(features);
    }
    map.remove();
    return { snapshots, mapErrors };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(result.mapErrors, []);
  for (const features of result.snapshots) {
    assert.equal(features.length, 3);
    assert.deepEqual(
      features.filter((f) => f.source === 'places').map((f) => f.id),
      ['source-keep'],
    );
    assert.deepEqual(
      features
        .filter((f) => f.source === 'contributions')
        .map((f) => f.name)
        .sort(),
      ['addition', 'replacement'],
    );
  }
  console.log(
    'Both themes rendered one unchanged feature, one replacement and one addition; the deleted original was absent.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
