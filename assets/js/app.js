import { mapConfig } from './config.js';

const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const mapStatus = document.querySelector('#map-status');
const mapNode = document.querySelector('#map');
let map;
const siteRoot = new URL('../../', import.meta.url).href;

function preferredTheme() {
  try {
    const saved = localStorage.getItem('mazo-maps-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Storage may be disabled; follow the system preference. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, persist = true) {
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11191c' : '#f5f7f8');
  themeButton?.setAttribute('aria-pressed', String(theme === 'dark'));
  themeButton?.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  if (persist) {
    try { localStorage.setItem('mazo-maps-theme', theme); } catch { /* Theme remains active for this page view. */ }
  }
  if (map) loadStyle(theme).then(style => map?.setStyle(style)).catch(showMapError);
}

applyTheme(preferredTheme(), false);
themeButton?.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

async function loadStyle(theme) {
  const response = await fetch(new URL(mapConfig.styles[theme], siteRoot), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Map style could not be loaded.');
  const template = await response.json();
  return JSON.parse(JSON.stringify(template).replaceAll('__MAZO_SITE_ROOT__', siteRoot.replace(/\/$/, '')));
}

function showMapError(error) {
  if (new URLSearchParams(location.search).has('maptest')) {
    globalThis.__mazoMapError = error instanceof Error ? error.message : String(error ?? 'Map error');
  }
  if (!mapStatus) return;
  mapStatus.classList.remove('is-hidden');
  mapStatus.innerHTML = '<span class="map-error-mark" aria-hidden="true">!</span><span>Map data could not load. The rest of the project page remains available.</span>';
}

async function loadDataManifest() {
  try {
    const response = await fetch(new URL('./data/batticaloa/manifest.json', siteRoot), { cache: 'no-cache' });
    if (!response.ok) return;
    const manifest = await response.json();
    const status = document.querySelector('#release-status');
    if (status) status.textContent = `Overture ${manifest.release} · ${manifest.bbox.join(', ')}`;
  } catch { /* The hosted map remains usable if its small build manifest is unavailable. */ }
}

async function initializeMap() {
  if (!mapNode) return;
  try {
    const [maplibre] = await Promise.all([
      import('https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl.mjs'),
      import('https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js')
    ]);
    const pmtiles = globalThis.pmtiles;
    if (!pmtiles?.Protocol) throw new Error('PMTiles protocol library did not load.');
    maplibre.addProtocol('pmtiles', new pmtiles.Protocol({ metadata: true }).tile);
    const style = await loadStyle(root.dataset.theme);
    map = new maplibre.Map({
      container: mapNode,
      style,
      center: mapConfig.center,
      zoom: mapConfig.zoom,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      attributionControl: true,
      cooperativeGestures: true,
      maxBounds: mapConfig.bounds
    });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('load', () => mapStatus?.classList.add('is-hidden'));
    map.on('error', event => showMapError(event.error ?? event.message));
    if (new URLSearchParams(location.search).has('maptest')) globalThis.__mazoMap = map;
    document.querySelector('#map-reset')?.addEventListener('click', () => {
      map?.flyTo({ center: mapConfig.center, zoom: mapConfig.zoom, bearing: 0, pitch: 0, duration: 650 });
    });
    loadDataManifest();
  } catch (error) {
    showMapError(error);
  }
}

initializeMap();
