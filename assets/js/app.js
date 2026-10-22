import { mapConfig } from './config.js';

const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const mapStatus = document.querySelector('#map-status');
const mapNode = document.querySelector('#map');
let map;

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
  if (map) map.setStyle(mapConfig.styles[theme]);
}

applyTheme(preferredTheme(), false);
themeButton?.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

async function initializeMap() {
  if (!mapNode) return;
  try {
    const maplibre = await import('https://unpkg.com/maplibre-gl@6.15.0/dist/maplibre-gl.mjs');
    map = new maplibre.Map({
      container: mapNode,
      style: mapConfig.styles[root.dataset.theme],
      center: mapConfig.center,
      zoom: mapConfig.zoom,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      attributionControl: true,
      cooperativeGestures: true
    });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('load', () => mapStatus?.classList.add('is-hidden'));
    map.on('error', () => {
      if (mapStatus) {
        mapStatus.classList.remove('is-hidden');
        mapStatus.innerHTML = '<span class="map-error-mark" aria-hidden="true">!</span><span>Map tiles could not load. Check your connection or try again.</span>';
      }
    });
    document.querySelector('#map-reset')?.addEventListener('click', () => {
      map?.flyTo({ center: mapConfig.center, zoom: mapConfig.zoom, bearing: 0, pitch: 0, duration: 650 });
    });
  } catch {
    if (mapStatus) {
      mapStatus.innerHTML = '<span class="map-error-mark" aria-hidden="true">!</span><span>The interactive map could not start. The rest of the project page remains available.</span>';
    }
  }
}

initializeMap();
