import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorModel,
  validateGeometry,
  moveGeometry,
  replaceVertex,
  changeVertex,
} from '../assets/js/editor-model.js';
const point = { type: 'Point', coordinates: [79.9, 6.9] };
const source = [
  {
    provider: 'survey',
    id: 'fixture',
    release: '1',
    url: 'https://example.org',
    license: 'CC0-1.0',
  },
];
test('all editor geometry types support movement, validation and changeset drafts', () => {
  const model = new EditorModel('a'.repeat(64));
  for (const kind of [
    'place',
    'connector',
    'building',
    'land',
    'land_use',
    'water',
    'administrative_boundary',
    'road',
  ]) {
    const geometry = ['place', 'connector'].includes(kind)
      ? point
      : kind === 'road'
        ? {
            type: 'LineString',
            coordinates: [
              [79.9, 6.9],
              [79.91, 6.91],
            ],
          }
        : {
            type: 'Polygon',
            coordinates: [
              [
                [79.9, 6.9],
                [79.91, 6.9],
                [79.91, 6.91],
                [79.9, 6.9],
              ],
            ],
          };
    const id = model.create(kind, geometry, source);
    model.update(id, { geometry: moveGeometry(geometry, [0.001, 0.001]) });
  }
  assert.equal(
    model.changeset('A surveyed update', 'Tester').operations.length,
    10,
  );
  const text = model.serialize();
  model.discard();
  model.restore(text);
  assert.equal(Object.keys(model.entries).length, 10);
  model.undo();
  assert.equal(Object.keys(model.entries).length, 0);
  model.redo();
  assert.equal(Object.keys(model.entries).length, 10);
});
test('vertex operations preserve polygon closure and reject invalid shapes', () => {
  const p = {
    type: 'Polygon',
    coordinates: [
      [
        [79.9, 6.9],
        [79.91, 6.9],
        [79.91, 6.91],
        [79.9, 6.9],
      ],
    ],
  };
  const moved = replaceVertex(p, [0, 0], [79.89, 6.89]);
  assert.deepEqual(moved.coordinates[0][0], moved.coordinates[0].at(-1));
  const added = changeVertex(p, [0, 0]);
  assert.equal(added.coordinates[0].length, 5);
  assert.equal(changeVertex(added, [0, 1], true).coordinates[0].length, 4);
  assert.throws(
    () => validateGeometry({ ...point, coordinates: [0, 0] }),
    /Sri Lanka/,
  );
});
test('existing imports update and delete with server-issued record hashes; new deletion removes draft', () => {
  const m = new EditorModel('a'.repeat(64));
  const id = crypto.randomUUID();
  m.select({
    record: {
      id,
      featureType: 'place',
      geometry: point,
      properties: { names: { primary: 'Old' } },
      sources: source,
      status: 'active',
    },
    sha256: 'b'.repeat(64),
  });
  m.update(id, { properties: { names: { primary: 'New' } } });
  assert.equal(
    m.changeset('Correction', 'Tester').operations[0].expected,
    'b'.repeat(64),
  );
  m.remove(id);
  assert.equal(
    m.changeset('Deletion', 'Tester').operations[0].operation,
    'delete',
  );
  m.undo();
  assert.equal(m.entries[id].after.status, 'active');
  const created = m.create('place', point, source);
  m.remove(created);
  assert.equal(m.entries[created], undefined);
});
test('localized edits preserve Overture name dictionaries and unrelated alternate names', async () => {
  const { localizedName, withLocalizedNames } = await import(
    '../assets/js/editor-model.js'
  );
  const p = {
    names: {
      primary: 'Embassy',
      common: { fr: 'Ambassade', ta: 'தூதரகம்' },
      rules: null,
    },
  };
  assert.equal(localizedName(p, 'ta'), 'தூதரகம்');
  const changed = withLocalizedNames(p, {
    en: 'Updated',
    ta: 'தூதரகம்',
    si: 'තානාපති',
  });
  assert.equal(changed.names.common.fr, 'Ambassade');
  assert.equal(changed.names.common.si, 'තානාපති');
  assert.equal(p.names.primary, 'Embassy');
});
test('road split is atomic, preserves explicit connectivity and can merge compatible segments', () => {
  const m = new EditorModel('a'.repeat(64)),
    id = crypto.randomUUID();
  m.select({
    sha256: 'b'.repeat(64),
    record: {
      id,
      featureType: 'road',
      status: 'active',
      geometry: {
        type: 'LineString',
        coordinates: [
          [79.9, 6.9],
          [79.91, 6.9],
          [79.92, 6.9],
        ],
      },
      properties: {
        class: 'residential',
        connectors: [
          { connector_id: 'source-start', at: 0 },
          { connector_id: 'source-end', at: 1 },
        ],
      },
      sources: source,
    },
  });
  const { rightID, connectorID } = m.splitRoad(id, 1);
  assert.equal(m.changeset('Split road', 'Tester').operations.length, 3);
  assert.equal(
    m.entries[id].after.properties.connectors.at(-1).connector_id,
    connectorID,
  );
  assert.equal(
    m.entries[rightID].after.properties.connectors[0].connector_id,
    connectorID,
  );
  m.undo();
  assert.equal(Object.keys(m.entries).length, 1);
  m.redo();
  m.mergeRoads(id, rightID);
  assert.equal(m.entries[id].after.geometry.coordinates.length, 3);
  assert.equal(m.entries[rightID], undefined);
});
test('native connected roads merge without treating different endpoint IDs as access conflicts', () => {
  const m = new EditorModel('a'.repeat(64));
  const a = m.create(
      'road',
      {
        type: 'LineString',
        coordinates: [
          [79.9, 6.9],
          [79.91, 6.9],
        ],
      },
      source,
    ),
    b = m.create(
      'road',
      {
        type: 'LineString',
        coordinates: [
          [79.91, 6.9],
          [79.92, 6.9],
        ],
      },
      source,
    );
  const end = m.entries[a].after.properties.routing.connectors[1];
  m.entries[b].after.properties.routing.connectors[0] = end;
  m.mergeRoads(a, b);
  assert.equal(m.entries[a].after.geometry.coordinates.length, 3);
  assert.equal(m.entries[b], undefined);
});
test('deleting a new road preserves a shared new connector and repairs its draft lineage', () => {
  const m = new EditorModel('a'.repeat(64));
  const a = m.create(
      'road',
      {
        type: 'LineString',
        coordinates: [
          [79.9, 6.9],
          [79.91, 6.9],
        ],
      },
      source,
    ),
    b = m.create(
      'road',
      {
        type: 'LineString',
        coordinates: [
          [79.91, 6.9],
          [79.92, 6.9],
        ],
      },
      source,
    );
  const shared = m.entries[a].after.properties.routing.connectors[1];
  m.entries[b].after.properties.routing.connectors[0] = shared;
  m.remove(a);
  assert.ok(m.entries[shared]);
  assert.equal(m.entries[shared].after.properties.lineage.from, b);
  assert.ok(!m.entries[a]);
});
