import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from scripts.refresh_offline_manifest import refresh


class OfflineManifestTests(unittest.TestCase):
    def test_rehashes_finalized_assets_and_package_version(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            asset = b"finalized production asset"
            (root / "assets").mkdir()
            (root / "assets/app.js").write_bytes(asset)
            (root / "offline-manifest.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "version": "old",
                        "coverage": {"complete": False},
                        "files": [
                            {"file": "assets/app.js", "bytes": 1, "sha256": "old"}
                        ],
                    }
                )
            )
            result = refresh(root)
            self.assertEqual(result["files"][0]["bytes"], len(asset))
            self.assertEqual(
                result["files"][0]["sha256"], hashlib.sha256(asset).hexdigest()
            )
            self.assertNotEqual(result["version"], "old")

    def test_rejects_paths_outside_site(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "offline-manifest.json").write_text(
                json.dumps(
                    {
                        "files": [
                            {"file": "../secret", "bytes": 1, "sha256": "old"}
                        ]
                    }
                )
            )
            with self.assertRaisesRegex(ValueError, "unsafe offline asset path"):
                refresh(root)


if __name__ == "__main__":
    unittest.main()
