import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mapConfig } from '../assets/js/config.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('the extract includes the north, south, east and western islands', async () => {
  const [west, south, east, north] = mapConfig.bounds;
  for (const [lon, lat] of [[79.52, 9.10], [80.24, 9.84], [80.59, 5.92], [81.88, 7.29]]) {
    assert.ok(lon >= west && lon <= east && lat >= south && lat <= north);
  }
  const workflow = await read('.github/workflows/pages.yml');
  const bbox = workflow.match(/^  BBOX: (.+)$/m)[1].split(',').map(Number);
  assert.deepEqual(bbox, [...mapConfig.bounds]);
  for (const path of Object.values(mapConfig.styles)) {
    const style = JSON.parse(await read(path));
    assert.equal(style.version, 8);
    assert.match(style.name, /Sri Lanka/);
    for (const [theme, source] of Object.entries(style.sources)) {
      assert.equal(source.url, `pmtiles://__MAZO_SITE_ROOT__/data/sri-lanka/${theme}.pmtiles`);
      assert.ok(style.layers.some(layer => layer.source === theme));
    }
  }
});

test('initial and reset views fit the island and theme changes retain the view', async () => {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      attributes: {}, listeners: {}, classList: { add() {}, remove() {}, toggle(key, value) { this[key] = value; } },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(event, callback) { this.listeners[event] = callback; }
    });
    return nodes.get(selector);
  };
  const fits = [];
  const handlers = {};
  let options;
  let style;
  class TestMap {
    constructor(value) { options = value; }
    addControl() {}
    on(event, callback) { handlers[event] = callback; }
    fitBounds(bounds, value) { fits.push({ bounds, ...value }); }
    setStyle(value) { style = value; }
  }
  const context = vm.createContext({
    mapConfig, URL, URLSearchParams,
    document: { documentElement: { dataset: {} }, querySelector: node },
    localStorage: { getItem() { return null; }, setItem() {} },
    window: { matchMedia() { return { matches: false }; } },
    location: { search: '' },
    maplibre: { Map: TestMap, NavigationControl: class {}, addProtocol() {} },
    pmtiles: { Protocol: class { tile() {} } },
    fetch: async url => ({ ok: true, json: async () => String(url).endsWith('manifest.json')
      ? { release: '2026-10-21.0', bbox: [...mapConfig.bounds] }
      : { version: 8, name: String(url), sources: {}, layers: [] } })
  });
  const source = (await read('assets/js/app.js'))
    .replace("import { mapConfig } from './config.js';", '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('assets/js/app.js', root).href))
    .replace(/import\('https:\/\/unpkg.com\/maplibre-gl[^']+'\)/, 'Promise.resolve(globalThis.maplibre)')
    .replace(/import\('https:\/\/unpkg.com\/pmtiles[^']+'\)/, 'Promise.resolve(globalThis.pmtiles)');
  await vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(options.bounds, mapConfig.bounds);
  assert.equal(options.fitBoundsOptions.padding, 24);
  assert.equal(options.maxBounds, undefined);
  node('#map-reset').listeners.click();
  assert.deepEqual(fits[0].bounds, mapConfig.bounds);
  assert.equal(fits[0].bearing, 0);
  assert.equal(fits[0].pitch, 0);
  node('#theme-toggle').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(style.name, /sri-lanka-dark.json$/);
  assert.equal(fits.length, 1);
  handlers.error({ error: new Error('Missing glyph range') });
  assert.equal(node('#map-status').classList['is-warning'], true);
  assert.match(node('#map-status').innerHTML, /Some map data or labels/);
});
