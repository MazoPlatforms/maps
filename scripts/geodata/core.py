import gzip
import hashlib
import json
import math
import re
import unicodedata
import uuid
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parents[2]
LAYER = {'place': ('places', 'place'), 'building': ('buildings', 'building'),
         'building_part': ('buildings', 'building_part'), 'road': ('transportation', 'segment'),
         'connector': ('transportation', 'connector'),
         **{t: ('base', t) for t in ('land', 'land_cover', 'land_use', 'water', 'infrastructure', 'bathymetry')}}
ALLOWED = {'place': {'Point', 'MultiPoint'}, 'connector': {'Point'},
           'road': {'LineString', 'MultiLineString'},
           'water': {'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'},
           'infrastructure': {'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'},
           'land': {'Point', 'MultiPoint', 'Polygon', 'MultiPolygon'},
           'land_use': {'Point', 'MultiPoint', 'Polygon', 'MultiPolygon'},
           'administrative_boundary': {'Polygon', 'MultiPolygon'}}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def load(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f'duplicate JSON key: {key}')
            result[key] = value
        return result
    path = Path(path)
    text = gzip.decompress(path.read_bytes()).decode() if path.suffix == '.gz' else path.read_text()
    return json.loads(text, object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def geometry(value, feature_type=None):
    def coordinates(coords):
        if not isinstance(coords, list) or not coords:
            raise ValueError('empty coordinates')
        if isinstance(coords[0], (int, float)):
            if len(coords) != 2 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in coords):
                raise ValueError('coordinates require finite longitude and latitude')
            if not -180 <= coords[0] <= 180 or not -90 <= coords[1] <= 90:
                raise ValueError('coordinates outside WGS84 range')
        else:
            for item in coords:
                coordinates(item)
    coordinates(value['coordinates'])
    kind = value['type']
    if kind in ('Polygon', 'MultiPolygon'):
        polygons = [value['coordinates']] if kind == 'Polygon' else value['coordinates']
        for polygon in polygons:
            for ring in polygon:
                if len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError('polygon rings must be closed with four positions')
    result = shape(value)
    if result.is_empty or not result.is_valid or (result.geom_type.endswith('LineString') and result.length == 0):
        raise ValueError(f'invalid geometry: {explain_validity(result)}')
    if feature_type and kind not in ALLOWED.get(feature_type, {'Polygon', 'MultiPolygon'}):
        raise ValueError(f'{feature_type} cannot have {kind} geometry')
    return result


def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    value = re.sub('[^a-z0-9]+', '-', value).strip('-')
    if not value:
        raise ValueError('empty administrative slug')
    return value


class Administration:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.manifest = load(self.directory / 'manifest.json')
        if self.manifest['schemaVersion'] != 1:
            raise ValueError('unsupported boundary schema')
        self.version = self.manifest['version']
        self.divisions = {}
        for level, item in self.manifest['levels'].items():
            path = self.directory / item['file']
            if path.name != item['file'] or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError('boundary checksum mismatch')
            features = load(path)['features']
            if len(features) != item['count']:
                raise ValueError('boundary count mismatch')
            self.divisions[level] = features
        if len(self.divisions['province']) != 9 or len(self.divisions['district']) != 25:
            raise ValueError('Sri Lanka requires nine provinces and 25 districts')
        ids = set()
        for level, features in self.divisions.items():
            for f in features:
                key = f['properties']['id']
                if key in ids:
                    raise ValueError('duplicate boundary ID')
                ids.add(key)
                geometry(f['geometry'], 'administrative_boundary')
        self.by_id = {f['properties']['id']: f for fs in self.divisions.values() for f in fs}
        for f in self.divisions['district']:
            if f['properties']['province'] not in {x['properties']['id'] for x in self.divisions['province']}:
                raise ValueError('district parent missing')
        for f in self.divisions['dsDivision']:
            p = f['properties']
            if p['district'] not in self.by_id or self.by_id[p['district']]['properties']['province'] != p['province']:
                raise ValueError('DS parent mismatch')
        self.features = self.divisions['dsDivision']
        self.shapes = [shape(f['geometry']) for f in self.features]
        self.tree = STRtree(self.shapes)

    def classify(self, value):
        g = geometry(value)
        matches = []
        for index in self.tree.query(g, predicate='intersects'):
            intersection = self.shapes[index].intersection(g)
            measure = intersection.area if 'Polygon' in g.geom_type else intersection.length if 'LineString' in g.geom_type else 1
            if measure > 0:
                p = self.features[index]['properties']
                matches.append({k: p[k] for k in ('province', 'district')} | {'dsDivision': p['id']})
        matches.sort(key=lambda p: (p['province'], p['district'], p['dsDivision']))
        if not matches:
            raise ValueError('geometry does not intersect a Sri Lankan DS division')
        return {'dataset': self.version, 'canonical': matches[0], 'intersections': matches}

    def path(self, record):
        admin = record['administration']['canonical']
        parts = [slug(self.by_id[admin[k]]['properties']['name']) + '--' + slug(admin[k]) for k in ('province', 'district', 'dsDivision')]
        return Path(*parts, record['featureType'], record['id'] + '.json')


def validate_records(root, admin, upstream, baseline=None):
    schema = load(ROOT / 'schemas/contribution-v1.json')
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    records, seen, targets = [], set(), set()
    root = Path(root)
    if root.is_symlink() or any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('symlink contribution path')
    for path in sorted(root.rglob('*.json')) if root.exists() else []:
        if len(path.relative_to(root).parts) != 5:
            if path.relative_to(root).parts != ('manifest.json',):
                raise ValueError(f'invalid record path: {path}')
            continue
        if path.is_symlink():
            raise ValueError('symlink contribution')
        if path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('record exceeds 2 MiB')
        r = load(path)
        validator.validate(r)
        if r['id'] in seen:
            raise ValueError(f'duplicate ID: {r["id"]}')
        seen.add(r['id'])
        if str(uuid.UUID(r['id'])) != r['id']:
            raise ValueError('ID must be a canonical UUID')
        geometry(r['geometry'], r['featureType'])
        if r['administration'] != admin.classify(r['geometry']):
            raise ValueError(f'administrative classification mismatch: {r["id"]}')
        if path.relative_to(root) != admin.path(r):
            raise ValueError(f'canonical record path mismatch: {path}')
        if r['properties'].keys() & {'id', '_mazoType', '_mazoStatus'}:
            raise ValueError('reserved feature properties')
        if 'upstream' in r:
            u = r['upstream']
            if u['id'] in targets:
                raise ValueError('duplicate upstream target')
            targets.add(u['id'])
            current = upstream.get(u['id'])
            if not current or current.get('status') != 'present' or current['featureType'] != r['featureType'] or u['featureType'] != r['featureType'] or current['sha256'] != u['sha256']:
                raise ValueError(f'upstream conflict: {u["id"]}')
            if current['release'] != upstream['release'] or not any(s['provider'] == 'overture' and s['id'] == u['id'] and s['release'] == u['release'] for s in r['sources']):
                raise ValueError('unverified upstream reference')
        if baseline is not None:
            from .history import check_revision
            check_revision(r, baseline.get(r['id']))
        elif (r['revision'] == 1 and r['previous'] is not None) or (r['revision'] > 1 and r['previous'] is None):
            raise ValueError('invalid revision history')
        records.append(r)
    if baseline is not None and set(baseline) - seen:
        raise ValueError('records must be retained as tombstones')
    return sorted(records, key=lambda r: r['id'])


def read_upstream(path, release):
    if path is None:
        return {'release': release}
    data = load(path)
    if data['schemaVersion'] != 1 or data['release'] != release:
        raise ValueError('upstream snapshot release mismatch')
    result = {'release': release}
    for f in data['features']:
        if f['id'] in result:
            raise ValueError('duplicate upstream ID')
        if f['status'] == 'present':
            geometry(f['geometry'], f['featureType'])
            if digest({k: f[k] for k in ('id', 'featureType', 'geometry', 'properties')}) != f['sha256']:
                raise ValueError('upstream checksum mismatch')
        result[f['id']] = f | {'release': release}
    return result


def build(records, admin, upstream, basemap, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    deletions, features = {}, []
    for r in records:
        if 'upstream' in r:
            if not basemap.get('sourceIdentity', {}).get('property') == 'id' or basemap['sourceIdentity'].get('allZooms') is not True:
                raise ValueError('basemap lacks verified all-zoom source IDs')
            theme, layer = LAYER[r['featureType']]
            deletions.setdefault(theme, {}).setdefault(layer, []).append(r['upstream']['id'])
        if r['status'] == 'removed':
            continue
        properties = r['properties'] | {'_mazoType': r['featureType'], '_mazoStatus': r['status']}
        if r['featureType'] == 'road':
            properties['subtype'] = 'road'
        if '@name' not in properties and isinstance(properties.get('names'), dict):
            properties['@name'] = properties['names'].get('primary', '')
        features.append({'type': 'Feature', 'id': r['id'], 'geometry': r['geometry'], 'properties': properties})
    collection = {'type': 'FeatureCollection', 'features': features}
    body = encoded(collection)
    if len(body) > 16 * 1024 * 1024:
        raise ValueError('contribution overlay exceeds 16 MiB; tiled migration required')
    sha = hashlib.sha256(body).hexdigest()
    filename = f'features.{sha}.geojson'
    (output / filename).write_bytes(body)
    (output / (filename + '.gz')).write_bytes(gzip.compress(body, mtime=0))
    manifest = {'schemaVersion': 1, 'boundaryVersion': admin.version, 'release': upstream['release'],
                'basemap': {t: a['sha256'] for t, a in sorted(basemap['archives'].items())},
                'recordsSha256': digest(records), 'records': len(records), 'features': len(features),
                'recordIndex': [{'id': r['id'], 'path': str(admin.path(r)), 'status': r['status'], 'revision': r['revision'], 'sources': r['sources'], 'administration': r['administration'], **({'upstream': r['upstream']} if 'upstream' in r else {})} for r in records],
                'layer': {'file': filename, 'sha256': sha, 'bytes': len(body)},
                'suppressions': {t: {l: sorted(ids) for l, ids in sorted(layers.items())} for t, layers in sorted(deletions.items())},
                'administrativeIndex': {key: sorted(r['id'] for r in records if any(a['dsDivision'] == key for a in r['administration']['intersections'])) for key in sorted({a['dsDivision'] for r in records for a in r['administration']['intersections']})},
                'attribution': sorted({'Survey Department of Sri Lanka / OCHA · CC BY 3.0 IGO'} | {s['license'] + ' · ' + s['provider'] for r in records for s in r['sources']})}
    (output / 'manifest.json').write_bytes(encoded(manifest))
    (output / 'checksums.json').write_bytes(encoded({p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.iterdir()) if p.is_file() and p.name != 'checksums.json'}))
    return manifest
