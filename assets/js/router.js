import { distance, MazoError } from '../../sdk/index.js';
function project(position, geometry) {
  let best = null,
    along = 0;
  const scale = Math.cos((position[1] * Math.PI) / 180);
  for (let i = 0; i < geometry.length - 1; i++) {
    const a = geometry[i],
      b = geometry[i + 1],
      dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1],
      den = dx * dx + dy * dy;
    const t = den
      ? Math.max(
          0,
          Math.min(
            1,
            ((position[0] - a[0]) * scale * dx + (position[1] - a[1]) * dy) /
              den,
          ),
        )
      : 0;
    const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      meters = distance(position, point),
      length = distance(a, b);
    if (!best || meters < best.distance)
      best = {
        position: point,
        distance: meters,
        index: i,
        t,
        along: along + t * length,
      };
    along += length;
  }
  return { ...best, total: along };
}
function slice(geometry, a, b) {
  const result = [a.position];
  for (let i = a.index + 1; i <= b.index; i++) result.push(geometry[i]);
  result.push(b.position);
  return result;
}
export class Router {
  constructor(graph) {
    this.graph = graph;
    this.edges = graph.edges.map((edge) => {
      const meters = edge.geometry
        .slice(1)
        .reduce((n, p, i) => n + distance(edge.geometry[i], p), 0);
      return {
        ...edge,
        distance: meters,
        seconds: meters / (edge.speedKph / 3.6),
      };
    });
  }
  snap(position, maxDistance = 100) {
    let best = null;
    for (const edge of this.edges) {
      const point = project(position, edge.geometry);
      if (
        point.distance <= maxDistance &&
        (!best || point.distance < best.distance)
      )
        best = { ...point, road: edge.road, from: edge.from, to: edge.to };
    }
    if (!best)
      throw new MazoError(
        'NO_SNAP',
        'No routable road segment within snapping distance',
      );
    return best;
  }
  route(origin, destination, { maxSnapDistance = 100 } = {}) {
    const start = this.snap(origin, maxSnapDistance),
      end = this.snap(destination, maxSnapDistance),
      snaps = [start, end];
    const match = (edge, snap) =>
      edge.road === snap.road &&
      ((edge.from === snap.from && edge.to === snap.to) ||
        (edge.to === snap.from && edge.from === snap.to));
    for (const [i, snap] of snaps.entries())
      snap.id =
        snap.along < 0.001
          ? snap.from
          : snap.total - snap.along < 0.001
            ? snap.to
            : 'virtual:' + i;
    const adjacency = new Map();
    const add = (edge) => {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push(edge);
    };
    for (const edge of this.edges) {
      const cuts = [
        { id: edge.from, along: 0, index: 0, position: edge.geometry[0] },
      ];
      for (const snap of snaps)
        if (match(edge, snap) && snap.id.startsWith('virtual:'))
          cuts.push({ ...project(snap.position, edge.geometry), id: snap.id });
      cuts.push({
        id: edge.to,
        along: edge.distance,
        index: edge.geometry.length - 2,
        position: edge.geometry.at(-1),
      });
      cuts.sort((a, b) => a.along - b.along);
      for (let i = 1; i < cuts.length; i++) {
        const a = cuts[i - 1],
          b = cuts[i],
          meters = Math.max(0, b.along - a.along);
        add({
          ...edge,
          from: a.id,
          to: b.id,
          geometry: slice(edge.geometry, a, b),
          distance: meters,
          seconds: meters / (edge.speedKph / 3.6),
        });
      }
    }
    const costs = new Map([[start.id, 0]]),
      previous = new Map(),
      queue = [[0, start.id]];
    while (queue.length) {
      queue.sort((a, b) => b[0] - a[0]);
      const [cost, node] = queue.pop();
      if (cost !== costs.get(node)) continue;
      if (node === end.id) break;
      for (const edge of adjacency.get(node) || []) {
        const next = cost + edge.seconds;
        if (next < (costs.get(edge.to) ?? Infinity)) {
          costs.set(edge.to, next);
          previous.set(edge.to, edge);
          queue.push([next, edge.to]);
        }
      }
    }
    if (!costs.has(end.id))
      throw new MazoError(
        'UNREACHABLE',
        'Destination is disconnected or restricted in this road sample',
      );
    let cursor = end.id;
    const edges = [];
    while (cursor !== start.id) {
      const edge = previous.get(cursor);
      edges.unshift(edge);
      cursor = edge.from;
    }
    const coordinates = edges
      .flatMap((e, i) => (i ? e.geometry.slice(1) : e.geometry))
      .filter((p, i, a) => !i || distance(p, a[i - 1]) > 0.001);
    return {
      geometry: {
        type: 'LineString',
        coordinates:
          coordinates.length > 1 ? coordinates : [start.position, end.position],
      },
      distance: edges.reduce((n, e) => n + e.distance, 0),
      estimatedSeconds: costs.get(end.id),
      snappedOrigin: start,
      snappedDestination: end,
      roads: edges.map((e) => e.road),
      notice: this.graph.coverage,
    };
  }
}
