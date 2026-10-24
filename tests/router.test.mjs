import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../assets/js/router.js';
const a = [79.9, 6.9],
  b = [79.901, 6.9],
  c = [79.902, 6.9];
const edge = (from, to, geometry) => ({
  from,
  to,
  geometry,
  road: from + to,
  speedKph: 30,
});
test('routing follows connected directed roads, preserves shape and rejects unreachable reverse travel', () => {
  const router = new Router({
    coverage: 'fixture',
    nodes: { a, b, c, x: [79.903, 6.9] },
    edges: [edge('a', 'b', [a, [79.9005, 6.9001], b]), edge('b', 'c', [b, c])],
  });
  const route = router.route(a, c);
  assert.equal(route.roads.length, 2);
  assert.ok(route.distance > 220);
  assert.equal(route.geometry.coordinates.length, 4);
  assert.throws(
    () => router.route(c, a),
    (e) => e.code === 'UNREACHABLE',
  );
  assert.throws(
    () => router.route([80, 8], a),
    (e) => e.code === 'NO_SNAP',
  );
});
test('segment-interior snapping respects directed travel and does not route in straight lines', () => {
  const router = new Router({
    coverage: 'fixture',
    nodes: { a, b, c },
    edges: [edge('a', 'b', [a, b]), edge('b', 'c', [b, c])],
  });
  const result = router.route([79.9002, 6.90001], [79.9008, 6.90001]);
  assert.ok(result.distance > 60 && result.distance < 70);
  assert.ok(Math.abs(result.geometry.coordinates[0][0] - 79.9002) < 1e-8);
  assert.throws(
    () => router.route([79.9008, 6.9], [79.9002, 6.9]),
    (e) => e.code === 'UNREACHABLE',
  );
});
