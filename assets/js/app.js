import { mapConfig, cityViews } from './config.js';
import { createArchiveSource } from './archive-source.js';
import { fetchContributions, prepareContributions } from './contributions.js';

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
let geographicEditor=null;
let firstFrame = false;
let contributionBundle = null;

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
    ?.setAttribute('content', theme === 'dark' ? '#111813' : '#f7f8f4');
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
        if (root.dataset.theme === theme) map.setStyle(style);
      })
      .catch((error) => showMapError(error, false));
}

async function loadStyle(theme) {
  if(new URLSearchParams(location.search).get('dataset')==='canonical'){
    const offline=new URLSearchParams(location.search).has('offline');
    const response=await fetch(new URL(`data/mazo/${offline?'offline-':''}${theme}.json`,siteRoot));
    if(!response.ok)throw new Error('Canonical sample unavailable');
    const {prepareCanonicalStyle}=await import('./canonical-records.js');
    const style=prepareCanonicalStyle(await response.json(),new URL('data/mazo/',siteRoot));
    if(style.glyphs)style.glyphs=style.glyphs.replace('__MAZO_SITE_ROOT__',siteRoot.replace(/\/$/,''));
    return style;
  }
  if(geographicEditor?.active) return geographicEditor.style(theme);
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
  return prepareContributions(
    JSON.parse(
      JSON.stringify(template).replaceAll(
        '__MAZO_SITE_ROOT__',
        siteRoot.replace(/\/$/, ''),
      ),
    ),
    contributionBundle,
  );
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
  if(firstFrame)return;
  const canonical=new URLSearchParams(location.search).get('dataset')==='canonical';
  if(!canonical&&!map.getLayer('land'))return;
  const features = map.queryRenderedFeatures({
    layers: ['land','water-fill','road-lines','building','place-points'].filter(id=>map.getLayer(id)),
  });
  if (!features.length) return;
  firstFrame = true;
  mapStatus?.classList.add('is-hidden');
  mapNode?.setAttribute('aria-busy', 'false');
  if (mapFrame) mapFrame.dataset.state = 'ready';
  if (mapTest) globalThis.__mazoMapTimings.firstRender = performance.now();
  map.off('render', revealMap);
  if(canonical){const status=document.querySelector('#release-status');if(status)status.textContent='Independent Mazo sample · incomplete coverage';return;}
  loadDataManifest();
  fetchContributions(siteRoot)
    .then((bundle) => {
      if (!bundle) return;
      contributionBundle = bundle;
      if (bundle.manifest.records) applyTheme(root.dataset.theme, false);
    })
    .catch((error) => {
      if (mapTest) globalThis.__mazoContributionError = error.message;
      showNotice('Community changes are temporarily unavailable.');
    });
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
    map = new maplibre.Map({
      container: mapNode,
      style,
      bounds: new URLSearchParams(location.search).get('dataset')==='canonical'?[79.83,6.915,79.86,6.93]:mapConfig.bounds,
      fitBoundsOptions: { padding: 36 },
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      attributionControl: true,
      cooperativeGestures: true,
      fadeDuration: reducedMotion ? 0 : 150,
    });
    map.addControl(
      new maplibre.NavigationControl({ visualizePitch: true }),
      'top-right',
    );
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
    if (mapTest) globalThis.__mazoMap = map;
    import('./explore.js').then(({mountExplore})=>mountExplore(map,siteRoot)).catch(()=>{});
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

document.querySelector('#editor-toggle')?.addEventListener('click',async()=>{
 if(!map||geographicEditor?.active)return;
 try{
  const {mountEditor}=await import('./editor.js');
  geographicEditor=await mountEditor(map,siteRoot);
  geographicEditor.onClose=()=>{geographicEditor=null;applyTheme(root.dataset.theme,false);};
 }catch(error){showNotice('Editor unavailable: '+error.message);}
});

document.querySelector('#offline-download')?.addEventListener('click',async()=>{
 try{
  const {OfflineManager}=await import('./offline.js');const manager=new OfflineManager(siteRoot);
  const button=document.querySelector('#offline-download');button.disabled=true;
  try{await manager.download({onProgress:({done,total})=>{button.textContent=`Downloading ${Math.round(done/total*100)}%`;}});button.textContent='Offline sample ready';document.querySelector('#offline-open').hidden=false;}
  finally{button.disabled=false;}
 }catch(error){showNotice('Offline download: '+error.message);}
});
document.querySelector('#offline-remove')?.addEventListener('click',async()=>{
 try{const {OfflineManager}=await import('./offline.js');await new OfflineManager(siteRoot).remove();showNotice('Offline sample removed.');}catch(error){showNotice(error.message);}
});
