import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStep, formatDistance, formatDuration, parseRoutePayload, routeHttpErrorMessage, routeUrl } from '../assets/js/routing.js';

const origin = [79.84868, 6.93548];
const destination = [80.6336, 7.2906];

test('routing profiles use the live FOSSGIS OSRM paths without a browser key', () => {
  const profiles = {
    car: 'routed-car',
    bike: 'routed-bike',
    foot: 'routed-foot',
  };
  for (const [mode, service] of Object.entries(profiles)) {
    const url = new URL(routeUrl(origin, destination, mode));
    assert.equal(url.origin, 'https://routing.openstreetmap.de');
    assert.ok(url.pathname.startsWith(`/${service}/route/v1/driving/`));
    assert.match(url.pathname, /79\.84868,6\.93548;80\.6336,7\.2906$/);
    assert.equal(url.searchParams.get('geometries'), 'geojson');
    assert.equal(url.searchParams.get('steps'), 'true');
    assert.equal(url.searchParams.get('alternatives'), 'false');
    assert.doesNotMatch(url.href, /key=|token=|api[_-]?key/i);
  }
  assert.throws(() => routeUrl(origin, destination, 'plane'), /Choose driving/);
});

test('distance and duration use route-service measurements', () => {
  assert.equal(formatDistance(438), '438 m');
  assert.equal(formatDistance(114600), '114.6 km');
  assert.equal(formatDuration(0), '1 min');
  assert.equal(formatDuration(7930), '2 hr 12 min');
});

test('turn-by-turn instructions use actual OSRM maneuver and road names', () => {
  assert.equal(describeStep({ maneuver: { type: 'depart' }, name: '' }), 'Start');
  assert.equal(describeStep({ maneuver: { type: 'turn', modifier: 'right' }, name: 'Kandy Road' }), 'Turn right onto Kandy Road');
  assert.match(describeStep({ maneuver: { type: 'roundabout exit', exit: 2 }, name: 'A1' }), /exit 2 onto A1/);
  assert.equal(describeStep({ maneuver: { type: 'arrive' }, name: '' }), 'Arrive');
});

test('routing API failures and unreachable routes have actionable messages', () => {
  assert.match(routeHttpErrorMessage(429), /busy/);
  assert.match(routeHttpErrorMessage(503), /temporarily unavailable/);
  assert.match(routeHttpErrorMessage(403), /403/);
  assert.throws(() => parseRoutePayload({ code: 'NoRoute', routes: [] }), /No road route/);
  assert.throws(() => parseRoutePayload({ code: 'NoSegment', routes: [] }), /too far/);
  assert.throws(() => parseRoutePayload({ code: 'Ok', routes: [{ distance: 2, duration: 1 }] }), /incomplete/);
});
