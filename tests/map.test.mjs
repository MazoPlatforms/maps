import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createArchiveSource } from '../assets/js/archive-source.js';
import { mapConfig, cityViews } from '../assets/js/config.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the extract includes the north, south, east and western islands', async () => {
  const [west, south, east, north] = mapConfig.bounds;
  for (const [lon, lat] of [
    [79.52, 9.1],
    [80.24, 9.84],
    [80.59, 5.92],
    [81.88, 7.29],
  ]) {
    assert.ok(lon >= west && lon <= east && lat >= south && lat <= north);
  }
  const workflow = await read('.github/workflows/pages.yml');
  const bbox = workflow
    .match(/^  BBOX: (.+)$/m)[1]
    .split(',')
    .map(Number);
  assert.deepEqual(bbox, [...mapConfig.bounds]);
  for (const path of Object.values(mapConfig.styles)) {
    const style = JSON.parse(await read(path));
    assert.equal(style.version, 8);
    assert.match(style.name, /Sri Lanka/);
    for (const [theme, source] of Object.entries(style.sources)) {
      assert.equal(
        source.url,
        `pmtiles://__MAZO_SITE_ROOT__/data/sri-lanka/${theme}.pmtiles`,
      );
      assert.ok(style.layers.some((layer) => layer.source === theme));
    }
  }
});

function createNode() {
  const classes = new Set();
  return {
    dataset: {},
    attributes: {},
    listeners: {},
    children: [],
    textContent: '',
    classList: {
      add(...values) {
        values.forEach((value) => classes.add(value));
      },
      remove(...values) {
        values.forEach((value) => classes.delete(value));
      },
      contains(value) {
        return classes.has(value);
      },
      toggle(value, force = !classes.has(value)) {
        if (force) classes.add(value);
        else classes.delete(value);
        return force;
      },
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    addEventListener(event, callback) {
      this.listeners[event] = callback;
    },
    replaceChildren() {
      this.children = [];
    },
    append(...children) {
      this.children.push(...children);
    },
  };
}

async function startApp() {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, createNode());
    return nodes.get(selector);
  };
  const handlers = {};
  const fits = [];
  const flights = [];
  const requests = [];
  const styles = [];
  let features = [];
  let options;
  class TestMap {
    constructor(value) {
      options = value;
    }
    addControl() {}
    on(event, callback) {
      handlers[event] = callback;
    }
    off(event) {
      delete handlers[event];
    }
    fitBounds(bounds, value) {
      fits.push({ bounds, ...value });
    }
    flyTo(value) {
      flights.push(value);
    }
    setStyle(value) {
      styles.push(value);
    }
    getLayer() {
      return {};
    }
    queryRenderedFeatures() {
      return features;
    }
    getCenter() {
      return { lng: 80.7, lat: 7.95 };
    }
  }
  const document = {
    documentElement: { dataset: {} },
    querySelector: node,
    querySelectorAll() {
      return [];
    },
    createElement: createNode,
    addEventListener() {},
    body: createNode(),
  };
  const context = vm.createContext({
    mapConfig,
    cityViews,
    createArchiveSource,
    fetchContributions: async () => null,
    prepareContributions: (style) => style,
    URL,
    URLSearchParams,
    document,
    performance: { now: () => 42 },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    window: {
      matchMedia() {
        return { matches: false };
      },
    },
    location: { search: '?maptest=1' },
    maplibre: { Map: TestMap, NavigationControl: class {}, addProtocol() {} },
    pmtiles: {
      Protocol: class {
        constructor(value) {
          assert.equal(value, undefined);
        }
        tile() {}
      },
    },
    fetch: async (url) => {
      requests.push(String(url));
      const theme = String(url).includes('-dark') ? 'dark' : 'light';
      return {
        ok: true,
        json: async () =>
          String(url).endsWith('manifest.json')
            ? { release: '2026-10-21.0', bbox: [...mapConfig.bounds] }
            : {
                version: 8,
                name: String(url),
                metadata: { 'mazo:theme': theme },
                sources: {},
                layers: [],
              },
      };
    },
  });
  const source = (await read('assets/js/app.js'))
    .replace("import { mapConfig, cityViews } from './config.js';", '')
    .replace("import { createArchiveSource } from './archive-source.js';", '')
    .replace(
      "import { fetchContributions, prepareContributions } from './contributions.js';",
      '',
    )
    .replaceAll(
      'import.meta.url',
      JSON.stringify(new URL('assets/js/app.js', root).href),
    )
    .replace(
      "import('../vendor/maplibre-gl.mjs')",
      'Promise.resolve(globalThis.maplibre)',
    )
    .replace(
      "import('../vendor/pmtiles.mjs')",
      'Promise.resolve(globalThis.pmtiles)',
    );
  await vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    context,
    node,
    handlers,
    fits,
    flights,
    requests,
    styles,
    options,
    setFeatures(value) {
      features = value;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the first geographic frame reveals the map without waiting for full load', async () => {
  const app = await startApp();
  app.handlers.render();
  assert.equal(app.node('#map-frame').dataset.state, undefined);
  assert.equal(app.context.__mazoMapTimings.firstRender, null);
  app.setFeatures([{ source: 'base' }]);
  app.handlers.render();
  assert.equal(app.node('#map-frame').dataset.state, 'ready');
  assert.equal(app.node('#map-status').classList.contains('is-hidden'), true);
  assert.equal(app.node('#map').attributes['aria-busy'], 'false');
  assert.equal(app.context.__mazoMapTimings.firstRender, 42);
  assert.equal(app.context.__mazoMapTimings.loaded, null);
  assert.equal(app.handlers.render, undefined);
  await settle();
  assert.ok(app.requests.some((url) => url.endsWith('manifest.json')));
});

test('city views, reset and theme switches preserve the map workflow', async () => {
  const app = await startApp();
  assert.deepEqual(app.options.bounds, mapConfig.bounds);
  assert.equal(app.options.fitBoundsOptions.padding, 36);
  assert.equal(app.options.maxBounds, undefined);
  app.node('#city-select').listeners.change({ target: { value: 'jaffna' } });
  assert.deepEqual(app.flights[0].center, cityViews.jaffna.center);
  assert.equal(app.flights[0].zoom, 14);
  app.node('#map-reset').listeners.click();
  assert.deepEqual(app.fits[0].bounds, mapConfig.bounds);
  assert.equal(app.fits[0].pitch, 0);
  app.node('#theme-toggle').listeners.click();
  await settle();
  assert.match(app.styles.at(-1).name, /sri-lanka-dark.json$/);
  app.node('#theme-toggle').listeners.click();
  await settle();
  assert.match(app.styles.at(-1).name, /sri-lanka-light.json$/);
  assert.equal(
    app.requests.filter((url) => url.endsWith('sri-lanka-light.json')).length,
    1,
  );
  assert.equal(app.fits.length, 1);
  app.handlers.error({ error: new Error('Missing glyph range') });
  assert.equal(app.node('#map-status').classList.contains('is-warning'), true);
  assert.match(
    app.node('#map-status').children[1].textContent,
    /Some map data or labels/,
  );
});

test('content-addressed archives keep one identity across CDN timestamp ETags', async () => {
  const revision = 'a'.repeat(64);
  const calls = [];
  class Source {
    constructor(url) {
      this.url = url;
    }
    getKey() {
      return this.url;
    }
    async getBytes(...args) {
      calls.push(args);
      return {
        data: new Uint8Array([1, 2]).buffer,
        etag: `timestamp-${calls.length}`,
        cacheControl: 'max-age=600',
      };
    }
  }
  const immutable = createArchiveSource(
    Source,
    `https://maps.example/base.${revision}.pmtiles`,
  );
  const first = await immutable.getBytes(0, 2);
  const second = await immutable.getBytes(2, 2, undefined, first.etag);
  assert.equal(first.etag, revision);
  assert.equal(second.etag, revision);
  assert.equal(second.cacheControl, 'max-age=600');
  assert.deepEqual(new Uint8Array(second.data), new Uint8Array([1, 2]));
  assert.equal(calls[1].length, 3);
  const mutable = createArchiveSource(
    Source,
    'https://maps.example/base.pmtiles',
  );
  assert.ok(mutable instanceof Source);
  assert.match((await mutable.getBytes(0, 2)).etag, /^timestamp-/);
});

test('publishing checks archive hashes and versions the client assets', async () => {
  const { mkdtemp, mkdir, cp, writeFile, readFile, rm } = await import(
    'node:fs/promises'
  );
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const site = await mkdtemp(join(tmpdir(), 'mazo-publish-'));
  try {
    await cp(new URL('assets/', root), join(site, 'assets'), {
      recursive: true,
    });
    await cp(new URL('index.html', root), join(site, 'index.html'));
    await mkdir(join(site, 'data/sri-lanka'), { recursive: true });
    const archives = {};
    const style = JSON.parse(await read('assets/styles/sri-lanka-light.json'));
    for (const theme of Object.keys(style.sources)) {
      const data = Buffer.from([0, 1, 2, theme.length]);
      const sha256 = createHash('sha256').update(data).digest('hex');
      archives[theme] = {
        file: `${theme}.pmtiles`,
        sha256,
        layers: [
          ...new Set(
            style.layers
              .filter((layer) => layer.source === theme)
              .map((layer) => layer['source-layer']),
          ),
        ],
      };
      await writeFile(join(site, 'data/sri-lanka', `${theme}.pmtiles`), data);
    }
    const manifestPath = join(site, 'data/sri-lanka/manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        release: '2026-10-21.0',
        builtAt: '2026-10-23T00:00:00Z',
        overtureTilesImage: 'sha256:fixture',
        archives,
      }),
    );
    const script = new URL('scripts/finalize-styles.py', root).pathname;
    execFileSync('python3', [script, site]);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const published = JSON.parse(
      await readFile(join(site, 'assets/styles/sri-lanka-light.json'), 'utf8'),
    );
    for (const [theme, archive] of Object.entries(manifest.archives)) {
      assert.equal(archive.file, `${theme}.${archive.sha256}.pmtiles`);
      assert.ok(published.sources[theme].url.endsWith(archive.file));
    }
    assert.match(
      await readFile(join(site, 'index.html'), 'utf8'),
      /app\.js\?v=[a-f0-9]{16}/,
    );
    assert.match(
      await readFile(join(site, 'assets/js/app.js'), 'utf8'),
      /archive-source\.js\?v=[a-f0-9]{16}/,
    );
    execFileSync('python3', [script, site]);
    assert.deepEqual(
      JSON.parse(await readFile(manifestPath, 'utf8')),
      manifest,
    );
    await writeFile(
      join(site, 'data/sri-lanka', manifest.archives.base.file),
      Buffer.from([9]),
    );
    assert.throws(
      () => execFileSync('python3', [script, site], { stdio: 'pipe' }),
      /Archive checksum mismatch/,
    );
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});
