import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from geodata.core import (
    Administration,
    build,
    digest,
    encoded,
    geometry,
    read_upstream,
    validate_records,
)


def polygon(x, y, size=1):
    return {
        "type": "Polygon",
        "coordinates": [
            [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
        ],
    }


def fake_boundaries(directory):
    levels = {"province": [], "district": [], "dsDivision": []}
    for i in range(9):
        levels["province"].append(
            {
                "type": "Feature",
                "properties": {"id": f"p{i}", "name": f"Province {i}"},
                "geometry": polygon(79 + i / 10, 7, 0.1),
            }
        )
    for i in range(25):
        province = f"p{i % 9}"
        district = f"d{i}"
        levels["district"].append(
            {
                "type": "Feature",
                "properties": {
                    "id": district,
                    "name": f"District {i}",
                    "province": province,
                },
                "geometry": polygon(79 + i / 100, 7, 0.01),
            }
        )
        levels["dsDivision"].append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"ds{i}",
                    "name": f"Division {i}",
                    "province": province,
                    "district": district,
                },
                "geometry": polygon(79 + i / 100, 7, 0.01),
            }
        )
    manifest = {"schemaVersion": 1, "version": "fixture-v1", "levels": {}}
    for level, features in levels.items():
        body = encoded({"type": "FeatureCollection", "features": features})
        filename = level + ".geojson"
        (directory / filename).write_bytes(body)
        manifest["levels"][level] = {
            "file": filename,
            "count": len(features),
            "sha256": hashlib.sha256(body).hexdigest(),
        }
    (directory / "manifest.json").write_bytes(encoded(manifest))


class Contributions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        fake_boundaries(self.directory)
        self.admin = Administration(self.directory)
        self.root = self.directory / "records"
        self.root.mkdir()
        g = {"type": "Point", "coordinates": [79.005, 7.005]}
        self.record = {
            "schemaVersion": 1,
            "id": "6763e377-ecea-4bea-aef4-5ac6ad8a978b",
            "featureType": "place",
            "geometry": g,
            "properties": {"names": {"primary": "Fixture"}},
            "sources": [
                {
                    "provider": "survey",
                    "id": "fixture-1",
                    "release": "1",
                    "url": "https://example.org/survey",
                    "license": "CC0-1.0",
                }
            ],
            "administration": self.admin.classify(g),
            "status": "added",
            "revision": 1,
            "previous": None,
        }
        self.basemap = {
            "release": "2026-10-21.0",
            "archives": {"base": {"sha256": "a" * 64}},
            "sourceIdentity": {"property": "id", "allZooms": True},
        }
        self.upstream = {"release": self.basemap["release"]}

    def tearDown(self):
        self.temp.cleanup()

    def save(self, record=None, path=None):
        record = record or self.record
        path = self.root / (path or self.admin.path(record))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encoded(record))
        return path

    def validate(self, baseline=None):
        return validate_records(self.root, self.admin, self.upstream, baseline)

    def test_schema_and_path(self):
        path = self.save()
        self.assertEqual(len(self.validate()), 1)
        r = copy.deepcopy(self.record)
        r["schemaVersion"] = 2
        path.write_bytes(encoded(r))
        with self.assertRaises(Exception):
            self.validate()
        path.write_bytes(encoded(self.record))
        path.rename(path.with_name("wrong.json"))
        with self.assertRaisesRegex(ValueError, "path mismatch"):
            self.validate()

    def test_geometry_rejections(self):
        for g in [
            {"type": "Point", "coordinates": [181, 7]},
            {"type": "Point", "coordinates": [80, 91]},
            {"type": "Point", "coordinates": [80, float("nan")]},
            {"type": "Point", "coordinates": [80, True]},
            {"type": "LineString", "coordinates": [[80, 7], [80, 7]]},
            {
                "type": "Polygon",
                "coordinates": [[[80, 7], [81, 8], [80, 8], [81, 7], [80, 7]]],
            },
            {"type": "Polygon", "coordinates": [[[80, 7], [81, 7], [80, 8]]]},
        ]:
            with self.subTest(geometry=g), self.assertRaises(Exception):
                geometry(g)
        with self.assertRaisesRegex(ValueError, "cannot have"):
            geometry(polygon(80, 7), "road")
        geometry(
            {"type": "MultiPolygon", "coordinates": [polygon(80, 7)["coordinates"]]},
            "building",
        )
        geometry(
            {"type": "MultiLineString", "coordinates": [[[80, 7], [81, 8]]]}, "road"
        )

    def test_duplicate_ids(self):
        self.save()
        self.save(path=Path("x/y/z/place/duplicate.json"))
        with self.assertRaisesRegex(ValueError, "duplicate ID"):
            self.validate()

    def test_classification_crossing_and_touching(self):
        g = {"type": "LineString", "coordinates": [[79.005, 7.005], [79.025, 7.005]]}
        result = self.admin.classify(g)
        self.assertEqual(len(result["intersections"]), 3)
        self.assertEqual(result, self.admin.classify(g))
        self.assertEqual(
            len(self.admin.classify(polygon(79, 7, 0.01))["intersections"]), 1
        )
        with self.assertRaisesRegex(ValueError, "does not intersect"):
            self.admin.classify({"type": "Point", "coordinates": [0, 0]})
        self.record["administration"]["dataset"] = "wrong"
        self.save()
        with self.assertRaisesRegex(ValueError, "classification mismatch"):
            self.validate()

    def test_revision_and_tombstone(self):
        old = copy.deepcopy(self.record)
        self.record["properties"]["name"] = "Changed"
        self.save()
        with self.assertRaisesRegex(ValueError, "revision conflict"):
            self.validate({old["id"]: old})
        self.record.update(revision=2, previous=digest(old), status="removed")
        path = self.save()
        self.validate({old["id"]: old})
        built = build(
            self.validate(),
            self.admin,
            self.upstream,
            self.basemap,
            self.directory / "tombstone",
        )
        self.assertEqual(built["features"], 0)
        path.unlink()
        with self.assertRaisesRegex(ValueError, "retained as tombstones"):
            self.validate({old["id"]: old})

    def test_upstream_conflicts_and_suppression(self):
        u = {
            "id": "overture-string-id",
            "release": self.upstream["release"],
            "sha256": "f" * 64,
            "featureType": "place",
        }
        self.record.update(status="modified", upstream=u)
        self.record["sources"] = [
            {
                "provider": "overture",
                "id": u["id"],
                "release": u["release"],
                "url": "https://docs.overturemaps.org",
                "license": "ODbL-1.0",
            }
        ]
        self.save()
        with self.assertRaisesRegex(ValueError, "upstream conflict"):
            self.validate()
        self.upstream[u["id"]] = u | {"status": "present"}
        records = self.validate()
        manifest = build(
            records,
            self.admin,
            self.upstream,
            self.basemap,
            self.directory / "modified",
        )
        self.assertEqual(manifest["suppressions"], {"places": {"place": [u["id"]]}})
        with self.assertRaisesRegex(ValueError, "source IDs"):
            build(
                records,
                self.admin,
                self.upstream,
                self.basemap | {"sourceIdentity": {}},
                self.directory / "unsafe",
            )
        self.upstream[u["id"]]["sha256"] = "e" * 64
        with self.assertRaisesRegex(ValueError, "upstream conflict"):
            self.validate()

    def test_deterministic_output(self):
        self.save()
        records = self.validate()
        for name in ("first", "second"):
            build(
                records, self.admin, self.upstream, self.basemap, self.directory / name
            )
        first = {p.name: p.read_bytes() for p in (self.directory / "first").iterdir()}
        second = {p.name: p.read_bytes() for p in (self.directory / "second").iterdir()}
        self.assertEqual(first, second)
        for name, sha in json.loads(first["checksums.json"]).items():
            self.assertEqual(hashlib.sha256(first[name]).hexdigest(), sha)

    def test_boundary_integrity(self):
        path = self.directory / "province.geojson"
        path.write_text("{}")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            Administration(self.directory)

    def test_upstream_fingerprint(self):
        f = {
            "id": "source-1",
            "featureType": "place",
            "geometry": self.record["geometry"],
            "properties": {"name": "Source"},
        }
        path = self.directory / "upstream.json"
        source = {
            "schemaVersion": 1,
            "release": self.upstream["release"],
            "features": [f | {"sha256": digest(f), "status": "present"}],
        }
        path.write_bytes(encoded(source))
        read_upstream(path, self.upstream["release"])
        source["features"][0]["properties"]["name"] = "Tampered"
        path.write_bytes(encoded(source))
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            read_upstream(path, self.upstream["release"])


if __name__ == "__main__":
    unittest.main()


class AuthoritativeBoundaries(unittest.TestCase):
    def test_national_hierarchy_and_cities(self):
        admin = Administration(
            Path(__file__).resolve().parents[1] / "data/boundaries/sri-lanka"
        )
        self.assertEqual(len(admin.divisions["province"]), 9)
        self.assertEqual(len(admin.divisions["district"]), 25)
        self.assertEqual(
            len(admin.divisions["dsDivision"]),
            admin.manifest["levels"]["dsDivision"]["count"],
        )
        for coordinate, district in [
            ([79.8612, 6.9271], "Colombo"),
            ([80.0255, 9.6615], "Jaffna"),
            ([80.6337, 7.2906], "Kandy"),
            ([80.217, 6.0329], "Galle"),
            ([81.2152, 8.5874], "Trincomalee"),
            ([81.695, 7.71], "Batticaloa"),
        ]:
            result = admin.classify({"type": "Point", "coordinates": coordinate})
            self.assertEqual(
                admin.by_id[result["canonical"]["district"]]["properties"]["name"],
                district,
            )
        line = {
            "type": "LineString",
            "coordinates": [[79.8612, 6.9271], [80.6337, 7.2906]],
        }
        result = admin.classify(line)
        self.assertGreater(len({p["district"] for p in result["intersections"]}), 1)
        self.assertEqual(line["type"], "LineString")


class CommandLifecycle(unittest.TestCase):
    setUp = Contributions.setUp
    tearDown = Contributions.tearDown
    validate = Contributions.validate

    def command(self, *arguments):
        import subprocess

        return subprocess.check_output(
            [
                sys.executable,
                str(Path(__file__).resolve().parents[1] / "scripts/contributions.py"),
                "--root",
                str(self.root),
                "--boundaries",
                str(self.directory),
                *map(str, arguments),
            ],
            text=True,
        )

    def test_add_update_delete_and_migration(self):
        source = self.directory / "input.json"
        source.write_bytes(
            encoded(
                {
                    k: self.record[k]
                    for k in ("featureType", "geometry", "properties", "sources")
                }
            )
        )
        relative = self.command("add", source).strip()
        path = self.root / relative
        first = json.loads(path.read_text())
        source.write_bytes(encoded({"properties": {"names": {"primary": "Changed"}}}))
        self.command("update", first["id"], source)
        updated = json.loads(path.read_text())
        self.assertEqual(updated["previous"], digest(first))
        self.assertEqual(updated["revision"], 2)
        self.command("migrate", "--output", self.directory / "migration")
        self.assertEqual(
            json.loads((self.directory / "migration" / relative).read_text()), updated
        )
        self.command("delete", first["id"])
        self.assertEqual(json.loads(path.read_text())["status"], "removed")
        self.validate()

    def test_override_and_explicit_rebase(self):
        base = {
            "id": "upstream-test",
            "featureType": "place",
            "geometry": self.record["geometry"],
            "properties": {"name": "Original"},
        }
        snapshot = self.directory / "snapshot.json"
        snapshot.write_bytes(
            encoded(
                {
                    "schemaVersion": 1,
                    "release": self.upstream["release"],
                    "features": [base | {"sha256": digest(base), "status": "present"}],
                }
            )
        )
        source = self.directory / "input.json"
        source.write_bytes(
            encoded(
                {
                    "sources": [
                        {
                            "provider": "overture",
                            "id": base["id"],
                            "release": self.upstream["release"],
                            "url": "https://docs.overturemaps.org",
                            "license": "ODbL-1.0",
                        }
                    ]
                }
            )
        )
        relative = self.command(
            "override", source, "--snapshot", snapshot, "--source-id", base["id"]
        ).strip()
        old = json.loads((self.root / relative).read_text())
        base["properties"]["name"] = "Changed upstream"
        snapshot.write_bytes(
            encoded(
                {
                    "schemaVersion": 1,
                    "release": self.upstream["release"],
                    "features": [base | {"sha256": digest(base), "status": "present"}],
                }
            )
        )
        self.upstream = read_upstream(snapshot, self.upstream["release"])
        with self.assertRaisesRegex(ValueError, "upstream conflict"):
            self.validate()
        self.command("rebase", old["id"], "--snapshot", snapshot)
        rebased = self.validate({old["id"]: old})[0]
        self.assertEqual(rebased["properties"]["name"], "Original")
        self.assertEqual(rebased["upstream"]["sha256"], digest(base))


class RecordDiscovery(unittest.TestCase):
    setUp = Contributions.setUp
    tearDown = Contributions.tearDown
    validate = Contributions.validate
    save = Contributions.save

    def test_duplicate_upstream_targets(self):
        r = self.record
        r["status"] = "modified"
        r["upstream"] = {
            "id": "target",
            "featureType": "place",
            "release": self.upstream["release"],
            "sha256": "f" * 64,
        }
        r["sources"] = [
            {
                "provider": "overture",
                "id": "target",
                "release": self.upstream["release"],
                "url": "https://docs.overturemaps.org",
                "license": "ODbL-1.0",
            }
        ]
        self.upstream["target"] = r["upstream"] | {"status": "present"}
        self.save()
        second = copy.deepcopy(r)
        second["id"] = "8763e377-ecea-4bea-aef4-5ac6ad8a978b"
        self.save(second)
        with self.assertRaisesRegex(ValueError, "duplicate upstream target"):
            self.validate()

    def test_malformed_paths_and_symlinks(self):
        path = self.save(path=Path("misplaced.json"))
        with self.assertRaisesRegex(ValueError, "invalid record path"):
            self.validate()
        path.unlink()
        (self.root / "linked").symlink_to(self.directory, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.validate()
