import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
let rollout = false,
  updateAssetRequests = 0;
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(process.argv[2]);
if (!process.argv[2]) throw new Error('Assembled preview directory required');
const AxeBuilder = process.env.AXE_PLAYWRIGHT_MODULE
  ? (await import(process.env.AXE_PLAYWRIGHT_MODULE)).default
  : null;
const accessibilityContexts = [];
async function checkAccessibility(page, context) {
  if (!AxeBuilder) return;
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  assert.deepEqual(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
    [],
    `Accessibility violations in ${context}`,
  );
  accessibilityContexts.push(context);
}
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    );
    if (!pathname.startsWith('/maps/')) throw new Error();
    const file = resolve(
      root,
      '.' + pathname.slice(5) + (pathname.endsWith('/') ? 'index.html' : ''),
    );
    if (!file.startsWith(root + '/')) throw new Error();
    let body = await readFile(file);
    if (rollout && pathname.endsWith('/assets/css/site.css'))
      body = Buffer.concat([
        body,
        Buffer.from('\n/* local integration update */\n'),
      ]);
    if (rollout && pathname.endsWith('/offline-manifest.json')) {
      const inventory = JSON.parse(body);
      const css = await readFile(resolve(root, 'assets/css/site.css'));
      const updated = Buffer.concat([
        css,
        Buffer.from('\n/* local integration update */\n'),
      ]);
      const entry = inventory.files.find(
        (e) => e.file === 'assets/css/site.css',
      );
      entry.bytes = updated.length;
      entry.sha256 = createHash('sha256').update(updated).digest('hex');
      inventory.version = createHash('sha256')
        .update(JSON.stringify(inventory.files))
        .digest('hex');
      body = Buffer.from(JSON.stringify(inventory));
    }
    if (
      rollout &&
      req.headers['x-mazo-download'] === '1' &&
      !pathname.endsWith('/offline-manifest.json')
    )
      updateAssetRequests++;

    const mime = {
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
    };
    res.setHeader(
      'Content-Type',
      mime[extname(file)] || 'application/octet-stream',
    );
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (match) {
      const a = Number(match[1]),
        b = Math.min(Number(match[2]), body.length - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${body.length}` });
      res.end(body.subarray(a, b + 1));
    } else res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}/maps/`;
  const start = performance.now();
  await page.goto(base + '?dataset=canonical&maptest');
  await page.waitForFunction(() => window.__mazoMap?.isStyleLoaded());
  await page.waitForFunction(() =>
    window.__mazoMap.queryRenderedFeatures().some((f) => f.properties.id),
  );
  await checkAccessibility(page, 'desktop viewer light theme');
  const mapMs = performance.now() - start;
  const tileDurations = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('.pmtiles'))
      .map((e) => e.duration),
  );
  await page.click('#theme-toggle');
  await page.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'dark',
  );
  await checkAccessibility(page, 'desktop viewer dark theme');
  await page.click('#theme-toggle');
  await page.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  await page.click('#editor-toggle');
  await page
    .waitForFunction(() => !!window.__mazoEditor)
    .catch(async (error) => {
      throw new Error(
        error.message +
          ' / ' +
          (await page.locator('#map-status').textContent()),
      );
    });
  await page.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  await checkAccessibility(page, 'desktop editor light theme');
  await page.click('#theme-toggle');
  await page.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  await checkAccessibility(page, 'desktop editor dark theme');
  await page.click('#theme-toggle');
  await page.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  await page.selectOption('#edit-type', 'building');
  const selected = await page.evaluate(() => {
    const map = window.__mazoMap,
      canvas = map.getCanvas(),
      rect = canvas.getBoundingClientRect();
    const features = map
      .queryRenderedFeatures([
        [400, 60],
        [canvas.clientWidth - 100, canvas.clientHeight - 100],
      ])
      .filter((f) => f.properties._mazoType === 'building');
    for (const feature of features) {
      let ring = feature.geometry.coordinates;
      while (Array.isArray(ring[0]?.[0])) ring = ring[0];
      const vertices = ring.slice(0, -1),
        center = vertices.reduce(
          (a, p) => [
            a[0] + p[0] / vertices.length,
            a[1] + p[1] / vertices.length,
          ],
          [0, 0],
        ),
        p = map.project(center);
      if (
        p.x < 400 ||
        p.x > canvas.clientWidth - 100 ||
        p.y < 60 ||
        p.y > canvas.clientHeight - 100
      )
        continue;
      if (
        map
          .queryRenderedFeatures(p)
          .some((f) => f.properties.id === feature.properties.id)
      )
        return { id: feature.properties.id, x: p.x + rect.x, y: p.y + rect.y };
    }
    throw new Error('No clickable interior of a real building found');
  });
  await page.mouse.click(selected.x, selected.y);
  await page.waitForFunction(
    () => Object.keys(window.__mazoEditor.model.entries).length > 0,
  );
  await page
    .waitForFunction(
      () => document.querySelector('#edit-properties').value.length > 0,
      {},
      { timeout: 5000 },
    )
    .catch(async (error) => {
      throw new Error(
        error.message +
          ' / inspector ' +
          JSON.stringify(
            await page.evaluate(() => ({
              status: document.querySelector('#edit-status').textContent,
              sources: Object.keys(window.__mazoMap.getStyle().sources),
              selection: document.querySelector('#edit-selection').value,
              entries: Object.keys(window.__mazoEditor.model.entries),
              errors: window.__mazoMapError,
            })),
          ),
      );
    });
  await page.fill('#edit-en', 'Browser verification draft only');
  const editStarted = performance.now();
  await page.click('[data-action="apply"]');
  await page
    .waitForFunction(() =>
      Object.values(window.__mazoEditor.model.entries).some((e) => e.dirty),
    )
    .catch(async (error) => {
      throw new Error(
        error.message +
          ' / ' +
          (await page.locator('#edit-status').textContent()),
      );
    });
  await page.waitForFunction(() =>
    window.__mazoMap.isSourceLoaded('editor-drafts'),
  );
  const editorApplyMs = performance.now() - editStarted;
  const state = await page.evaluate(() => {
    const before = Object.values(window.__mazoEditor.model.entries)[0].before;
    let position = before.geometry.coordinates;
    while (Array.isArray(position[0])) position = position[0];
    return { id: before.id, before, position };
  });
  await page.click('[data-action="undo"]');
  assert.equal(
    await page.evaluate(
      () => Object.values(window.__mazoEditor.model.entries)[0].dirty,
    ),
    false,
  );
  await page.click('[data-action="redo"]');
  await page.click('[data-action="save"]');
  await page.click('[data-action="discard"]');
  await page.click('[data-action="restore"]');
  assert.equal(
    await page.evaluate(
      () =>
        Object.values(window.__mazoEditor.model.entries).filter((e) => e.dirty)
          .length,
    ),
    1,
  );
  await page.click('[data-action="delete"]');
  assert.equal(
    await page.evaluate(
      () => Object.values(window.__mazoEditor.model.entries)[0].after.status,
    ),
    'removed',
  );
  await page.click('[data-action="undo"]');
  await page.fill('#edit-lon', String(state.position[0] + 0.000001));
  await page.click('[data-action="vertex"]');
  await page.fill('#edit-author', 'Browser verifier');
  await page.fill(
    '#edit-summary',
    'Real browser canonical editing verification',
  );
  await page.check('#edit-license');
  await page.click('[data-action="preview"]');
  const changeset = JSON.parse(
    await page.locator('#edit-preview').textContent(),
  );
  assert.equal(state.before.featureType, 'building');
  assert.ok(changeset.operations.length);
  assert.equal(changeset.operations[0].operation, 'update');
  await writeFile(
    '/tmp/mazo-browser-changeset.json',
    JSON.stringify(changeset),
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-action="submit"]'),
  ]);
  assert.ok(download.suggestedFilename().endsWith('.json'));
  assert.ok(await page.locator('#edit-handoff').isVisible());
  await page.click('[data-action="compare"]');
  await page.click('[data-action="compare"]');
  await page.fill(
    '#edit-source',
    'https://example.org/browser-verification-only',
  );
  await page.selectOption('#edit-type', 'place');
  await page.click('[data-action="draw"]');
  const draw = await page.evaluate(() => {
    const m = window.__mazoMap,
      p = m.project([79.846, 6.921]),
      r = m.getCanvas().getBoundingClientRect();
    return { x: p.x + r.x, y: p.y + r.y };
  });
  await page.mouse.click(draw.x, draw.y);
  assert.equal(
    await page.evaluate(
      () =>
        Object.values(window.__mazoEditor.model.entries).filter(
          (e) => !e.before,
        ).length,
    ),
    1,
  );
  await page.click('[data-action="delete"]');
  await page.selectOption('#edit-type', 'building');
  await page.click('[data-action="draw"]');
  for (const coordinates of [
    [79.846, 6.921],
    [79.8464, 6.921],
    [79.8462, 6.9213],
  ]) {
    const p = await page.evaluate((c) => {
      const m = window.__mazoMap,
        p = m.project(c),
        r = m.getCanvas().getBoundingClientRect();
      return { x: p.x + r.x, y: p.y + r.y };
    }, coordinates);
    await page.mouse.click(p.x, p.y);
  }
  await page.click('[data-action="finish"]');
  assert.equal(
    await page.evaluate(
      () =>
        Object.values(window.__mazoEditor.model.entries).filter(
          (e) => !e.before && e.after.featureType === 'building',
        ).length,
    ),
    1,
  );
  await page.click('[data-action="add-vertex"]');
  await page.fill('#edit-vertex', '1');
  await page.click('[data-action="remove-vertex"]');
  await page.click('[data-action="delete"]');
  for (const [kind, geometry] of [
    ['connector', 'Point'],
    ['road', 'LineString'],
    ['land', 'Polygon'],
    ['land_use', 'Polygon'],
    ['water', 'LineString'],
    ['water', 'Polygon'],
    ['administrative_boundary', 'Polygon'],
  ]) {
    await page.selectOption('#edit-type', kind);
    await page.selectOption('#edit-geometry', geometry);
    await page.click('[data-action="draw"]');
    const coordinates =
      geometry === 'Point'
        ? [[79.846, 6.921]]
        : geometry === 'LineString'
          ? [
              [79.846, 6.921],
              [79.8464, 6.9213],
            ]
          : [
              [79.846, 6.921],
              [79.8464, 6.921],
              [79.8462, 6.9213],
            ];
    for (const c of coordinates) {
      const p = await page.evaluate((c) => {
        const m = window.__mazoMap,
          p = m.project(c),
          r = m.getCanvas().getBoundingClientRect();
        return { x: p.x + r.x, y: p.y + r.y };
      }, c);
      await page.mouse.click(p.x, p.y);
    }
    if (geometry !== 'Point') await page.click('[data-action="finish"]');
    assert.ok(
      await page.evaluate(
        (kind) =>
          Object.values(window.__mazoEditor.model.entries).some(
            (e) => !e.before && e.after.featureType === kind,
          ),
        kind,
      ),
    );
    await page.click('[data-action="delete"]');
  }
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.locator('#edit-type').press('Escape');
  assert.match(await page.locator('#edit-help').textContent(), /cancelled/);
  await page.selectOption('#edit-type', 'place');
  await page.selectOption('#edit-geometry', 'Point');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByLabel('Drawing longitude').fill('79.8462');
  await page.getByLabel('Drawing latitude').fill('6.9212');
  const keyboardAdd = page.getByRole('button', { name: 'Add coordinate' });
  await keyboardAdd.focus();
  await keyboardAdd.press('Enter');
  const keyboardFeature = await page.evaluate(() => {
    const entry = Object.entries(window.__mazoEditor.model.entries).find(
      ([, value]) => !value.before && value.after.featureType === 'place',
    );
    return entry?.[0];
  });
  assert.ok(keyboardFeature, 'keyboard coordinate entry creates a real draft');
  assert.equal(await page.locator('#edit-help').getAttribute('aria-live'), 'polite');
  await page.click('[data-action="delete"]');
  await page.getByLabel('Permanent Mazo ID').fill(state.id);
  const loadFeature = page.getByRole('button', { name: 'Load feature by ID' });
  await loadFeature.focus();
  await loadFeature.press('Enter');
  assert.equal(await page.locator('#edit-selection').inputValue(), state.id);
  async function keyboardGeometry(type, geometry, coordinates) {
    await page.selectOption('#edit-type', type);
    await page.selectOption('#edit-geometry', geometry);
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    for (const [longitude, latitude] of coordinates) {
      await page.getByLabel('Drawing longitude').fill(String(longitude));
      await page.getByLabel('Drawing latitude').fill(String(latitude));
      await keyboardAdd.press('Enter');
    }
    await page.getByRole('button', { name: 'Finish', exact: true }).focus();
    await page.getByRole('button', { name: 'Finish', exact: true }).press('Enter');
    const created = await page.evaluate(
      (featureType) =>
        Object.entries(window.__mazoEditor.model.entries).find(
          ([, value]) => !value.before && value.after.featureType === featureType,
        )?.[0],
      type,
    );
    assert.ok(created, `keyboard coordinate entry creates a ${type}`);
    await page.click('[data-action="delete"]');
  }
  await keyboardGeometry('road', 'LineString', [
    [79.846, 6.921],
    [79.8463, 6.9213],
  ]);
  await keyboardGeometry('land', 'Polygon', [
    [79.846, 6.921],
    [79.8463, 6.921],
    [79.8462, 6.9213],
  ]);
  const keyboardDrawing = true;
  await page.click('[data-action="close"]');
  await page.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  const offline = await page.evaluate(async () => {
    const { OfflineManager } = await import('./assets/js/offline.js');
    const manager = new OfflineManager(new URL('./', location.href));
    const controller = new AbortController();
    let interrupted = false;
    try {
      await manager.download({
        signal: controller.signal,
        onProgress: () => controller.abort(),
      });
    } catch (e) {
      interrupted = e.name === 'AbortError';
    }
    if (!interrupted)
      throw new Error('Interrupted-download test did not interrupt');
    const state = await manager.download();
    const cache = await caches.open(state.cacheName),
      url = new URL('api/v1/manifest.json', location.href),
      saved = await cache.match(url);
    await cache.put(url, new Response('corrupt', { headers: saved.headers }));
    const rejected = (await fetch(url)).status === 503;
    if (!rejected) throw new Error('Corrupt offline asset was not rejected');
    await manager.download();
    return { state, interrupted, corruptRejected: rejected };
  });
  rollout = true;
  const updated = await page.evaluate(async () => {
    const { OfflineManager } = await import('./assets/js/offline.js');
    const m = new OfflineManager(new URL('./', location.href));
    const old = await m.installed();
    if (!(await m.hasUpdate())) throw new Error('Update not detected');
    const next = await m.download();
    return old.version !== next.version;
  });
  assert.ok(updated);
  assert.equal(
    updateAssetRequests,
    1,
    'Only the changed CSS resource should be downloaded across versions',
  );
  await context.setOffline(true);
  await page.goto(base + '?dataset=canonical&offline=1&maptest');
  await page.waitForFunction(() => window.__mazoMap?.isStyleLoaded());
  await page.waitForFunction(() =>
    window.__mazoMap.queryRenderedFeatures().some((f) => f.properties.id),
  );
  const offlineLabels = await page.evaluate(async () => {
    const style = window.__mazoMap.getStyle();
    const manifest = await (await fetch(new URL('offline-manifest.json', location.href))).json();
    const glyphFiles = manifest.files.filter((entry) => entry.file.startsWith('assets/fonts/Noto Sans Regular/'));
    const glyph = await fetch(new URL('assets/fonts/Noto%20Sans%20Regular/0-255.pbf', location.href));
    return {
      mode: manifest.mode,
      glyphCount: glyphFiles.length,
      glyphStatus: glyph.status,
      symbolLayers: style.layers.filter((layer) => layer.type === 'symbol' && layer.layout?.['text-field']).length,
      localGlyphs: style.glyphs?.includes(location.origin),
      requested: performance.getEntriesByType('resource').some((entry) => /assets\/fonts\/Noto%20Sans%20Regular\/.*\.pbf/.test(entry.name)),
    };
  });
  assert.match(offlineLabels.mode, /glyph-enabled/);
  assert.ok(offlineLabels.glyphCount >= 4);
  assert.equal(offlineLabels.glyphStatus, 200);
  assert.ok(offlineLabels.symbolLayers > 0);
  assert.ok(offlineLabels.localGlyphs);
  assert.ok(offlineLabels.requested, 'MapLibre requested local glyphs while network is disconnected');
  const offlineSearch = await page.evaluate(async () => {
    const { MazoMaps } = await import('./sdk/index.js');
    const sdk = new MazoMaps({ baseURL: new URL('api/v1/', location.href) });
    const m = await sdk.initialize();
    const rows = await sdk.resource(Object.values(m.search)[0]);
    const query = rows[0].names[0];
    return (await sdk.search(query)).length;
  });
  assert.ok(offlineSearch > 0);
  const routeCoordinates = await page.evaluate(async () => {
    const { MazoMaps } = await import('./sdk/index.js');
    const sdk = new MazoMaps({ baseURL: new URL('api/v1/', location.href) });
    const m = await sdk.ready(),
      g = await sdk.resource(m.routing),
      e = g.edges[0];
    return { a: g.nodes[e.from].join(','), b: g.nodes[e.to].join(',') };
  });
  await page
    .getByText('Route in the available road sample', { exact: true })
    .click();
  await page.fill('#route-origin', routeCoordinates.a);
  await page.fill('#route-destination', routeCoordinates.b);
  await page.click('#route-submit');
  await page.waitForFunction(() =>
    document.querySelector('#route-result').textContent.includes('estimated'),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(base + '?dataset=canonical&maptest');
  await mobile.waitForFunction(() => window.__mazoMap?.isStyleLoaded());
  await mobile.tap('#editor-toggle');
  await mobile.waitForFunction(() => !!window.__mazoEditor);
  await checkAccessibility(mobile, 'mobile editor light theme');
  await mobile.click('#theme-toggle');
  await mobile.waitForFunction(() => window.__mazoMap.isStyleLoaded());
  await checkAccessibility(mobile, 'mobile editor dark theme');
  assert.ok(
    await mobile.evaluate(
      () =>
        document.querySelector('.editor-panel').getBoundingClientRect().width <=
        innerWidth,
    ),
  );
  await mobileContext.close();

  console.log(
    JSON.stringify(
      {
        mapInitialMs: mapMs,
        editorApplyMs,
        tileRequests: tileDurations.length,
        tileMedianMs: tileDurations.sort((a, b) => a - b)[
          Math.floor(tileDurations.length / 2)
        ],
        realFeature: state.id,
        editorChangeset: changeset.id,
        editor: true,
        offlineGeometry: true,
        offlineLabelledRendering: offlineLabels,
        offlineSearch,
        interruptedRecovery: offline.interrupted,
        corruptCacheRejected: offline.corruptRejected,
        mobileLayout: true,
        mobileTouchEditor: true,
        offlineRouting: true,
        crossVersionUpdate: true,
        changedUpdateFiles: updateAssetRequests,
        drawnFeatureTypes: 8,
        keyboardDrawing,
        accessibilityChecks: accessibilityContexts,
        lightAndDark: true,
        jsHeapBytes: await page.evaluate(
          () => performance.memory?.usedJSHeapSize ?? null,
        ),
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
