import { mapConfig, cityViews } from './config.js';
import { createArchiveSource } from './archive-source.js';

const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const mapStatus = document.querySelector('#map-status');
const mapNode = document.querySelector('#map');
const mapFrame = document.querySelector('#map-frame');
const citySelect = document.querySelector('#city-select');
const siteRoot = new URL('../../', import.meta.url).href;
const styleCache = new Map();
const reducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches;
const mapTest = new URLSearchParams(location.search).has('maptest');
let map;
let firstFrame = false;
let fullMapStyle;
let fullStyleLoaded = false;
let fullStyleUpgradeQueued = false;
let explorerStarted = false;

// Original Mazo canvas artwork. Icons are shared by category, not allocated per feature.
const placeArtwork = {
  food: ['#b87353', 'M7 3v7m3-7v7M5 7h7v3a3 3 0 0 1-3 3v8m9-18v18m0-18c-4 3-4 8 0 8'],
  health: ['#b5666c', 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6Z'],
  shop: ['#6d81aa', 'M5 8h14l1 12H4ZM9 8V6a3 3 0 0 1 6 0v2'],
  hotel: ['#8c76a6', 'M3 19V6m0 9h18v4m-12-8h9a3 3 0 0 1 3 3v1M6 9h3v4H6Z'],
  school: ['#668e9f', 'M2 9l10-5 10 5-10 5ZM6 12v5q6 5 12 0v-5m4-3v9'],
  worship: ['#967c9c', 'M4 20h16M6 20V9l6-5 6 5v11M10 20v-6h4v6m-2-16V1'],
  transport: ['#648b9d', 'M6 17V5q6-3 12 0v12ZM6 10h12M8 20v-3m8 3v-3M9 14h0m6 0h0'],
  park: ['#628c6e', 'M12 3L5 12h4l-5 5h16l-5-5h4ZM12 17v4'],
  place: ['#638a7c', 'M6 20V7l6-3 6 3v13ZM9 9h0m6 0h0m-6 4h0m6 0h0m-5 7v-4h2v4'],
};
function addPlaceIcon(id) {
  if (!id.startsWith('mazo-poi-') || map.hasImage(id)) return;
  const art = placeArtwork[id.slice(9)];
  if (!art) return;
  const canvas = document.createElement('canvas');
  canvas.width = 48; canvas.height = 56;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = art[0]; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(24, 53);
  ctx.bezierCurveTo(19, 44, 6, 35, 6, 23);
  ctx.arc(24, 23, 18, Math.PI, 0);
  ctx.bezierCurveTo(42, 35, 29, 44, 24, 53);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.translate(12, 11); ctx.lineWidth = 1.8;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(art[1]));
  map.addImage(id, ctx.getImageData(0, 0, 48, 56), { pixelRatio: 2 });
}

function preferredTheme() {
  try {
    const saved = localStorage.getItem('mazo-maps-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme, persist = true) {
  root.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#f6f8fa');
  themeButton?.setAttribute('aria-pressed', String(theme === 'dark'));
  themeButton?.setAttribute(
    'aria-label',
    `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
  );
  if (persist) {
    try {
      localStorage.setItem('mazo-maps-theme', theme);
    } catch {}
  }
  if (map)
    loadStyle(theme)
      .then((style) => {
        if (root.dataset.theme === theme) {
          fullMapStyle = style;
          fullStyleLoaded = true;
          map.setStyle(style, { diff: true });
        }
      })
      .catch((error) => showMapError(error, false));
}

async function loadStyle(theme) {
  if (!styleCache.has(theme)) {
    const request = fetch(new URL(mapConfig.styles[theme], siteRoot))
      .then((response) => {
        if (!response.ok) throw new Error('Map style could not be loaded.');
        return response.json();
      })
      .catch((error) => {
        styleCache.delete(theme);
        throw error;
      });
    styleCache.set(theme, request);
  }
  const template = await styleCache.get(theme);
  return JSON.parse(
    JSON.stringify(template).replaceAll(
      '__MAZO_SITE_ROOT__',
      siteRoot.replace(/\/$/, ''),
    ),
  );
}

function initialMapStyle(style) {
  const initialLayerIds = new Set(['background', 'land', 'water-fill']);
  return {
    ...style,
    sources: { base: style.sources.base },
    layers: style.layers.filter((layer) => initialLayerIds.has(layer.id)),
  };
}

function upgradeToFullStyle() {
  if (!map || !fullMapStyle || fullStyleLoaded || fullStyleUpgradeQueued) return;
  fullStyleUpgradeQueued = true;
  const upgrade = () => {
    fullStyleUpgradeQueued = false;
    if (!map || fullStyleLoaded) return;
    fullStyleLoaded = true;
    map.setStyle(fullMapStyle, { diff: true });
  };
  // Paint the geographic frame before parsing nationwide road and label data.
  if ('requestIdleCallback' in window)
    window.requestIdleCallback(upgrade, { timeout: 350 });
  else setTimeout(upgrade, 0);
}

function startExplorerWhenReady(maplibre) {
  const start = () => {
    if (!map || explorerStarted) return;
    if (!map.isStyleLoaded()) {
      requestAnimationFrame(start);
      return;
    }
    explorerStarted = true;
    import('./explorer.js')
      .then(({ setupExplorer }) => setupExplorer(map, maplibre, siteRoot))
      .then(upgradeToFullStyle)
      .catch(() => {
        showNotice('Search and directions could not be loaded.');
        upgradeToFullStyle();
      });
  };
  requestAnimationFrame(start);
}

function showNotice(message, blocking = false) {
  if (!mapStatus) return;
  mapStatus.classList.remove('is-hidden');
  mapStatus.classList.toggle('is-warning', !blocking);
  mapStatus.classList.toggle('is-error', blocking);
  mapStatus.replaceChildren();
  const mark = document.createElement('span');
  mark.className = 'map-error-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '!';
  const text = document.createElement('span');
  text.textContent = message;
  mapStatus.append(mark, text);
}

function showMapError(error, blocking = true) {
  if (mapTest)
    globalThis.__mazoMapError =
      error instanceof Error ? error.message : String(error ?? 'Map error');
  if (blocking) {
    if (mapFrame) mapFrame.dataset.state = 'error';
    mapNode?.setAttribute('aria-busy', 'false');
  }
  showNotice(
    blocking
      ? 'The map is unavailable.'
      : 'Some map data or labels are unavailable.',
    blocking,
  );
}

async function loadDataManifest() {
  try {
    const response = await fetch(
      new URL('./data/sri-lanka/manifest.json', siteRoot),
    );
    if (!response.ok) return;
    const manifest = await response.json();
    const status = document.querySelector('#release-status');
    if (status) status.textContent = `Overture ${manifest.release} · Sri Lanka`;
  } catch {}
}

function revealMap() {
  if (firstFrame || !map.getLayer('land')) return;
  const features = map.queryRenderedFeatures({
    layers: ['land', 'water-fill', 'road-lines'],
  });
  if (!features.length) return;
  firstFrame = true;
  mapStatus?.classList.add('is-hidden');
  mapNode?.setAttribute('aria-busy', 'false');
  if (mapFrame) mapFrame.dataset.state = 'ready';
  if (mapTest) globalThis.__mazoMapTimings.firstRender = performance.now();
  map.off('render', revealMap);
  loadDataManifest();
}

function updateCoordinates() {
  const output = document.querySelector('#map-coordinates');
  if (!output || !map) return;
  const { lng, lat } = map.getCenter();
  output.textContent = `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'} / ${Math.abs(lng).toFixed(3)}° ${lng < 0 ? 'W' : 'E'}`;
}

function chooseCity(city) {
  if (!map) return;
  if (city === 'island')
    map.fitBounds(mapConfig.bounds, {
      padding: 36,
      bearing: 0,
      pitch: 0,
      duration: reducedMotion ? 0 : 650,
    });
  else if (cityViews[city])
    map.flyTo({
      ...cityViews[city],
      bearing: 0,
      pitch: 0,
      duration: reducedMotion ? 0 : 1000,
    });
  else return;
  if (citySelect) citySelect.value = city;
  document
    .querySelectorAll('[data-city]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.city === city)),
    );
}

function updateFullscreen() {
  const button = document.querySelector('#map-fullscreen');
  const expanded = Boolean(
    document.fullscreenElement || mapFrame?.classList.contains('is-expanded'),
  );
  button?.setAttribute('aria-pressed', String(expanded));
  button?.setAttribute(
    'aria-label',
    expanded ? 'Exit fullscreen' : 'Enter fullscreen',
  );
  map?.resize();
}

async function toggleFullscreen() {
  if (!mapFrame) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (mapFrame.requestFullscreen) await mapFrame.requestFullscreen();
    else {
      const expanded = mapFrame.classList.toggle('is-expanded');
      document.body.classList.toggle('map-expanded', expanded);
      updateFullscreen();
    }
  } catch {
    showNotice('Fullscreen is unavailable in this browser.');
  }
}

function locate() {
  if (!map) return;
  if (!navigator.geolocation)
    return showNotice('Location is unavailable in this browser.');
  const button = document.querySelector('#map-locate');
  if (button) button.disabled = true;
  button?.setAttribute('aria-busy', 'true');
  const finish = () => {
    if (button) button.disabled = false;
    button?.setAttribute('aria-busy', 'false');
  };
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { longitude, latitude } = position.coords;
      const [west, south, east, north] = mapConfig.bounds;
      if (
        longitude < west ||
        longitude > east ||
        latitude < south ||
        latitude > north
      )
        showNotice('Your location is outside this map’s Sri Lanka coverage.');
      else
        map.flyTo({
          center: [longitude, latitude],
          zoom: 14,
          duration: reducedMotion ? 0 : 1000,
        });
      finish();
    },
    (error) => {
      showNotice(
        error.code === 1
          ? 'Location access was not allowed.'
          : 'Your location could not be found.',
      );
      finish();
    },
    { timeout: 10000, maximumAge: 60000 },
  );
}

async function initializeMap() {
  if (!mapNode) return;
  mapNode.setAttribute('aria-busy', 'true');
  if (mapTest)
    globalThis.__mazoMapTimings = {
      started: performance.now(),
      firstRender: null,
      loaded: null,
    };
  try {
    const [maplibre, pmtiles, style] = await Promise.all([
      import('../vendor/maplibre-gl.mjs'),
      import('../vendor/pmtiles.mjs'),
      loadStyle(root.dataset.theme),
    ]);
    const protocol = new pmtiles.Protocol();
    for (const source of Object.values(style.sources)) {
      if (!source.url?.startsWith('pmtiles://')) continue;
      const url = source.url.slice('pmtiles://'.length);
      protocol.add(
        new pmtiles.PMTiles(createArchiveSource(pmtiles.FetchSource, url)),
      );
    }
    maplibre.addProtocol('pmtiles', protocol.tile);
    fullMapStyle = style;
    map = new maplibre.Map({
      container: mapNode,
      style: initialMapStyle(style),
      bounds: mapConfig.bounds,
      fitBoundsOptions: { padding: 36 },
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      attributionControl: { compact: true },
      pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      crossSourceCollisions: true,
      renderWorldCopies: false,
      maxTileCacheSize: window.matchMedia('(max-width: 600px)').matches ? 24 : 48,
      cooperativeGestures: false,
      fadeDuration: reducedMotion ? 0 : 150,
    });
    map.addControl(
      new maplibre.NavigationControl({ visualizePitch: true }),
      'top-right',
    );
    map.on('styleimagemissing', (event) => addPlaceIcon(event.id));
    map.on('style.load', () => {
      for (const category of Object.keys(placeArtwork)) addPlaceIcon(`mazo-poi-${category}`);
    });
    map.on('render', revealMap);
    map.on('load', () => {
      revealMap();
      if (mapTest) globalThis.__mazoMapTimings.loaded = performance.now();
    });
    map.on('moveend', updateCoordinates);
    map.on('error', (event) =>
      showMapError(event.error ?? event.message, false),
    );
    map.on('dragstart', () => {
      if (citySelect) citySelect.value = '';
      document
        .querySelectorAll('[data-city]')
        .forEach((button) => button.setAttribute('aria-pressed', 'false'));
    });
    startExplorerWhenReady(maplibre);
    if (mapTest) globalThis.__mazoMap = map;
    if (root.dataset.theme !== style.metadata?.['mazo:theme'])
      applyTheme(root.dataset.theme, false);
    updateCoordinates();
  } catch (error) {
    showMapError(error);
  }
}

applyTheme(preferredTheme(), false);
themeButton?.addEventListener('click', () =>
  applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'),
);
citySelect?.addEventListener('change', (event) =>
  chooseCity(event.target.value),
);
document
  .querySelectorAll('[data-city]')
  .forEach((button) =>
    button.addEventListener('click', () => chooseCity(button.dataset.city)),
  );
document
  .querySelector('#map-reset')
  ?.addEventListener('click', () => chooseCity('island'));
document
  .querySelector('#map-fullscreen')
  ?.addEventListener('click', toggleFullscreen);
document.querySelector('#map-locate')?.addEventListener('click', locate);
document.addEventListener('fullscreenchange', updateFullscreen);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  if (event.key === 'Escape' && mapFrame?.classList.contains('is-expanded')) {
    mapFrame.classList.remove('is-expanded');
    document.body.classList.remove('map-expanded');
    updateFullscreen();
  }
});
initializeMap();


// Automatic compact/half sheet, with no manual size controls.
const communitySheet = document.querySelector('#contribution-panel');
if (communitySheet) {
  const heading = communitySheet.querySelector('header');
  const setSheet = state => { communitySheet.dataset.sheet = state; };
  setSheet('half');
  communitySheet.addEventListener('focusin', () => setSheet('half'));
  communitySheet.addEventListener('click', () => {
    if (communitySheet.dataset.sheet === 'compact') setSheet('half');
  });
  document.addEventListener('mazo:community-map-pick', () => setSheet('compact'));
  document.addEventListener('mazo:community-open', () => setSheet('half'));
  let startY = null;
  heading?.addEventListener('touchstart', event => { startY = event.touches[0].clientY; }, { passive: true });
  heading?.addEventListener('touchend', event => {
    if (startY === null) return;
    const distance = event.changedTouches[0].clientY - startY;
    startY = null;
    if (Math.abs(distance) >= 45) setSheet(distance > 0 ? 'compact' : 'half');
  }, { passive: true });
}
