import copy
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from geodata.canonical import import_feature
from geodata.core import Administration, digest, load, encoded
from shapely.geometry import shape, mapping
from shapely.affinity import translate
import hashlib
from geodata.store import Store
from test_geodata import fake_boundaries


class IndexedStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        fake_boundaries(self.root)
        manifest = load(self.root / "manifest.json")
        for entry in manifest["levels"].values():
            path = self.root / entry["file"]
            data = load(path)
            for feature in data["features"]:
                feature["geometry"] = mapping(
                    translate(shape(feature["geometry"]), xoff=0.5)
                )
            body = encoded(data)
            path.write_bytes(body)
            entry["sha256"] = hashlib.sha256(body).hexdigest()
        (self.root / "manifest.json").write_bytes(encoded(manifest))
        self.admin = Administration(self.root)
        self.store = Store(":memory:", self.admin)
        self.addCleanup(self.store.close)
        source = dict(
            provider="survey",
            release="1",
            license="CC0-1.0",
            url="https://example.org/source",
        )
        self.record = import_feature(
            dict(
                id="test-id",
                featureType="place",
                geometry={"type": "Point", "coordinates": [79.505, 7.005]},
                properties={
                    "names": {
                        "primary": "Fixture",
                        "common": [{"value": "சோதனை", "language": "ta"}],
                    }
                },
            ),
            source,
            self.admin,
        )
        self.store.import_records([self.record])

    def changeset(self, operations):
        return dict(
            schemaVersion=1,
            id=str(uuid.uuid4()),
            baseVersion=self.store.version(),
            summary="A surveyed correction",
            contributor={"name": "Test", "licenseAgreement": True},
            operations=operations,
        )

    def op(self, record=None):
        r = record or self.record
        return dict(
            id=r["id"],
            operation="update",
            expected=digest(r),
            value={"properties": r["properties"] | {"test": "updated"}},
        )

    def test_transactions_hashes_and_tombstones(self):
        cs = self.changeset([self.op()])
        version = self.store.version()
        self.store.apply(cs, dry_run=True)
        self.assertEqual(self.store.version(), version)
        self.store.apply(cs)
        new = self.store.get(self.record["id"])
        self.assertEqual(new["revision"], 2)
        with self.assertRaisesRegex(ValueError, "version conflict"):
            self.store.apply(cs)
        self.store.apply(
            self.changeset(
                [dict(id=new["id"], expected=digest(new), operation="delete")]
            )
        )
        self.assertEqual(self.store.get(new["id"])["status"], "removed")

    def test_atomic_failure_unsafe_metadata_and_conflicts(self):
        op = self.op()
        op["value"]["properties"]["name"] = "<img src=x onerror=alert(1)>"
        with self.assertRaisesRegex(ValueError, "unsafe"):
            self.store.apply(self.changeset([op]))
        self.assertEqual(self.store.get(self.record["id"]), self.record)
        op = self.op()
        op["expected"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "revision conflict"):
            self.store.apply(self.changeset([op]))

    def test_snapshot_roundtrip_corruption_and_unchanged_shards(self):
        a = self.store.export_snapshot(self.root / "a", {"coverage": "fixture only"})
        self.store.apply(self.changeset([self.op()]))
        b = self.store.export_snapshot(self.root / "b", {"coverage": "fixture only"})
        self.assertEqual(sum(a["shards"][k] != b["shards"][k] for k in a["shards"]), 1)
        other = Store(":memory:", self.admin)
        try:
            other.load_snapshot(self.root / "b")
            self.assertEqual(other.version(), self.store.version())
            c = other.export_snapshot(self.root / "c", {"coverage": "fixture only"})
            self.assertEqual(b, c)
        finally:
            other.close()
        (self.root / "b" / next(iter(b["shards"].values()))["file"]).write_bytes(
            b"corrupt"
        )
        other = Store(":memory:", self.admin)
        try:
            with self.assertRaisesRegex(ValueError, "checksum"):
                other.load_snapshot(self.root / "b")
        finally:
            other.close()

    def test_new_records_classification_and_dangling_reference_rejected(self):
        value = {
            k: self.record[k]
            for k in ["featureType", "geometry", "properties", "sources"]
        }
        value = copy.deepcopy(value)
        value["properties"]["references"] = [str(uuid.uuid4())]
        op = dict(id=str(uuid.uuid4()), expected=None, operation="create", value=value)
        with self.assertRaisesRegex(ValueError, "unknown Mazo"):
            self.store.apply(self.changeset([op]))
        self.assertEqual(len(list(self.store.records())), 1)

    def test_static_api_retains_tombstones_and_is_deterministic(self):
        from geodata.publication import build_publication

        self.store.apply(
            self.changeset(
                [
                    dict(
                        id=self.record["id"],
                        expected=digest(self.record),
                        operation="delete",
                    )
                ]
            )
        )
        metadata = {"name": "explicit fixture", "bbox": [79.5, 7, 79.6, 7.1]}
        first = build_publication(self.store, metadata, self.root / "public-a")
        second = build_publication(self.store, metadata, self.root / "public-b")
        self.assertEqual(first, second)
        entry = first["features"][self.record["id"][0]]
        shard = load(self.root / "public-a/api/v1" / entry["file"])
        self.assertEqual(shard["records"][0]["status"], "removed")
        self.assertEqual(
            shard["hashes"][self.record["id"]], digest(shard["records"][0])
        )
        self.assertEqual(
            load(self.root / "public-a/api/v1" / first["types"]["place"]["file"]), []
        )

    def test_native_connectors_require_real_endpoint_alignment(self):
        keys = [str(uuid.uuid4()) for _ in range(3)]

        def operation(key, kind, geometry, properties):
            return dict(
                id=key,
                expected=None,
                operation="create",
                value=dict(
                    featureType=kind,
                    geometry=geometry,
                    properties=properties,
                    sources=self.record["sources"],
                ),
            )

        ops = [
            operation(
                keys[0],
                "connector",
                {"type": "Point", "coordinates": [79.505, 7.005]},
                {},
            ),
            operation(
                keys[1],
                "connector",
                {"type": "Point", "coordinates": [79.515, 7.005]},
                {},
            ),
            operation(
                keys[2],
                "road",
                {
                    "type": "LineString",
                    "coordinates": [[79.505, 7.005], [79.506, 7.005]],
                },
                {"routing": {"connectors": keys[:2], "access": "yes"}},
            ),
        ]
        with self.assertRaisesRegex(ValueError, "connector coordinates"):
            self.store.apply(self.changeset(ops))
        ops[1]["value"]["geometry"]["coordinates"] = [79.506, 7.005]
        self.store.apply(self.changeset(ops))
        self.assertEqual(self.store.get(keys[2])["featureType"], "road")

    def test_new_source_license_and_url_policy(self):
        value = {
            key: copy.deepcopy(self.record[key])
            for key in ["featureType", "geometry", "properties", "sources"]
        }
        value["sources"][0]["license"] = "Proprietary"
        op = dict(id=str(uuid.uuid4()), expected=None, operation="create", value=value)
        with self.assertRaisesRegex(ValueError, "source license"):
            self.store.apply(self.changeset([op]))
        value["sources"][0]["license"] = "CC0-1.0"
        value["sources"][0]["url"] = "javascript:alert(1)"
        with self.assertRaisesRegex(ValueError, "source URL"):
            self.store.apply(self.changeset([op]))

    def test_boundary_flag_and_immutable_sources(self):
        op = self.op()
        op["value"]["sources"] = [self.record["sources"][0] | {"license": "Different"}]
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.store.apply(self.changeset([op]))


class Connectivity(unittest.TestCase):
    def test_disconnect_detection_uses_explicit_ids(self):
        before = {
            "nodes": {
                "a": [79.9, 6.9],
                "b": [79.91, 6.9],
                "c": [79.92, 6.9],
                "d": [79.93, 6.9],
            },
            "edges": [
                {"from": "a", "to": "b"},
                {"from": "b", "to": "c"},
                {"from": "c", "to": "d"},
            ],
        }
        after = copy.deepcopy(before)
        after["edges"].pop(1)
        with self.assertRaisesRegex(ValueError, "connectivity regression"):
            Store.check_connectivity(before, after)


if __name__ == "__main__":
    unittest.main()
