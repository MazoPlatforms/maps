// Shared by the browser editor and the Node publication/PR validator.
export const RECORD_TYPES = Object.freeze({
  place: 'Point', building: 'Polygon', road: 'LineString',
  land: 'Polygon', land_use: 'Polygon', water: 'Polygon',
  infrastructure: 'Point', administrative_boundary: 'Polygon',
});
export const RECORD_LICENSES = Object.freeze(['CC0-1.0', 'CC-BY-4.0', 'ODbL-1.0', 'CDLA-Permissive-2.0']);
export const MAX_RECORD_BYTES = 128 * 1024;
export const MAX_RECORDS = 5000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed, label) {
  requireThat(object(value), `${label} must be an object`);
  requireThat(Object.keys(value).every(key => allowed.includes(key)), `${label} contains an unsupported field`);
}
function text(value, max, label, optional = false) {
  requireThat(typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is invalid`);
}
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function recordHash(record) {
  const bytes = new TextEncoder().encode(stableJson(record) + '\n');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function recordPath(record) { return `records/${record.featureType}/${record.id.slice(0, 2)}/${record.id}.json`; }

// JSON.parse silently accepts duplicate keys. Reject those in source files and drafts.
export function parseRecordJson(input) {
  requireThat(new TextEncoder().encode(input).length <= MAX_RECORD_BYTES, 'Record exceeds 128 KiB');
  let at = 0;
  function whitespace() { while (/\s/u.test(input[at] || '') && at < input.length) at++; }
  function string() {
    const start = at++;
    while (at < input.length) {
      const c = input[at++];
      if (c === '\\') at++;
      else if (c === '"') return JSON.parse(input.slice(start, at));
    }
    throw new Error('Unterminated JSON string');
  }
  function value(depth = 0) {
    requireThat(depth < 32, 'JSON nesting exceeds limit'); whitespace();
    if (input[at] === '"') return string();
    if (input[at] === '{') {
      at++; whitespace(); const seen = new Set(); const result = Object.create(null);
      if (input[at] === '}') { at++; return result; }
      while (at < input.length) {
        requireThat(input[at] === '"', 'Expected JSON object key'); const key = string();
        requireThat(!seen.has(key), `Duplicate JSON key: ${key}`); seen.add(key);
        requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe JSON key');
        whitespace(); requireThat(input[at++] === ':', 'Expected colon'); result[key] = value(depth + 1); whitespace();
        const end = input[at++]; if (end === '}') return result;
        requireThat(end === ',', 'Expected comma'); whitespace();
      }
    } else if (input[at] === '[') {
      at++; whitespace(); const result = [];
      if (input[at] === ']') { at++; return result; }
      while (at < input.length) {
        result.push(value(depth + 1)); whitespace(); const end = input[at++];
        if (end === ']') return result; requireThat(end === ',', 'Expected comma');
      }
    } else {
      const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(input.slice(at));
      requireThat(match, 'Invalid JSON value'); at += match[0].length; return JSON.parse(match[0]);
    }
    throw new Error('Incomplete JSON');
  }
  const result = value(); whitespace(); requireThat(at === input.length, 'Trailing JSON content'); return result;
}
function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a, b, p) { return Math.abs(cross(a, b, p)) < 1e-12 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]); }
function intersects(a, b, c, d) {
  return (cross(a,b,c) * cross(a,b,d) < 0 && cross(c,d,a) * cross(c,d,b) < 0) ||
    onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
}
export function validateGeometry(geometry, type) {
  keys(geometry, ['type', 'coordinates'], 'Geometry');
  requireThat(geometry.type === RECORD_TYPES[type], `Expected ${RECORD_TYPES[type]} geometry for ${type}`);
  let points;
  if (geometry.type === 'Point') points = [geometry.coordinates];
  else if (geometry.type === 'LineString') points = geometry.coordinates;
  else {
    requireThat(Array.isArray(geometry.coordinates) && geometry.coordinates.length === 1, 'Polygon must contain one exterior ring; holes require a future schema');
    points = geometry.coordinates[0];
  }
  requireThat(Array.isArray(points) && points.length <= 500 && points.length >= (geometry.type === 'Point' ? 1 : geometry.type === 'Polygon' ? 4 : 2), 'Invalid coordinate count (maximum 500)');
  for (const point of points) requireThat(Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && point[0] >= 79.3 && point[0] <= 82.1 && point[1] >= 5.8 && point[1] <= 10.1, 'Coordinates must be finite [longitude, latitude] inside the Sri Lanka bbox');
  for (let i = 1; i < points.length; i++) requireThat(!same(points[i-1], points[i]), 'Consecutive duplicate coordinates');
  if (geometry.type === 'Polygon') {
    requireThat(same(points[0], points.at(-1)), 'Polygon ring must be closed');
    const area = points.slice(0,-1).reduce((sum, a, i) => sum + a[0]*points[i+1][1] - points[i+1][0]*a[1], 0);
    requireThat(Math.abs(area) > 1e-12, 'Polygon has zero area');
    for (let i=0; i<points.length-1; i++) for (let j=i+1; j<points.length-1; j++) {
      if (j === i+1 || (i === 0 && j === points.length-2)) continue;
      requireThat(!intersects(points[i], points[i+1], points[j], points[j+1]), 'Polygon self-intersects');
    }
  }
}
export function validateRecord(record) {
  keys(record, ['schemaVersion','id','featureType','revision','previous','status','geometry','properties','sources','changeNote'], 'Record');
  requireThat(record.schemaVersion === 1, 'Unsupported record schema');
  requireThat(typeof record.id === 'string' && uuid.test(record.id), 'ID must be a lowercase UUID v4');
  requireThat(Object.hasOwn(RECORD_TYPES, record.featureType), 'Unsupported feature type');
  requireThat(Number.isSafeInteger(record.revision) && record.revision > 0, 'Invalid revision');
  requireThat(record.revision === 1 ? record.previous === null : typeof record.previous === 'string' && hash.test(record.previous), 'Invalid previous revision hash');
  requireThat(['active','deleted'].includes(record.status), 'Invalid status');
  text(record.changeNote, 1000, 'Change note');
  validateGeometry(record.geometry, record.featureType);
  keys(record.properties, ['names','category','address','website','phone','description'], 'Properties');
  keys(record.properties.names, ['primary','en','ta','si'], 'Names'); text(record.properties.names.primary, 200, 'Primary name');
  for (const language of ['en','ta','si']) if (Object.hasOwn(record.properties.names,language)) text(record.properties.names[language],200,`${language} name`);
  text(record.properties.category, 80, 'Category');
  for (const [key, max] of [['address',500],['phone',80],['description',2000]]) if (Object.hasOwn(record.properties,key)) text(record.properties[key],max,key);
  if (record.properties.website) requireThat(/^https:\/\/[^\s]+$/u.test(record.properties.website) && record.properties.website.length <= 500 && !new URL(record.properties.website).username && !new URL(record.properties.website).password, 'Website must be an HTTPS URL without credentials');
  else requireThat(!Object.hasOwn(record.properties,'website'), 'Empty website');
  requireThat(Array.isArray(record.sources) && record.sources.length >= 1 && record.sources.length <= 8, 'Provide 1–8 sources');
  for (const source of record.sources) {
    keys(source,['name','url','license','observedAt','attribution'],'Source');
    text(source.name,200,'Source name'); text(source.attribution,300,'Source attribution');
    requireThat(RECORD_LICENSES.includes(source.license),'Unsupported source license');
    requireThat(/^\d{4}-\d{2}-\d{2}$/.test(source.observedAt) && !Number.isNaN(Date.parse(source.observedAt)) && new Date(source.observedAt).toISOString().slice(0,10) === source.observedAt, 'Invalid observation date');
    if (Object.hasOwn(source,'url')) requireThat(typeof source.url === 'string' && /^https:\/\/[^\s]+$/u.test(source.url) && source.url.length <= 500 && !new URL(source.url).username && !new URL(source.url).password,'Source URL must use HTTPS without credentials');
  }
  requireThat(new TextEncoder().encode(stableJson(record)).length <= MAX_RECORD_BYTES,'Record exceeds 128 KiB');
  return record;
}
export async function validateTransition(before, after) {
  validateRecord(after);
  if (!before) { requireThat(after.revision === 1 && after.previous === null && after.status === 'active','New records must start active at revision 1'); return; }
  validateRecord(before);
  requireThat(before.id === after.id && before.featureType === after.featureType,'Permanent ID and feature type cannot change');
  requireThat(after.revision === before.revision+1 && after.previous === await recordHash(before),'Stale revision: load the latest published record before editing');
  requireThat(stableJson(before.sources) === stableJson(after.sources.slice(0,before.sources.length)), 'Existing provenance must be retained; append new sources');
}
export function recordFeature(record) {
  return { type:'Feature', id:record.id, geometry:record.geometry, properties:{
    id:record.id, name:record.properties.names.primary, '@name':record.properties.names.primary,
    names:record.properties.names, category:record.properties.category, basic_category:record.properties.category,
    featureType:record.featureType, revision:record.revision, address:record.properties.address || '',
  }};
}
export function recordLabel(record) { return `${record.properties.names.primary} · ${record.id.slice(0,8)}`; }
