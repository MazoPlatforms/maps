import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = 'https://mazoplatforms.github.io/maps/';
const themes = ['base', 'transportation', 'buildings', 'places'];
const rangeChecks = [];

for (const theme of themes) {
  const response = await fetch(`${baseUrl}data/batticaloa/${theme}.pmtiles`, {
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
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(`${baseUrl}?maptest=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__mazoMap || window.__mazoMapError), null, { timeout: 30_000 });
if (!await page.evaluate(() => Boolean(window.__mazoMap))) {
  throw new Error(`Map initialization failed: ${await page.evaluate(() => window.__mazoMapError)}; browser errors: ${errors.slice(0, 5).join(' | ')}`);
}
try {
  await page.waitForFunction(() => Boolean(window.__mazoMap?.isStyleLoaded()), null, { timeout: 60_000 });
} catch {
  const state = await page.evaluate(() => ({ error: window.__mazoMapError, status: document.querySelector('#map-status')?.textContent, styleLoaded: window.__mazoMap?.isStyleLoaded(), style: window.__mazoMap?.getStyle() }));
  throw new Error(`Map style did not load: ${JSON.stringify({ ...state, browserErrors: errors.slice(0, 10) })}`);
}
await mkdir('verification', { recursive: true });
await page.evaluate(async () => {
  const map = window.__mazoMap;
  map.jumpTo({ center: [81.695, 7.71], zoom: 15 });
});
await page.waitForFunction(() => Boolean(window.__mazoMap?.isStyleLoaded() && window.__mazoMap.areTilesLoaded()), null, { timeout: 90_000 });

async function inspectTheme(theme) {
  await page.waitForFunction(name => {
    const map = window.__mazoMap;
    return Boolean(map?.isStyleLoaded() && map.areTilesLoaded() && map.getStyle().name === name);
  }, `Mazo Maps Batticaloa ${theme[0].toUpperCase()}${theme.slice(1)}`, { timeout: 90_000 });
  const rendering = await page.evaluate(() => {
    const map = window.__mazoMap;
    const sourceCounts = Object.fromEntries(['base', 'transportation', 'buildings', 'places'].map(source => [source, map.querySourceFeatures(source).length]));
    const styleLayers = new Set(map.getStyle().layers.map(layer => layer.id));
    const layerCounts = Object.fromEntries(['land', 'land-use', 'water-fill', 'road-lines', 'building-fills', 'place-names'].map(layer => [layer, styleLayers.has(layer) ? map.queryRenderedFeatures({ layers: [layer] }).length : null]));
    return { styleLoaded: map.isStyleLoaded(), styleName: map.getStyle().name, zoom: map.getZoom(), sourceCounts, layerCounts };
  });
  const visibleLayerCounts = ['land', 'water-fill', 'road-lines', 'building-fills', 'place-names'].map(layer => rendering.layerCounts[layer]);
  if (!rendering.styleLoaded || visibleLayerCounts.some(count => !Number.isInteger(count) || count < 1)) {
    throw new Error(`${theme} Overture layers were not queryable: ${JSON.stringify(rendering)}`);
  }
  await page.locator('#map').screenshot({ path: `mazo-batticaloa-${theme}.png` });
  return rendering;
}

const light = await inspectTheme('light');
await page.locator('#theme-toggle').click();
const dark = await inspectTheme('dark');
if (errors.length) throw new Error(`Browser reported errors: ${errors.slice(0, 5).join(' | ')}`);
await writeFile('verification/map-smoke.json', JSON.stringify({ url: baseUrl, rangeChecks, themes: { light, dark }, browserErrors: errors }, null, 2) + '\n');
console.log(`Live light and dark maps rendered; four PMTiles range requests returned 206.`);
} finally {
  await browser.close();
}
