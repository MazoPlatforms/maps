// Smoke-test a previously built canonical pilot, including real PMTiles byte ranges.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataset = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Canonical build directory required');
const view = process.argv[3]?.split(',').map(Number);
if (view && (view.length !== 2 || !view.every(Number.isFinite))) throw new Error('Expected lon,lat');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(dataset, 'manifest.json')));
assert.equal(manifest.schemaVersion, 2);
assert.ok(manifest.tiles);
const requests = [];
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    requests.push(path);
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><link rel="stylesheet" href="/assets/vendor/maplibre-gl.css"><div id="map" style="width:900px;height:700px"></div>');
      return;
    }
    const base = path.startsWith('/canonical/') ? dataset : root;
    const relative = path.startsWith('/canonical/') ? path.slice(11) : path.slice(1);
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep)) throw new Error('Invalid path');
    const body = await readFile(file);
    const types = { '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2]), body.length - 1);
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}` });
      response.end(body.subarray(start, end + 1));
    } else response.end(body);
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  const network = [];
  page.on('request', (request) => network.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const evidence = await page.evaluate(async (view) => {
    const maplibregl = await import('/assets/vendor/maplibre-gl.mjs');
    const { PMTiles, Protocol } = await import('/assets/vendor/pmtiles.mjs');
    const { prepareCanonicalStyle, fetchCanonicalRecord, prepareCanonicalEdit } = await import('/assets/js/canonical-records.js');
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    const dataRoot = new URL('/canonical/', location.href);
    const manifest = await (await fetch(new URL('manifest.json', dataRoot))).json();
    const archive = new PMTiles(new URL(manifest.tiles.file, dataRoot).href);
    const metadata = await archive.getHeader();
    const map = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [] },
      center: view || [metadata.centerLon, metadata.centerLat], zoom: Math.min(metadata.maxZoom, 14) });
    const results = [];
    for (const theme of ['light', 'dark']) {
      const style = prepareCanonicalStyle(await (await fetch(new URL(`${theme}.json`, dataRoot))).json(), dataRoot);
      // Glyphs are a separate existing dependency; exercise geometry without external network.
      delete style.glyphs;
      style.layers = style.layers.filter((layer) => layer.type !== 'symbol');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Map idle timeout')), 30000);
        map.once('idle', () => { clearTimeout(timer); resolve(); });
        map.setStyle(style);
      });
      const features = map.queryRenderedFeatures().filter((f) => f.properties.id);
      if (!features.length) throw new Error(`No canonical geometry rendered in ${theme}`);
      const selected = features[0].properties.id;
      const snapshot = await fetchCanonicalRecord(dataRoot, selected);
      const edit = prepareCanonicalEdit(snapshot, { properties: snapshot.record.properties });
      results.push({ theme, rendered: features.length, types: [...new Set(features.map((f) => f.properties._mazoType))], selected, expected: edit.expected });
    }
    map.remove();
    return results;
  }, view);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(requests.some((path) => path.endsWith('.pmtiles')));
  assert.ok(requests.every((path) => !/overture|contributions/.test(path)));
  const outside = network.filter((url) => !url.startsWith(`http://127.0.0.1:${server.address().port}/`) && !url.startsWith('blob:'));
  assert.deepEqual(outside, [], 'Canonical geometry/API check must use local data only');
  console.log(JSON.stringify({ canonical: evidence, upstreamRequests: outside.length }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
