import { mapConfig } from './config.js';

const ROUTING_ORIGIN = 'https://routing.openstreetmap.de';
const ROUTE_CACHE_NAME = 'mazo-routes-v1';
const ROUTE_CACHE_TTL = 6 * 60 * 60 * 1000;
const REQUEST_GAP_MS = 1000;
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const MODES = Object.freeze({
  car: { service: 'routed-car', profile: 'driving', label: 'Driving' },
  bike: { service: 'routed-bike', profile: 'driving', label: 'Cycling' },
  foot: { service: 'routed-foot', profile: 'driving', label: 'Walking' },
});
let lastRequestAt = 0;
const pendingRoutes = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url, signal) {
  const request = async () => {
    let localTimestamp = 0;
    try { localTimestamp = Number(localStorage.getItem('mazo-route-request-at') || 0); } catch {}
    const previous = Math.max(lastRequestAt, localTimestamp);
    await delay(Math.max(0, REQUEST_GAP_MS - (Date.now() - previous)));
    lastRequestAt = Date.now();
    try { localStorage.setItem('mazo-route-request-at', String(lastRequestAt)); } catch {}
    return fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'default',
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
  };

  if (navigator.locks?.request)
    return navigator.locks.request('mazo-osrm-request-gap', request);
  return request();
}

async function readBoundedText(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new Error('This route is too detailed to display.');
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { text: chunks.join(''), bytes };
}

export function routeUrl(origin, destination, mode) {
  const profile = MODES[mode];
  if (!profile) throw new Error('Choose driving, cycling or walking.');
  const coordinates = [origin, destination]
    .map(([longitude, latitude]) => `${longitude},${latitude}`)
    .join(';');
  return new URL(
    `/${profile.service}/route/v1/${profile.profile}/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=false&generate_hints=false`,
    ROUTING_ORIGIN,
  ).href;
}

export function routeHttpErrorMessage(status) {
  if (status === 429) return 'Routing is busy. Wait a moment and try again.';
  if (status >= 500) return 'The routing service is temporarily unavailable.';
  return `The routing service returned an error (${status}).`;
}

export function parseRoutePayload(payload) {
  if (payload.code === 'NoSegment')
    throw new Error('A place is too far from a routable road. Choose a nearby place.');
  if (payload.code === 'NoRoute' || !payload.routes?.length)
    throw new Error('No road route was found between these places.');
  if (payload.code !== 'Ok')
    throw new Error('The routing service could not calculate this route.');
  const route = payload.routes[0];
  if (
    route.geometry?.type !== 'LineString' ||
    !Array.isArray(route.geometry.coordinates) ||
    route.geometry.coordinates.length < 2 ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration)
  )
    throw new Error('The routing service returned an incomplete route.');
  return route;
}

async function readCachedRoute(url) {
  try {
    const cache = await caches.open(ROUTE_CACHE_NAME);
    const response = await cache.match(url);
    if (!response) return null;
    const savedAt = Number(response.headers.get('x-mazo-saved-at'));
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > ROUTE_CACHE_TTL) {
      await cache.delete(url);
      return null;
    }
    return response.json();
  } catch {
    return null;
  }
}

async function saveRoute(url, route) {
  try {
    const cache = await caches.open(ROUTE_CACHE_NAME);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.set('x-mazo-saved-at', String(Date.now()));
    await cache.put(
      url,
      new Response(JSON.stringify(route), { headers }),
    );
  } catch {
    // Private browsing or a full storage quota must not prevent routing.
  }
}

function assertCoordinate(point) {
  const [longitude, latitude] = point;
  const [west, south, east, north] = mapConfig.bounds;
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}

async function fetchRoute(url) {
  const cached = await readCachedRoute(url);
  if (!navigator.onLine) {
    if (cached) return { route: cached, source: 'offline-cache' };
    throw new Error('You are offline and this route has not been saved on this device.');
  }
  if (cached) return { route: cached, source: 'cache' };

  if (!pendingRoutes.has(url)) {
    const task = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await rateLimitedFetch(url, controller.signal);
        if (!response.ok) throw new Error(routeHttpErrorMessage(response.status));
        const { text, bytes: responseBytes } = await readBoundedText(response);
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error('The routing service returned an invalid response.');
        }
        const route = parseRoutePayload(payload);
        route.responseBytes = responseBytes;
        await saveRoute(url, route);
        return { route, source: 'network' };
      } catch (error) {
        if (error.name === 'AbortError')
          throw new Error('The routing service took too long to respond. Try again.');
        if (error instanceof TypeError)
          throw new Error('The routing service could not be reached. Check your connection.');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })();
    pendingRoutes.set(url, task);
    task.finally(() => pendingRoutes.delete(url)).catch(() => {});
  }
  return pendingRoutes.get(url);
}

export function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} hr ${minutes % 60} min` : `${minutes} min`;
}

export function describeStep(step) {
  const maneuver = step.maneuver || {};
  const modifier = maneuver.modifier
    ? ` ${maneuver.modifier}`
    : '';
  const action = {
    depart: 'Start',
    arrive: 'Arrive',
    turn: `Turn${modifier}`,
    'new name': 'Continue',
    'continue': `Continue${modifier}`,
    merge: `Merge${modifier}`,
    'on ramp': 'Take the ramp',
    'off ramp': 'Take the exit',
    fork: `Keep${modifier}`,
    'end of road': `Turn${modifier}`,
    roundabout: 'Enter the roundabout',
    rotary: 'Enter the roundabout',
    'roundabout turn': `At the roundabout, turn${modifier}`,
    'roundabout exit': `Take roundabout exit ${maneuver.exit || ''}`.trim(),
    'notification': 'Continue',
  }[maneuver.type] || 'Continue';
  const road = step.name || maneuver.rotary_name;
  return road && !['Start', 'Arrive'].includes(action)
    ? `${action} onto ${road}`
    : action;
}

function clearRoute(map, data) {
  data.feature = null;
  data.endpoints = null;
  map.getSource('mazo-route')?.setData({
    type: 'FeatureCollection',
    features: [],
  });
  map.getSource('mazo-route-endpoints')?.setData({
    type: 'FeatureCollection',
    features: [],
  });
}

function installRouteLayers(map, data) {
  if (!map.getSource('mazo-route')) {
    map.addSource('mazo-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: data.feature ? [data.feature] : [] },
    });
  }
  if (!map.getSource('mazo-route-endpoints')) {
    map.addSource('mazo-route-endpoints', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: data.endpoints || [] },
    });
  }
  const dark = document.documentElement.dataset.theme === 'dark';
  const beforeId = map.getLayer('destination-names') ? 'destination-names' : undefined;
  if (!map.getLayer('mazo-route-casing')) {
    map.addLayer({
      id: 'mazo-route-casing',
      type: 'line',
      source: 'mazo-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': dark ? '#0d1117' : '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 12, 8, 16, 11],
        'line-opacity': 0.9,
      },
    }, beforeId);
  }
  if (!map.getLayer('mazo-route-line')) {
    map.addLayer({
      id: 'mazo-route-line',
      type: 'line',
      source: 'mazo-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': dark ? '#58a6ff' : '#0969da',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 4.5, 16, 6],
        'line-opacity': 0.98,
      },
    }, beforeId);
  }
  if (!map.getLayer('mazo-route-endpoint-halo')) {
    map.addLayer({
      id: 'mazo-route-endpoint-halo',
      type: 'circle',
      source: 'mazo-route-endpoints',
      paint: {
        'circle-radius': 8,
        'circle-color': dark ? '#0d1117' : '#ffffff',
        'circle-stroke-color': dark ? '#58a6ff' : '#0969da',
        'circle-stroke-width': 3,
      },
    }, beforeId);
  }
  if (data.feature) map.getSource('mazo-route').setData({
    type: 'FeatureCollection',
    features: [data.feature],
  });
  if (data.endpoints) map.getSource('mazo-route-endpoints').setData({
    type: 'FeatureCollection',
    features: data.endpoints,
  });
}

export function setupRouting(map, elements, resolveLocation) {
  const data = { feature: null };
  const status = elements.status;
  const result = elements.result;
  const stepsList = elements.steps;
  const submitButton = elements.submit;
  const modeSelect = elements.mode;

  map.on('style.load', () => installRouteLayers(map, data));
  installRouteLayers(map, data);

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fromName = elements.from.value.trim();
    const toName = elements.to.value.trim();
    const originFeature = resolveLocation(fromName);
    const destinationFeature = resolveLocation(toName);
    const mode = modeSelect.value;
    result.hidden = true;
    clearRoute(map, data);
    elements.panel.classList.remove('has-route');
    status.className = 'route-status';
    if (!originFeature || !destinationFeature) {
      status.textContent = 'Choose both places from the suggestions.';
      return;
    }
    const origin = originFeature.geometry.coordinates;
    const destination = destinationFeature.geometry.coordinates;
    if (!assertCoordinate(origin) || !assertCoordinate(destination)) {
      status.textContent = 'Both places must be inside Sri Lanka.';
      return;
    }
    if (origin[0] === destination[0] && origin[1] === destination[1]) {
      status.textContent = 'Choose two different places.';
      return;
    }

    submitButton.disabled = true;
    status.textContent = 'Calculating route…';
    status.classList.add('is-loading');
    const requestedAt = performance.now();
    const url = routeUrl(origin, destination, mode);
    try {
      const { route, source } = await fetchRoute(url);
      data.feature = {
        type: 'Feature',
        properties: { profile: mode, distance: route.distance, duration: route.duration },
        geometry: route.geometry,
      };
      data.endpoints = [
        { type: 'Feature', properties: { role: 'origin' }, geometry: { type: 'Point', coordinates: origin } },
        { type: 'Feature', properties: { role: 'destination' }, geometry: { type: 'Point', coordinates: destination } },
      ];
      map.getSource('mazo-route')?.setData({
        type: 'FeatureCollection',
        features: [data.feature],
      });
      map.getSource('mazo-route-endpoints')?.setData({
        type: 'FeatureCollection',
        features: data.endpoints,
      });
      const modeInfo = MODES[mode];
      const padding = window.matchMedia('(max-width: 600px)').matches
        ? { top: 128, right: 20, bottom: 340, left: 20 }
        : { top: 32, right: 360, bottom: 32, left: 32 };
      map.fitBounds(route.geometry.coordinates.reduce(
        (bounds, coordinate) => [
          [Math.min(bounds[0][0], coordinate[0]), Math.min(bounds[0][1], coordinate[1])],
          [Math.max(bounds[1][0], coordinate[0]), Math.max(bounds[1][1], coordinate[1])],
        ],
        [[Infinity, Infinity], [-Infinity, -Infinity]],
      ), {
        padding,
        maxZoom: 14,
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500,
      });
      elements.distance.textContent = formatDistance(route.distance);
      elements.duration.textContent = formatDuration(route.duration);
      elements.modeLabel.textContent = modeInfo.label;
      stepsList.replaceChildren();
      for (const step of route.legs?.[0]?.steps || []) {
        const item = document.createElement('li');
        item.textContent = describeStep(step);
        const detail = document.createElement('span');
        detail.textContent = formatDistance(step.distance || 0);
        item.append(detail);
        stepsList.append(item);
      }
      result.hidden = false;
      elements.panel.classList.add('has-route');
      const timing = Math.round(performance.now() - requestedAt);
      status.classList.remove('is-loading');
      status.classList.add('is-success');
      status.textContent = source === 'offline-cache'
        ? 'Saved route loaded · offline'
        : source === 'cache'
          ? 'Saved route loaded'
          : `Route ready in ${(timing / 1000).toFixed(1)} s`;
      elements.panel.dataset.routeSource = source;
      if (window.__mazoRouteTest) {
        window.__mazoRouteTest({ provider: 'FOSSGIS OSRM', profile: mode, distance: route.distance, duration: route.duration, steps: route.legs?.[0]?.steps?.length || 0, responseBytes: route.responseBytes || 0, coordinates: route.geometry.coordinates.length, source, elapsedMs: timing });
      }
    } catch (error) {
      status.classList.remove('is-loading');
      status.classList.add('is-error');
      status.textContent = error.message || 'Unable to calculate a route. Try again.';
    } finally {
      submitButton.disabled = false;
    }
  });

  elements.swap.addEventListener('click', () => {
    const from = elements.from.value;
    elements.from.value = elements.to.value;
    elements.to.value = from;
    elements.from.focus();
  });
  elements.clear.addEventListener('click', () => {
    clearRoute(map, data);
    result.hidden = true;
    elements.panel.classList.remove('has-route');
    status.className = 'route-status';
    status.textContent = 'Route cleared.';
  });
  elements.close.addEventListener('click', () => elements.toggle.click());

  // A short drag moves the mobile sheet; a downward swipe closes it.
  elements.drag.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    elements.drag.setPointerCapture(event.pointerId);
    elements.panel.dataset.dragStart = String(event.clientY);
    elements.panel.style.transition = 'none';
  });
  elements.drag.addEventListener('pointermove', (event) => {
    if (!elements.panel.hasPointerCapture(event.pointerId)) return;
    const start = Number(elements.panel.dataset.dragStart);
    elements.panel.style.transform = `translateY(${Math.max(-60, Math.min(240, event.clientY - start))}px)`;
  });
  elements.drag.addEventListener('pointerup', (event) => {
    if (!elements.panel.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientY - Number(elements.panel.dataset.dragStart);
    elements.panel.releasePointerCapture(event.pointerId);
    elements.panel.style.transition = '';
    if (delta > 90) {
      elements.panel.style.transform = '';
      elements.toggle.click();
    } else {
      elements.panel.style.transform = delta < -40 ? 'translateY(-60px)' : '';
    }
  });
  elements.drag.addEventListener('pointercancel', () => {
    elements.panel.style.transition = '';
    elements.panel.style.transform = '';
  });

  return {
    clear() { clearRoute(map, data); result.hidden = true; },
    cacheName: ROUTE_CACHE_NAME,
  };
}
