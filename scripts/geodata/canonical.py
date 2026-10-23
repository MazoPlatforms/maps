"""Bounded file-store pilot. Canonical records never resolve upstream state."""
import copy
import hashlib
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from .core import ROOT, LAYER, digest, encoded, geometry, load
from .history import check_revision

# Permanent namespace: never change, including between source releases.
NAMESPACE = uuid.UUID('609ee4f4-dba3-47f4-922d-c7f69be64582')
PILOT_LIMIT = 20_000
VALIDATOR = Draft202012Validator(load(ROOT / 'schemas/feature-v2.json'),
                                format_checker=FormatChecker())


def validate(record, admin):
    VALIDATOR.validate(record)
    if len(encoded(record)) > 16 * 1024 * 1024:
        raise ValueError('record exceeds 16 MiB; geometry review required')
    if str(uuid.UUID(record['id'])) != record['id']:
        raise ValueError('ID must be a canonical UUID')
    geometry(record['geometry'], record['featureType'])
    if record['administration'] != admin.classify(record['geometry']):
        raise ValueError('administrative classification mismatch')
    if record['properties'].keys() & {'id', '_mazoType', '_mazoStatus'}:
        raise ValueError('reserved feature properties')
    if (record['revision'] == 1) != (record['previous'] is None):
        raise ValueError('invalid revision history')
    origin = record.get('origin')
    if origin and (origin['featureType'] != record['featureType'] or not any(
        all(s[k] == origin[k] for k in ('provider', 'id', 'release'))
        for s in record['sources']
    )):
        raise ValueError('missing original source provenance')


def import_feature(feature, source, admin):
    """Input is a full-resolution snapshot, never a rendered vector tile."""
    value = {k: feature[k] for k in ('id', 'featureType', 'geometry', 'properties')}
    identity = [source['provider'], feature['featureType'], feature['id']]
    record = dict(schemaVersion=2,
                  id=str(uuid.uuid5(NAMESPACE, encoded(identity).decode())),
                  featureType=feature['featureType'], geometry=feature['geometry'],
                  properties=copy.deepcopy(feature['properties']),
                  sources=[source | {'id': feature['id']}],
                  origin={k: source[k] for k in ('provider', 'release')} | {
                      'id': feature['id'], 'featureType': feature['featureType'],
                      'sha256': digest(value)},
                  status='active', revision=1, previous=None,
                  administration=admin.classify(feature['geometry']))
    validate(record, admin)
    return record


def migrate_record(old, admin):
    """Explicit v1 -> v2 migration; edited geometry and permanent ID survive."""
    if old['schemaVersion'] != 1:
        raise ValueError('expected legacy contribution v1')
    Draft202012Validator(load(ROOT / 'schemas/contribution-v1.json'),
                          format_checker=FormatChecker()).validate(old)
    record = copy.deepcopy(old)
    record.update(schemaVersion=2, status='removed' if old['status'] == 'removed' else 'active',
                  revision=old['revision'] + 1, previous=digest(old))
    if 'upstream' in record:
        record['origin'] = record.pop('upstream') | {'provider': 'overture'}
    validate(record, admin)
    return record


class FileStore:
    def __init__(self, root, admin):
        self.root, self.admin = Path(root), admin

    def scan(self, baseline=None):
        records, origins = {}, set()
        if self.root.is_symlink():
            raise ValueError('symlink record root')
        for path in sorted(self.root.rglob('*')):
            if path.is_symlink():
                raise ValueError('symlink record path')
            if not path.is_file() or path.suffix != '.json':
                continue
            if path.relative_to(self.root) == Path('manifest.json'):
                continue  # legacy generated tile manifest is not a record
            if path.stat().st_size > 16 * 1024 * 1024:
                raise ValueError('record exceeds 16 MiB; geometry review required')
            record = load(path)
            validate(record, self.admin)
            if path.relative_to(self.root) != self.admin.path(record):
                raise ValueError('noncanonical record path')
            if record['id'] in records:
                raise ValueError('duplicate permanent ID')
            origin = record.get('origin')
            if origin:
                key = tuple(origin[k] for k in ('provider', 'featureType', 'id'))
                if key in origins:
                    raise ValueError('duplicate original source identity')
                origins.add(key)
            records[record['id']] = record
            if len(records) > PILOT_LIMIT:
                raise ValueError('file-store pilot exceeds 20000 records; nationwide conversion blocked')
        if baseline is not None:
            if baseline.keys() - records.keys():
                raise ValueError('records must be retained as tombstones')
            for key, record in records.items():
                check_revision(record, baseline.get(key))
        return records

    def write(self, record, previous=None, baseline=None):
        validate(record, self.admin)
        if previous is not None:
            check_revision(record, previous if baseline is None else baseline.get(record["id"]))
        path = self.root / self.admin.path(record)
        # Refuse symlink ancestors even if the root does not exist yet.
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError('symlink record path')
        old_path = self.root / self.admin.path(previous) if previous else None
        if path.exists() and path != old_path:
            raise ValueError('record collision; imports never replace local edits')
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix='.record-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(encoded(record))
            os.replace(temp, path)
        finally:
            Path(temp).unlink(missing_ok=True)
        if old_path and old_path != path:
            old_path.unlink()
        return path

    def edit(self, key, expected, patch=None, remove=False):
        records = self.scan()
        old = records[key]
        if digest(old) != expected:
            raise ValueError('revision conflict: reread canonical record')
        if old['status'] == 'removed':
            raise ValueError('tombstones are immutable')
        if patch is not None and patch.keys() - {'geometry', 'properties', 'sources'}:
            raise ValueError('identity fields are immutable')
        record = copy.deepcopy(old)
        record.update(patch or {})
        if any(s not in record['sources'] for s in old['sources']):
            raise ValueError('source provenance and licensing must be retained')
        record.update(status='removed' if remove else 'active',
                      revision=old['revision'] + 1, previous=digest(old))
        record['administration'] = self.admin.classify(record['geometry'])
        baseline = None
        if self.root.resolve() == (ROOT / 'data/sri-lanka').resolve():
            from .history import records_at, next_revision
            baseline = records_at(ROOT, 'HEAD')
            record.update(next_revision(ROOT, old))
        self.write(record, old, baseline)
        return record


def file_digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build(records, admin, output, tippecanoe=None, maxzoom=14):
    """Offline, staged static API/index/style/tile build; all inputs are Mazo-owned."""
    if len(records) > PILOT_LIMIT:
        raise ValueError('nationwide build blocked: file-store pilot limit exceeded')
    output = Path(output)
    if output.exists():
        raise ValueError('build requires a new destination')
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.canonical-', dir=output.parent))
    try:
        index, memberships, layers, attribution = {}, {}, {}, set()
        record_hash = hashlib.sha256()
        for record in sorted(records.values(), key=lambda r: r['id']):
            body = encoded(record)
            record_hash.update(body)
            key = record['id']
            api = Path('api/features', key[:2], key + '.json')
            (stage / api).parent.mkdir(parents=True, exist_ok=True)
            (stage / api).write_bytes(body)
            index[key] = {'file': str(api), 'path': str(admin.path(record)),
                          'sha256': digest(record), 'revision': record['revision'],
                          'status': record['status']}
            for a in record['administration']['intersections']:
                memberships.setdefault(a['dsDivision'], []).append(key)
            attribution.update(s['provider'] + ' · ' + s['license'] + ' · ' + s['url']
                               for s in record['sources'])
            if record['status'] == 'removed':
                continue
            kind = record['featureType']
            layer = LAYER.get(kind, ('administration', kind))[1]
            properties = record['properties'] | {'id': key, '_mazoType': kind}
            if '@name' not in properties and isinstance(properties.get('names'), dict):
                properties['@name'] = properties['names'].get('primary', '')
            if kind == 'road':
                properties.setdefault('subtype', 'road')
            # Structured original attributes remain lossless in the canonical API.
            properties = {k: v for k, v in properties.items()
                          if isinstance(v, (str, int, float, bool))}
            layers.setdefault(layer, []).append(encoded(dict(
                type='Feature', geometry=record['geometry'], properties=properties)))
        if any(s['provider'] == 'overture' and 'ODbL' in s['license']
               for r in records.values() for s in r['sources']):
            attribution.add('© OpenStreetMap contributors, Overture Maps Foundation')
        shutil.copyfile(ROOT / 'ATTRIBUTION.md', stage / 'ATTRIBUTION.md')
        for layer, lines in sorted(layers.items()):
            (stage / (layer + '.geojsonl')).write_bytes(b''.join(lines))
        (stage / 'index.json').write_bytes(encoded(index))
        (stage / 'administrative-index.json').write_bytes(encoded(memberships))
        manifest = {'schemaVersion': 2, 'dataset': 'Mazo Maps',
                    'boundaryVersion': admin.version, 'records': len(records),
                    'active': sum(r['status'] == 'active' for r in records.values()),
                    'recordsSha256': record_hash.hexdigest(),
                    'attribution': sorted(attribution), 'tiles': None,
                    'pilotLimit': PILOT_LIMIT}
        if tippecanoe and layers:
            subprocess.run([tippecanoe, '--output=' + str(stage / 'mazo.pmtiles'),
                            '--minimum-zoom=0', '--maximum-zoom=' + str(maxzoom),
                            '--drop-densest-as-needed', '--extend-zooms-if-still-dropping',
                            '--attribution=' + ' | '.join(sorted(attribution)),
                            *[arg for layer in sorted(layers)
                              for arg in ('-L', layer + ':' + str(stage / (layer + '.geojsonl')))]],
                           check=True)
            tile_hash = file_digest(stage / 'mazo.pmtiles')
            filename = 'mazo.' + tile_hash + '.pmtiles'
            (stage / 'mazo.pmtiles').rename(stage / filename)
            manifest['tiles'] = {'file': filename, 'sha256': tile_hash,
                                 'bytes': (stage / filename).stat().st_size}
            for theme in ('light', 'dark'):
                style = load(ROOT / f'assets/styles/sri-lanka-{theme}.json')
                style['sources'] = {'mazo': {'type': 'vector',
                    'url': 'pmtiles://' + filename,
                    'attribution': ' | '.join(sorted(attribution)).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}}
                style['layers'] = [layer for layer in style['layers']
                                   if not layer.get('source') or layer.get('source-layer') in layers]
                for layer in style['layers']:
                    if layer.get('source'):
                        layer['source'] = 'mazo'
                style['layers'].append({'id': 'mazo-boundaries', 'type': 'line',
                    'source': 'mazo', 'source-layer': 'administrative_boundary',
                    'paint': {'line-color': '#718879', 'line-width': 1}})
                (stage / f'{theme}.json').write_bytes(encoded(style))
        (stage / 'manifest.json').write_bytes(encoded(manifest))
        checksums = {str(p.relative_to(stage)): file_digest(p)
                     for p in sorted(stage.rglob('*')) if p.is_file()}
        (stage / 'checksums.json').write_bytes(encoded(checksums))
        stage.rename(output)
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)
