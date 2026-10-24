export class MazoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'MazoError';
  }
}
export const normalize = (value) =>
  value.normalize('NFKC').toLocaleLowerCase('und').trim();
export function distance(a, b) {
  const rad = Math.PI / 180,
    dlat = (b[1] - a[1]) * rad,
    dlon = (b[0] - a[0]) * rad;
  return (
    6371008.8 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(dlat / 2) ** 2 +
            Math.cos(a[1] * rad) *
              Math.cos(b[1] * rad) *
              Math.sin(dlon / 2) ** 2,
        ),
      ),
    )
  );
}
export class MazoMaps {
  constructor({
    baseURL = new URL('../api/v1/', import.meta.url),
    fetcher = globalThis.fetch,
    maxCachedBytes = 16 * 1024 * 1024,
  } = {}) {
    this.baseURL = new URL(baseURL, globalThis.location?.href);
    this.fetcher = (...args) => fetcher(...args);
    this.cache = new Map();
    this.cachedBytes = 0;
    this.maxCachedBytes = maxCachedBytes;
  }
  async initialize() {
    const r = await this.fetcher(new URL('manifest.json', this.baseURL), {
      cache: 'no-cache',
    });
    if (!r.ok)
      throw new MazoError('UNAVAILABLE', 'Geographic dataset unavailable');
    const m = await r.json();
    if (m.schemaVersion !== 1 || !m.version || !m.features)
      throw new MazoError('SCHEMA', 'Unsupported dataset');
    this.manifest = m;
    return m;
  }
  async resource(entry) {
    if (
      !entry ||
      typeof entry.file !== 'string' ||
      !/^[-\w/.]+\.json$/.test(entry.file) ||
      entry.file.includes('..')
    )
      throw new MazoError('PATH', 'Invalid resource path');
    if (this.cache.has(entry.sha256)) return this.cache.get(entry.sha256).value;
    const r = await this.fetcher(new URL(entry.file, this.baseURL));
    if (!r.ok)
      throw new MazoError('UNAVAILABLE', 'Region or resource unavailable');
    const data = await r.arrayBuffer();
    if (data.byteLength !== entry.bytes)
      throw new MazoError('CHECKSUM', 'Resource length mismatch');
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (sha !== entry.sha256)
      throw new MazoError('CHECKSUM', 'Corrupt geographic resource');
    const value = JSON.parse(new TextDecoder().decode(data));
    if (entry.bytes <= this.maxCachedBytes) {
      while (
        this.cachedBytes + entry.bytes > this.maxCachedBytes &&
        this.cache.size
      ) {
        const [key, old] = this.cache.entries().next().value;
        this.cache.delete(key);
        this.cachedBytes -= old.bytes;
      }
      this.cache.set(entry.sha256, { value, bytes: entry.bytes });
      this.cachedBytes += entry.bytes;
    }
    return value;
  }
  async ready() {
    if (!this.manifest) await this.initialize();
    return this.manifest;
  }
  async getDatasetVersion() {
    return (await this.ready()).version;
  }
  async getFeature(id) {
    return (await this.getFeatureSnapshot(id)).record;
  }
  async getFeatureSnapshot(id) {
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id))
      throw new MazoError('ID', 'Invalid permanent Mazo ID');
    const m = await this.ready();
    const shard = await this.resource(m.features[id[0]]);
    const r = shard.records.find((r) => r.id === id);
    if (!r)
      throw new MazoError('NOT_FOUND', 'Feature outside available coverage');
    return { record: structuredClone(r), sha256: shard.hashes[id] };
  }
  async getRegion(id) {
    const m = await this.ready();
    const index = await this.resource(m.regions);
    const region = index.regions.find((r) => r.id === id);
    if (region) return region;
    if (index.memberships[id])
      return { id, features: index.memberships[id], complete: false };
    throw new MazoError('NOT_FOUND', 'Region outside available coverage');
  }
  async search(
    query,
    { limit = 10, category, type, bbox, near, radius = Infinity, region } = {},
  ) {
    const m = await this.ready(),
      q = normalize(query);
    if (!q) return [];
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new MazoError('LIMIT', 'Limit must be 1–100');
    const entry = m.search[q[0]];
    if (!entry) return [];
    const rows = await this.resource(entry);
    return rows
      .filter(
        (r) =>
          (!type || r.type === type) &&
          (!category || JSON.stringify(r.category).includes(category)) &&
          (!bbox ||
            (r.position[0] >= bbox[0] &&
              r.position[0] <= bbox[2] &&
              r.position[1] >= bbox[1] &&
              r.position[1] <= bbox[3])) &&
          (!region || Object.values(r.administration).includes(region)),
      )
      .map((r) => ({
        ...r,
        distance: near ? distance(near, r.position) : undefined,
        score: Math.max(
          ...r.normalized.map((n) =>
            n === q ? 100 : n.startsWith(q) ? 75 : n.includes(q) ? 30 : 0,
          ),
        ),
      }))
      .filter((r) => r.score > 0 && (!near || r.distance <= radius))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.distance ?? 0) - (b.distance ?? 0) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, limit);
  }
  autocomplete(query, options) {
    return this.search(query, options);
  }
  geocode(query, options) {
    return this.search(query, options);
  }
  async nearby(position, { radius = 1000, limit = 10, type } = {}) {
    const m = await this.ready(),
      index = await this.resource(m.regions);
    if (radius <= 0 || radius > 50000)
      throw new MazoError('RADIUS', 'Supported radius is 1–50000 meters');
    const delta = radius / 100000,
      ids = new Set();
    for (
      let x = Math.floor((position[0] - delta) * 20);
      x <= Math.floor((position[0] + delta) * 20);
      x++
    )
      for (
        let y = Math.floor((position[1] - delta) * 20);
        y <= Math.floor((position[1] + delta) * 20);
        y++
      )
        for (const id of index.grid[`${x}_${y}`] || []) ids.add(id);
    const records = [];
    for (const prefix of new Set([...ids].map((id) => id[0]))) {
      const shard = await this.resource(m.features[prefix]);
      for (const r of shard.records)
        if (
          ids.has(r.id) &&
          r.status === 'active' &&
          (!type || r.featureType === type)
        ) {
          const point = index.positions[r.id];
          records.push({
            id: r.id,
            feature: r,
            distance: distance(position, point),
            position: point,
          });
        }
    }
    return records
      .filter((r) => r.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }
  async reverseGeocode(position, options) {
    const nearby = await this.nearby(position, { ...options, type: 'place' });
    return {
      kind: 'approximate-nearby-place',
      address: null,
      results: nearby,
      notice: 'Nearby known places; no inferred street address.',
    };
  }
}
export function representative(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  let c = geometry.coordinates;
  while (Array.isArray(c[0])) c = c[0];
  return c;
}
