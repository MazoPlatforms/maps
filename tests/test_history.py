import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from geodata.core import digest, encoded
from geodata.history import validate_history


class GitHistory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.run_git('init', '-q', '-b', 'main')
        self.run_git('config', 'user.name', 'Test')
        self.run_git('config', 'user.email', 'test@example.org')
        self.run_git('commit', '--allow-empty', '-qm', 'Initial')
        self.base = self.run_git('rev-parse', 'HEAD')
        self.record = {'id': 'permanent-id', 'featureType': 'place', 'status': 'added', 'geometry': {'type': 'Point', 'coordinates': [80, 7]}, 'properties': {}, 'revision': 1, 'previous': None}
        self.path = self.repo / 'data/sri-lanka/p/d/ds/place/permanent-id.json'

    def tearDown(self):
        self.temp.cleanup()

    def run_git(self, *arguments):
        return subprocess.check_output(['git', *arguments], cwd=self.repo, text=True, stderr=subprocess.PIPE).strip()

    def commit(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(encoded(self.record))
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'Change')

    def test_multiple_commits_in_one_push(self):
        self.commit()
        old = copy.deepcopy(self.record)
        self.record.update(revision=2, previous=digest(old), properties={'name': 'Changed'})
        self.commit()
        self.assertEqual(validate_history(self.repo, self.base)['permanent-id']['revision'], 2)

    def test_deletion_and_invalid_revision_are_rejected(self):
        self.commit()
        self.record['properties']['name'] = 'Unversioned'
        self.commit()
        with self.assertRaisesRegex(ValueError, 'historical revision conflict'):
            validate_history(self.repo, self.base)
        self.path.unlink()
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'Remove')
        with self.assertRaises(ValueError):
            validate_history(self.repo, self.run_git('rev-parse', 'HEAD^'))

    def test_merge_preserves_reviewed_branch_record(self):
        self.run_git('checkout', '-qb', 'feature')
        self.commit()
        old = copy.deepcopy(self.record)
        self.record.update(revision=2, previous=digest(old), properties={'name': 'Branch'})
        self.commit()
        self.run_git('checkout', '-q', 'main')
        self.run_git('commit', '--allow-empty', '-qm', 'Main change')
        self.run_git('merge', '--no-ff', '-qm', 'Merge', 'feature')
        self.assertEqual(validate_history(self.repo, self.base)['permanent-id']['revision'], 2)
