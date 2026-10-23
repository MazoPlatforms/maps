import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = 'https://mazoplatforms.github.io/maps/';
const themes = ['base', 'transportation', 'buildings', 'places'];
const locations = [
  { name: 'colombo', center: [79.8612, 6.9271] },
  { name: 'jaffna', center: [80.0255, 9.6615] },
  { name: 'trincomalee', center: [81.2152, 8.5874] },
  { name: 'batticaloa', center: [81.695, 7.71] },
  { name: 'kandy', center: [80.6337, 7.2906] },
  { name: 'galle', center: [80.217, 6.0329] }
];
const rangeChecks = [];
const manifestResponse = await fetch(`${baseUrl}data/sri-lanka/manifest.json`);
if (!manifestResponse.ok) throw new Error(`Manifest returned ${manifestResponse.status}`);
const manifest = await manifestResponse.json();

for (const theme of themes) {
  const archive = manifest.archives[theme];
  if (!/^[a-f0-9]{64}$/.test(archive.sha256) || archive.file !== `${theme}.${archive.sha256}.pmtiles`) {
    throw new Error(`Invalid content-addressed archive: ${theme}`);
  }
  const response = await fetch(`${baseUrl}data/sri-lanka/${archive.file}`, {
    headers: { Range: 'bytes=0-63' }
  });
  const contentRange = response.headers.get('content-range');
  if (response.status !== 206 || !contentRange?.startsWith('bytes 0-63/')) {
    throw new Error(`${theme} archive did not satisfy byte-range request (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== 64) throw new Error(`${theme} archive returned ${bytes.byteLength} bytes for a 64-byte range`);
  rangeChecks.push({ theme, status: response.status, contentRange });
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });
  await page.goto(`${baseUrl}?maptest=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__mazoMap || window.__mazoMapError), null, { timeout: 30_000 });
  if (!await page.evaluate(() => Boolean(window.__mazoMap))) {
    throw new Error(`Map initialization failed: ${await page.evaluate(() => window.__mazoMapError)}; browser errors: ${pageErrors.slice(0, 5).join(' | ')}`);
  }
  await page.locator('#map').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__mazoMapTimings?.firstRender !== null && document.querySelector('#map-frame')?.dataset.state === 'ready', null, { timeout: 60_000 });
  const startup = await page.evaluate(() => ({ firstFrameMs: Math.round(window.__mazoMapTimings.firstRender), statusHidden: document.querySelector('#map-status').classList.contains('is-hidden') }));
  if (!startup.statusHidden) throw new Error('The initial map remained behind a loading indicator');
  try {
    await page.waitForFunction(() => Boolean(window.__mazoMap?.isStyleLoaded()), null, { timeout: 60_000 });
  } catch {
    const state = await page.evaluate(() => ({ error: window.__mazoMapError, status: document.querySelector('#map-status')?.textContent, styleLoaded: window.__mazoMap?.isStyleLoaded(), style: window.__mazoMap?.getStyle() }));
    throw new Error(`Map style did not load: ${JSON.stringify({ ...state, browserErrors: pageErrors.slice(0, 10) })}`);
  }
  await mkdir('verification', { recursive: true });
  function readRendering({ name, readyOnly }) {
    const map = window.__mazoMap;
    const features = map.queryRenderedFeatures();
    const sourceLayerCounts = Object.fromEntries(['land', 'water', 'segment', 'connector', 'building', 'place'].map(sourceLayer => [sourceLayer, features.filter(feature => feature.sourceLayer === sourceLayer).length]));
    const status = document.querySelector('#map-status');
    const blockingOverlay = Boolean(status && !status.classList.contains('is-hidden') && !status.classList.contains('is-warning'));
    const placeLabels = features.filter(feature => feature.layer.type === 'symbol' && feature.sourceLayer === 'place');
    const layerCounts = Object.fromEntries(['land', 'water-fill', 'road-lines', 'building-fills', 'place-names'].map(layer => [layer, map.getStyle().layers.some(item => item.id === layer) ? map.queryRenderedFeatures({ layers: [layer] }).length : null]));
    const rendering = { blockingOverlay, styleLoaded: map.isStyleLoaded(), styleName: map.getStyle().name, zoom: map.getZoom(), sourceLayerCounts, layerCounts, placeLabels: placeLabels.length };
    const ready = !blockingOverlay && rendering.styleLoaded && map.areTilesLoaded() && rendering.styleName === name && ['land', 'road-lines', 'building-fills', 'place-names'].every(layer => Number.isInteger(layerCounts[layer]) && layerCounts[layer] > 0);
    return !readyOnly || ready ? rendering : null;
  }

  async function inspectTheme(theme, location) {
    await page.waitForFunction(() => window.__mazoMap.loaded(), null, { timeout: 90_000 });
    await page.evaluate(center => new Promise((resolve, reject) => {
      const map = window.__mazoMap;
      const timeout = setTimeout(() => {
        map.off('idle', ready);
        reject(new Error('Map did not become idle'));
      }, 90_000);
      function ready() {
        clearTimeout(timeout);
        resolve();
      }
      map.once('idle', ready);
      map.jumpTo({ center, zoom: 15 });
    }), location.center);
    const name = `Mazo Maps Sri Lanka ${theme[0].toUpperCase()}${theme.slice(1)}`;
    let rendering;
    try {
      const snapshot = await page.waitForFunction(readRendering, { name, readyOnly: true }, { timeout: 90_000 });
      rendering = await snapshot.jsonValue();
      await snapshot.dispose();
    } catch {
      rendering = await page.evaluate(readRendering, { name, readyOnly: false });
      await page.locator('#map').screenshot({ path: `mazo-sri-lanka-${location.name}-${theme}-diagnostic.png` });
      await writeFile('verification/map-smoke-diagnostic.json', JSON.stringify({ theme, location, rendering, pageErrors, consoleErrors, failedResponses }, null, 2) + '\n');
      throw new Error(`${location.name} ${theme} Overture layers were not queryable: ${JSON.stringify({ rendering, pageErrors, consoleErrors, failedResponses })}`);
    }
    await page.locator('#map').screenshot({ path: `mazo-sri-lanka-${location.name}-${theme}.png` });
    return rendering;
  }

  const results = { light: {}, dark: {} };
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme-toggle').click();
    for (const location of locations) results[theme][location.name] = await inspectTheme(theme, location);
  }
  await page.locator('#map-reset').click();
  await page.waitForFunction(() => {
    const map = window.__mazoMap;
    const bounds = map.getBounds();
    return !map.isMoving() && bounds.contains([79.3, 5.8]) && bounds.contains([82.1, 10.1]);
  }, null, { timeout: 10_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: 'mazo-sri-lanka-mobile.png', fullPage: true });
  await page.selectOption('#city-select', 'colombo');
  await page.waitForFunction(() => !window.__mazoMap.isMoving() && window.__mazoMap.getZoom() >= 13.9, null, { timeout: 15_000 });
  await page.locator('#map-reset').click();
  await page.waitForFunction(() => !window.__mazoMap.isMoving() && window.__mazoMap.getBounds().contains([79.3, 5.8]) && window.__mazoMap.getBounds().contains([82.1, 10.1]), null, { timeout: 15_000 });
  const sameOriginFailures = failedResponses.filter(item => item.url.startsWith(baseUrl));
  if (pageErrors.length || sameOriginFailures.length) throw new Error(`Browser issues: ${JSON.stringify({ pageErrors: pageErrors.slice(0, 5), failedResponses: sameOriginFailures.slice(0, 10) })}`);
  await writeFile('verification/map-smoke.json', JSON.stringify({ url: baseUrl, rangeChecks, themes: results, startup, pageErrors, consoleErrors, failedResponses }, null, 2) + '\n');
  console.log(`Light and dark maps rendered in six Sri Lankan cities; four PMTiles range requests returned 206. First map frame: ${startup.firstFrameMs} ms. External resource failures: ${failedResponses.filter(item => !item.url.startsWith(baseUrl)).length}.`);
} finally {
  await browser.close();
}
