import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from geodata.canonical import FileStore, build, import_feature, migrate_record
from geodata.core import Administration, digest, encoded, load
from geodata.history import check_revision
from test_geodata import fake_boundaries, polygon


class Canonical(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        fake_boundaries(self.directory)
        self.admin = Administration(self.directory)
        self.store = FileStore(self.directory / 'records', self.admin)
        self.feature = dict(id='original-source-id', featureType='place',
                            geometry={'type': 'Point', 'coordinates': [79.005, 7.005]},
                            properties={'names': {'primary': 'A real test fixture'}, 'nested': {'a': [1]}})
        self.source = dict(provider='fixture', release='1', url='https://example.org/dataset', license='CC0-1.0')
        self.record = import_feature(self.feature, self.source, self.admin)

    def test_import_identity_survives_release_and_path_change(self):
        other = import_feature(self.feature, self.source | {'release': '2'}, self.admin)
        self.assertEqual(other['id'], self.record['id'])
        self.store.write(self.record)
        changed = self.store.edit(self.record['id'], digest(self.record),
                                  {'geometry': {'type': 'Point', 'coordinates': [79.015, 7.005]}})
        self.assertNotEqual(self.admin.path(changed), self.admin.path(self.record))
        self.assertEqual(list(self.store.scan()), [self.record['id']])
        self.assertFalse((self.store.root / self.admin.path(self.record)).exists())

    def test_offline_import_edit_delete_and_optimistic_concurrency(self):
        self.store.write(self.record)
        changed = self.store.edit(self.record['id'], digest(self.record), {'properties': {'name': 'Mazo edit'}})
        with self.assertRaisesRegex(ValueError, 'revision conflict'):
            self.store.edit(changed['id'], digest(self.record), remove=True)
        removed = self.store.edit(changed['id'], digest(changed), remove=True)
        self.assertEqual(removed['origin'], self.record['origin'])
        self.assertEqual(removed['sources'], self.record['sources'])
        self.assertEqual(removed['previous'], digest(changed))
        with self.assertRaisesRegex(ValueError, 'tombstones'):
            self.store.edit(removed['id'], digest(removed), {'properties': {}})
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.store.write(self.record)

    def test_licensing_and_identity_cannot_be_removed(self):
        changed = copy.deepcopy(self.record)
        changed.update(revision=2, previous=digest(self.record))
        for field, value in [('sources', []), ('origin', self.record['origin'] | {'release': 'new'}),
                             ('id', '6763e377-ecea-4bea-aef4-5ac6ad8a978b')]:
            with self.assertRaises(ValueError):
                check_revision(changed | {field: value}, self.record)

    def test_original_provider_ids_and_licenses_survive_property_replacement(self):
        record = copy.deepcopy(self.record)
        references = [{'dataset': 'Foursquare', 'record_id': 'original-provider-id', 'license': 'Apache-2.0'}]
        record['properties']['sources'] = references
        self.store.write(record)
        changed = self.store.edit(record['id'], digest(record), {'properties': {'name': 'Edited'}})
        self.assertEqual(changed['properties']['sources'], references)
        altered = copy.deepcopy(changed)
        altered['properties'].pop('sources')
        altered.update(revision=3, previous=digest(changed))
        with self.assertRaisesRegex(ValueError, 'per-provider'):
            check_revision(altered, changed)
        manifest = build(self.store.scan(), self.admin, self.directory / 'provider-notices')
        self.assertIn('Foursquare · Apache-2.0', manifest['attribution'])

    def test_all_required_types_and_single_cross_boundary_record(self):
        for kind, geom in [('place', self.feature['geometry']), ('connector', self.feature['geometry']),
                           ('road', {'type': 'LineString', 'coordinates': [[79.005, 7.005], [79.015, 7.005]]}),
                           *[(k, polygon(79.005, 7.001, 0.009)) for k in
                             ('building', 'land', 'land_use', 'water', 'administrative_boundary')]]:
            record = import_feature(self.feature | {'featureType': kind, 'geometry': geom}, self.source, self.admin)
            self.store.write(record)
            if kind == 'road':
                self.assertEqual(len(record['administration']['intersections']), 2)
        self.assertEqual(len(self.store.scan()), 8)

    def test_explicit_legacy_migration_preserves_edited_geometry_and_uuid(self):
        old = copy.deepcopy(self.record)
        old.update(schemaVersion=1, status='modified')
        old['upstream'] = old.pop('origin')
        old['sources'][0]['provider'] = 'overture'
        old['upstream'].pop('provider')
        migrated = migrate_record(old, self.admin)
        check_revision(migrated, old)
        self.assertEqual(migrated['id'], old['id'])
        self.assertEqual(migrated['geometry'], old['geometry'])
        self.assertNotIn('upstream', migrated)
        self.assertEqual(migrated['origin']['provider'], 'overture')

    def test_offline_build_determinism_api_and_tombstone_exclusion(self):
        self.store.write(self.record)
        other = import_feature(self.feature | {'id': 'delete-me'}, self.source, self.admin)
        self.store.write(other)
        removed = self.store.edit(other['id'], digest(other), remove=True)
        manifests = []
        for name in ('first', 'second'):
            manifests.append(build(self.store.scan(), self.admin, self.directory / name))
        self.assertEqual(manifests[0], manifests[1])
        first, second = self.directory / 'first', self.directory / 'second'
        for path in first.rglob('*'):
            if path.is_file():
                self.assertEqual(path.read_bytes(), (second / path.relative_to(first)).read_bytes())
        index = load(first / 'index.json')
        self.assertEqual(load(first / index[removed['id']]['file']), removed)
        self.assertEqual(len((first / 'place.geojsonl').read_text().splitlines()), 1)
        self.assertEqual(manifests[0]['records'], 2)
        self.assertNotIn('basemap', manifests[0])

    def test_deletion_path_and_duplicate_origin_rejected(self):
        self.store.write(self.record)
        baseline = self.store.scan()
        (self.store.root / self.admin.path(self.record)).unlink()
        with self.assertRaisesRegex(ValueError, 'tombstones'):
            self.store.scan(baseline)
        self.store.write(self.record)
        duplicate = self.record | {'id': '6763e377-ecea-4bea-aef4-5ac6ad8a978b'}
        self.store.write(duplicate)
        with self.assertRaisesRegex(ValueError, 'duplicate original'):
            self.store.scan()

    def test_multiple_uncommitted_edits_anchor_to_git_and_tombstone_history(self):
        repo = self.directory / 'git-history'
        repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=repo, text=True)
        git('init', '-q')
        git('config', 'user.name', 'Canonical test')
        git('config', 'user.email', 'test@example.invalid')
        store = FileStore(repo / 'data/sri-lanka', self.admin)
        store.write(self.record)
        git('add', 'data')
        git('commit', '-qm', 'Import')
        with patch('geodata.canonical.ROOT', repo):
            first = store.edit(self.record['id'], digest(self.record), {'properties': {'name': 'First'}})
            second = store.edit(first['id'], digest(first), {'properties': {'name': 'Second'}})
            self.assertEqual(second['revision'], 2)
            self.assertEqual(second['previous'], digest(self.record))
            git('add', 'data')
            git('commit', '-qm', 'Edit')
            removed = store.edit(second['id'], digest(second), remove=True)
            git('add', 'data')
            git('commit', '-qm', 'Remove')
        from geodata.history import validate_history
        self.assertEqual(validate_history(repo, 'HEAD~2')[removed['id']]['status'], 'removed')

    def test_cli_import_get_patch_delete_without_upstream(self):
        snapshot = self.directory / 'snapshot.json'
        snapshot.write_bytes(encoded({'source': self.source, 'features': [self.feature]}))
        cmd = [sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/canonical.py'),
               '--root', str(self.store.root), '--boundaries', str(self.directory)]
        def run(*args):
            return subprocess.check_output([*cmd, *args], text=True)
        run('import-snapshot', str(snapshot))
        data = json.loads(run('get', self.record['id']))
        patch = self.directory / 'patch.json'
        patch.write_text('{"properties":{"name":"Edited through canonical CLI"}}')
        run('update', self.record['id'], str(patch), '--expected', data['sha256'])
        data = json.loads(run('get', self.record['id']))
        run('delete', self.record['id'], '--expected', data['sha256'])
        run('validate')
        run('build', '--output', str(self.directory / 'cli-build'))

    @unittest.skipUnless(os.environ.get('TIPPECANOE'), 'TIPPECANOE executable needed for real tile integration')
    def test_real_pmtiles_build_contains_mazo_string_id_and_no_upstream_style(self):
        self.store.write(self.record)
        out = self.directory / 'tiles'
        manifest = build(self.store.scan(), self.admin, out, os.environ['TIPPECANOE'], maxzoom=2)
        archive = out / manifest['tiles']['file']
        self.assertEqual(archive.read_bytes()[:7], b'PMTiles')
        decoder = str(Path(os.environ['TIPPECANOE']).with_name('tippecanoe-decode'))
        text = subprocess.check_output([decoder, str(archive), '2', '2', '1'], text=True)
        self.assertIn(self.record['id'], text)
        self.assertNotIn('original-source-id', text)
        style = load(out / 'light.json')
        self.assertEqual(set(style['sources']), {'mazo'})
        self.assertNotIn('overture', json.dumps(style['sources']))


if __name__ == '__main__':
    unittest.main()
