// Geometry operations and serializable drafts, independent of the UI and renderer.
export const featureTypes = [
  'place',
  'building',
  'road',
  'connector',
  'land',
  'land_use',
  'water',
  'administrative_boundary',
];
export function validateGeometry(geometry) {
  const types = [
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
  ];
  if (!geometry || !types.includes(geometry.type))
    throw new Error('Unsupported geometry');
  function visit(c) {
    if (!Array.isArray(c) || !c.length) throw new Error('Empty geometry');
    if (typeof c[0] === 'number') {
      if (
        c.length !== 2 ||
        !c.every(Number.isFinite) ||
        c[0] < 79.3 ||
        c[0] > 82.1 ||
        c[1] < 5.8 ||
        c[1] > 10.1
      )
        throw new Error('Coordinates must be inside Sri Lanka bounds');
    } else c.forEach(visit);
  }
  visit(geometry.coordinates);
  const lines =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
  if (
    lines.some(
      (l) =>
        l.length < 2 || l.every((p) => p[0] === l[0][0] && p[1] === l[0][1]),
    )
  )
    throw new Error('A line needs two distinct positions');
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  for (const polygon of polygons)
    for (const ring of polygon) {
      if (
        ring.length < 4 ||
        JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))
      )
        throw new Error(
          'Polygon rings must be closed with at least three vertices',
        );
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++)
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      if (Math.abs(area) < 1e-12) throw new Error('Polygon is degenerate');
      // Backend GEOS validation additionally checks ring self-intersections and holes.
    }
  return true;
}
export function vertices(geometry) {
  const result = [];
  function visit(c, path) {
    if (typeof c[0] === 'number') result.push({ path, position: c });
    else c.forEach((x, i) => visit(x, [...path, i]));
  }
  visit(geometry.coordinates, []);
  return result;
}
export function moveGeometry(geometry, delta) {
  const result = structuredClone(geometry);
  for (const v of vertices(result)) {
    v.position[0] += delta[0];
    v.position[1] += delta[1];
  }
  validateGeometry(result);
  return result;
}
export function replaceVertex(geometry, path, position) {
  const result = structuredClone(geometry);
  let parent = result.coordinates;
  for (const i of path.slice(0, -1)) parent = parent[i];
  const index = path.at(-1);
  if (index === undefined) result.coordinates = position;
  else {
    const closed = JSON.stringify(parent[0]) === JSON.stringify(parent.at(-1));
    parent[index] = position;
    if (closed && index === 0) parent[parent.length - 1] = [...position];
    if (closed && index === parent.length - 1) parent[0] = [...position];
  }
  validateGeometry(result);
  return result;
}
export function changeVertex(geometry, path, remove = false) {
  const result = structuredClone(geometry);
  let parent = result.coordinates;
  for (const i of path.slice(0, -1)) parent = parent[i];
  const i = path.at(-1);
  if (i === undefined) throw new Error('Points have no removable vertices');
  const closed = JSON.stringify(parent[0]) === JSON.stringify(parent.at(-1));
  if (remove) {
    if (closed && i === parent.length - 1)
      throw new Error('Select the first ring vertex instead');
    parent.splice(i, 1);
    if (closed) parent[parent.length - 1] = [...parent[0]];
  } else {
    const next = parent[(i + 1) % parent.length];
    parent.splice(i + 1, 0, [
      (parent[i][0] + next[0]) / 2,
      (parent[i][1] + next[1]) / 2,
    ]);
  }
  validateGeometry(result);
  return result;
}
export class EditorModel {
  constructor(version) {
    this.version = version;
    this.entries = {};
    this.undoStack = [];
    this.redoStack = [];
  }
  checkpoint() {
    this.undoStack.push(structuredClone(this.entries));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }
  select(snapshot) {
    if (!this.entries[snapshot.record.id])
      this.entries[snapshot.record.id] = {
        before: structuredClone(snapshot.record),
        after: structuredClone(snapshot.record),
        expected: snapshot.sha256,
        dirty: false,
      };
    return this.entries[snapshot.record.id];
  }
  create(type, geometry, sources) {
    validateGeometry(geometry);
    if (!featureTypes.includes(type))
      throw new Error('Unsupported feature type');
    if (['place', 'connector'].includes(type) && geometry.type !== 'Point')
      throw new Error('Places and connectors require point geometry');
    if (
      ['building', 'land', 'land_use', 'administrative_boundary'].includes(
        type,
      ) &&
      !['Polygon', 'MultiPolygon'].includes(geometry.type)
    )
      throw new Error('This feature type requires polygon geometry');
    if (type === 'road' && geometry.type !== 'LineString')
      throw new Error('New road segments require LineString geometry');
    this.checkpoint();
    const id = crypto.randomUUID(),
      properties = { names: { primary: '', common: [] } };
    if (type === 'road') {
      const ids = [];
      for (const position of [
        geometry.coordinates[0],
        geometry.coordinates.at(-1),
      ]) {
        const key = crypto.randomUUID();
        ids.push(key);
        this.entries[key] = {
          before: null,
          expected: null,
          dirty: true,
          after: {
            id: key,
            featureType: 'connector',
            geometry: { type: 'Point', coordinates: [...position] },
            properties: { lineage: { operation: 'road-endpoint', from: id } },
            sources: structuredClone(sources),
            status: 'active',
          },
        };
      }
      properties.class = 'unclassified';
      properties.routing = { connectors: ids, access: 'unknown' };
    }
    this.entries[id] = {
      before: null,
      expected: null,
      dirty: true,
      after: {
        id,
        featureType: type,
        geometry,
        properties,
        sources,
        status: 'active',
      },
    };
    return id;
  }
  update(id, patch) {
    const entry = this.entries[id];
    if (!entry) throw new Error('Select a canonical feature first');
    if (entry.after.status === 'removed')
      throw new Error('Cannot edit a deleted feature');
    if (patch.geometry) validateGeometry(patch.geometry);
    this.checkpoint();
    Object.assign(entry.after, structuredClone(patch));
    entry.dirty = true;
  }
  remove(id) {
    if (!this.entries[id]) throw new Error('Select a feature');
    this.checkpoint();
    if (!this.entries[id].before) {
      delete this.entries[id];
      this.cleanupDerivedConnectors(id);
    } else {
      this.entries[id].after.status = 'removed';
      this.entries[id].dirty = true;
    }
  }
  cleanupDerivedConnectors(parentID) {
    for (const [key, e] of Object.entries(this.entries)) {
      if (
        e.before ||
        e.after.featureType !== 'connector' ||
        e.after.properties.lineage?.from !== parentID
      )
        continue;
      const parents = Object.entries(this.entries)
        .filter(
          ([id, c]) =>
            id !== key &&
            c.after.status !== 'removed' &&
            (c.after.properties.routing?.connectors?.includes(key) ||
              (c.after.properties.connectors || []).some(
                (ref) => ref.namespace === 'mazo' && ref.connector_id === key,
              ) ||
              (c.after.properties.references || []).includes(key)),
        )
        .map(([id]) => id);
      if (!parents.length) delete this.entries[key];
      else
        e.after.properties.lineage = {
          operation: 'road-connector',
          from: parents[0],
        };
    }
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(structuredClone(this.entries));
    this.entries = this.undoStack.pop();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(structuredClone(this.entries));
    this.entries = this.redoStack.pop();
  }
  discard() {
    this.checkpoint();
    this.entries = {};
  }
  changeset(summary, name) {
    const operations = [];
    for (const [id, e] of Object.entries(this.entries)) {
      if (!e.dirty) continue;
      if (e.after.status === 'removed') {
        operations.push({ id, expected: e.expected, operation: 'delete' });
        continue;
      }
      validateGeometry(e.after.geometry);
      const value = {
        geometry: e.after.geometry,
        properties: e.after.properties,
        sources: e.after.sources,
      };
      if (!e.before) value.featureType = e.after.featureType;
      operations.push({
        id,
        expected: e.expected,
        operation: e.before ? 'update' : 'create',
        value: structuredClone(value),
      });
    }
    if (!operations.length) throw new Error('No changes to submit');
    if (operations.length > 100)
      throw new Error('Changesets are limited to 100 features');
    if (summary.trim().length < 5 || !name.trim())
      throw new Error('Provide your name and a meaningful summary');
    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      baseVersion: this.version,
      summary,
      contributor: { name, licenseAgreement: true },
      operations,
    };
  }
  serialize() {
    return JSON.stringify({
      schemaVersion: 1,
      version: this.version,
      entries: this.entries,
    });
  }
  restore(text) {
    const data = JSON.parse(text);
    if (data.schemaVersion !== 1 || data.version !== this.version)
      throw new Error(
        'Draft belongs to a different dataset version; rebase is required',
      );
    for (const e of Object.values(data.entries))
      validateGeometry(e.after.geometry);
    this.checkpoint();
    this.entries = data.entries;
  }
}
export function localizedName(properties, language) {
  const common = properties.names?.common;
  return (
    (Array.isArray(common)
      ? common.find((n) => n.language === language)?.value
      : common?.[language]) ||
    properties['name:' + language] ||
    ''
  );
}
export function withLocalizedNames(properties, values) {
  const result = structuredClone(properties);
  result.names =
    result.names && typeof result.names === 'object' ? result.names : {};
  result.names.primary = values.en;
  if (Array.isArray(result.names.common)) {
    result.names.common = result.names.common.filter(
      (n) => !['ta', 'si'].includes(n.language),
    );
    for (const language of ['ta', 'si'])
      if (values[language])
        result.names.common.push({ language, value: values[language] });
  } else {
    result.names.common = result.names.common || {};
    for (const language of ['ta', 'si']) {
      if (values[language]) result.names.common[language] = values[language];
      else delete result.names.common[language];
    }
  }
  return result;
}
function roadReferences(record) {
  const p = record.properties;
  if (p.routing?.connectors)
    return p.routing.connectors.map((connector_id, i) => ({
      connector_id,
      namespace: 'mazo',
      at: i,
    }));
  return structuredClone(p.connectors || []);
}
function lineLength(coordinates) {
  return coordinates
    .slice(1)
    .reduce(
      (sum, p, i) =>
        sum + Math.hypot(p[0] - coordinates[i][0], p[1] - coordinates[i][1]),
      0,
    );
}
function checkRoad(record) {
  if (record.featureType !== 'road' || record.geometry.type !== 'LineString')
    throw new Error('Operation requires a single LineString road');
  if (
    record.properties.prohibited_transitions?.length ||
    record.properties.destinations?.length
  )
    throw new Error(
      'Turn/destination relationships require a dedicated topology review',
    );
  function scoped(v) {
    if (Array.isArray(v)) return v.some(scoped);
    if (v && typeof v === 'object')
      return Object.entries(v).some(
        ([k, x]) => (k === 'between' && x !== null) || scoped(x),
      );
    return false;
  }
  if (scoped(record.properties))
    throw new Error('Scoped rules must be remapped by a topology specialist');
  const refs = roadReferences(record);
  if (refs.length < 2 || refs[0].at !== 0 || refs.at(-1).at !== 1)
    throw new Error('Explicit endpoint connectors are required');
  return refs;
}
function setRoadReferences(record, refs) {
  record.properties.connectors = refs;
  if (record.properties.routing) delete record.properties.routing.connectors;
}
EditorModel.prototype.splitRoad = function (id, index) {
  const e = this.entries[id];
  if (!e || e.after.status === 'removed')
    throw new Error('Select an active road');
  const refs = checkRoad(e.after),
    coordinates = e.after.geometry.coordinates;
  if (!Number.isInteger(index) || index < 1 || index >= coordinates.length - 1)
    throw new Error('Select an interior road vertex; add one first if needed');
  const fraction =
    lineLength(coordinates.slice(0, index + 1)) / lineLength(coordinates);
  if (refs.some((r) => Math.abs(r.at - fraction) < 1e-8))
    throw new Error(
      'Split at an existing connector requires relation-aware segment review',
    );
  this.checkpoint();
  const rightID = crypto.randomUUID(),
    connectorID = crypto.randomUUID(),
    left = structuredClone(e.after),
    right = structuredClone(e.after);
  left.geometry.coordinates = coordinates.slice(0, index + 1);
  right.geometry.coordinates = coordinates.slice(index);
  right.id = rightID;
  delete right.origin;
  right.properties.lineage = { operation: 'split', from: id };
  left.properties.splitChildren = [
    ...(left.properties.splitChildren || []),
    rightID,
  ];
  setRoadReferences(left, [
    ...refs
      .filter((r) => r.at < fraction)
      .map((r) => ({ ...r, at: r.at / fraction })),
    { connector_id: connectorID, namespace: 'mazo', at: 1 },
  ]);
  setRoadReferences(right, [
    { connector_id: connectorID, namespace: 'mazo', at: 0 },
    ...refs
      .filter((r) => r.at > fraction)
      .map((r) => ({ ...r, at: (r.at - fraction) / (1 - fraction) })),
  ]);
  this.entries[id].after = left;
  this.entries[id].dirty = true;
  this.entries[rightID] = {
    before: null,
    expected: null,
    dirty: true,
    after: right,
  };
  this.entries[connectorID] = {
    before: null,
    expected: null,
    dirty: true,
    after: {
      id: connectorID,
      featureType: 'connector',
      geometry: { type: 'Point', coordinates: [...coordinates[index]] },
      properties: { lineage: { operation: 'split', from: id } },
      sources: structuredClone(left.sources),
      status: 'active',
    },
  };
  return { rightID, connectorID };
};
EditorModel.prototype.mergeRoads = function (id, otherID) {
  const a = this.entries[id],
    b = this.entries[otherID];
  if (
    !a ||
    !b ||
    id === otherID ||
    a.after.status === 'removed' ||
    b.after.status === 'removed'
  )
    throw new Error('Select two different active roads');
  const ar = checkRoad(a.after),
    br = checkRoad(b.after);
  for (const key of [
    'class',
    'subtype',
    'names',
    'access_restrictions',
    'road_flags',
    'level_rules',
    'routing',
  ])
    if (
      JSON.stringify(
        key === 'routing'
          ? Object.fromEntries(
              Object.entries(a.after.properties.routing || {}).filter(
                ([k]) => k !== 'connectors',
              ),
            )
          : (a.after.properties[key] ?? null),
      ) !==
      JSON.stringify(
        key === 'routing'
          ? Object.fromEntries(
              Object.entries(b.after.properties.routing || {}).filter(
                ([k]) => k !== 'connectors',
              ),
            )
          : (b.after.properties[key] ?? null),
      )
    )
      throw new Error(
        'Road metadata/access/classifications must be compatible',
      );
  const key = (r) => (r.namespace || 'overture') + ':' + r.connector_id;
  if (key(ar.at(-1)) !== key(br[0]))
    throw new Error(
      'Roads must connect in forward geometry order at the same explicit connector',
    );
  const ac = a.after.geometry.coordinates,
    bc = b.after.geometry.coordinates;
  if (Math.hypot(ac.at(-1)[0] - bc[0][0], ac.at(-1)[1] - bc[0][1]) > 0.00001)
    throw new Error('Connector coordinates disagree');
  this.checkpoint();
  const merged = structuredClone(a.after),
    la = lineLength(ac),
    lb = lineLength(bc),
    total = la + lb;
  merged.geometry.coordinates = [...ac, ...bc.slice(1)];
  setRoadReferences(merged, [
    ...ar.map((r) => ({ ...r, at: (r.at * la) / total })),
    ...br.slice(1).map((r) => ({ ...r, at: (la + r.at * lb) / total })),
  ]);
  merged.sources = [
    ...merged.sources,
    ...b.after.sources.filter(
      (s) =>
        !merged.sources.some((t) => JSON.stringify(t) === JSON.stringify(s)),
    ),
  ];
  merged.properties.sources = [
    ...(merged.properties.sources || []),
    ...(b.after.properties.sources || []).filter(
      (s) =>
        !(merged.properties.sources || []).some(
          (t) => JSON.stringify(t) === JSON.stringify(s),
        ),
    ),
  ];
  merged.properties.mergedFrom = [
    ...(merged.properties.mergedFrom || []),
    ...(b.before ? [otherID] : []),
  ];
  if (!b.before && merged.properties.splitChildren)
    merged.properties.splitChildren = merged.properties.splitChildren.filter(
      (key) => key !== otherID,
    );
  a.after = merged;
  a.dirty = true;
  if (b.before) {
    b.after.status = 'removed';
    b.dirty = true;
  } else {
    delete this.entries[otherID];
    this.cleanupDerivedConnectors(otherID);
  }
  return id;
};
