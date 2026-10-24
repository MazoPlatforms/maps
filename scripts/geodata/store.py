"""Indexed canonical transactions and deterministic snapshots. No upstream access."""

import copy
import gzip
import hashlib
import json
import re
import sqlite3
import uuid
from pathlib import Path
from urllib.parse import urlparse

from jsonschema import Draft202012Validator, FormatChecker
from shapely.geometry import shape

from .canonical import validate
from .core import ROOT, digest, encoded, load
from .history import check_revision


def safe_metadata(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in ("__proto__", "constructor", "prototype"):
                raise ValueError("unsafe metadata key")
            safe_metadata(child)
    elif isinstance(value, list):
        for child in value:
            safe_metadata(child)
    elif isinstance(value, str) and re.search(
        r"<\s*/?\s*(script|iframe|img|svg|object|embed)\b|javascript\s*:|onerror\s*=",
        value,
        re.I,
    ):
        raise ValueError("unsafe metadata markup")


def validate_feature(record, admin):
    validate(record, admin)
    safe_metadata(record["properties"])
    permitted = {
        "CC0-1.0",
        "ODbL-1.0",
        "CDLA-Permissive-2.0",
        "Apache-2.0",
        "CC BY 3.0 IGO",
        "CC-BY-3.0-IGO",
        "CC-BY-4.0",
        "MIT",
        "PDDL-1.0",
    }
    for source in record["sources"]:
        if source["license"] not in permitted:
            raise ValueError(
                "unsupported source license; reviewed policy update required"
            )
        uri = urlparse(source["url"])
        if uri.scheme not in ("https", "http", "s3") or not uri.netloc:
            raise ValueError(
                "source URL must identify a permitted public provenance resource"
            )
    west, south, east, north = shape(record["geometry"]).bounds
    if west < 79.3 or east > 82.1 or south < 5.8 or north > 10.1:
        raise ValueError("geometry exceeds Sri Lanka import bounds")


class Store:
    def __init__(self, path, admin):
        self.admin = admin
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS features(id TEXT PRIMARY KEY, kind TEXT NOT NULL,
            status TEXT NOT NULL, sha TEXT NOT NULL, body TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS feature_kind ON features(kind,status);
          CREATE TABLE IF NOT EXISTS origins(provider TEXT, kind TEXT, source_id TEXT,
            id TEXT UNIQUE REFERENCES features(id), PRIMARY KEY(provider,kind,source_id));
          CREATE TABLE IF NOT EXISTS memberships(ds TEXT,id TEXT REFERENCES features(id),PRIMARY KEY(ds,id));
          CREATE TABLE IF NOT EXISTS history(id TEXT, revision INTEGER, sha TEXT, body TEXT,
            changeset TEXT,PRIMARY KEY(id,revision));
          CREATE TABLE IF NOT EXISTS applied(id TEXT PRIMARY KEY, sha TEXT NOT NULL);
        """)

    def close(self):
        self.db.close()

    def get(self, key):
        row = self.db.execute("SELECT body FROM features WHERE id=?", (key,)).fetchone()
        if row is None:
            raise ValueError("unknown Mazo ID: " + key)
        return json.loads(row[0])

    def records(self):
        for row in self.db.execute("SELECT body FROM features ORDER BY id"):
            yield json.loads(row[0])

    def version(self):
        h = hashlib.sha256()
        for key, sha in self.db.execute("SELECT id,sha FROM features ORDER BY id"):
            h.update(encoded([key, sha]))
        return h.hexdigest()

    def put(self, record, changeset="initial-import", validate_input=True):
        if validate_input:
            validate_feature(record, self.admin)
        body, sha = encoded(record).decode(), digest(record)
        self.db.execute(
            "INSERT INTO features VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,sha=excluded.sha,body=excluded.body",
            (record["id"], record["featureType"], record["status"], sha, body),
        )
        if "origin" in record:
            origin = record["origin"]
            self.db.execute(
                "INSERT OR IGNORE INTO origins VALUES (?,?,?,?)",
                (origin["provider"], origin["featureType"], origin["id"], record["id"]),
            )
            target = self.db.execute(
                "SELECT id FROM origins WHERE provider=? AND kind=? AND source_id=?",
                (origin["provider"], origin["featureType"], origin["id"]),
            ).fetchone()
            if not target or target[0] != record["id"]:
                raise ValueError("duplicate source identity")
        self.db.execute("DELETE FROM memberships WHERE id=?", (record["id"],))
        self.db.executemany(
            "INSERT INTO memberships VALUES (?,?)",
            [
                (a["dsDivision"], record["id"])
                for a in record["administration"]["intersections"]
            ],
        )
        self.db.execute(
            "INSERT INTO history VALUES (?,?,?,?,?)",
            (record["id"], record["revision"], sha, body, changeset),
        )

    def import_records(self, records):
        with self.db:
            for record in records:
                if self.db.execute(
                    "SELECT 1 FROM features WHERE id=?", (record["id"],)
                ).fetchone():
                    raise ValueError("initial import never overwrites a record")
                self.put(record)

    def apply(self, changeset, dry_run=False):
        Draft202012Validator(
            load(ROOT / "schemas/changeset-v1.json"), format_checker=FormatChecker()
        ).validate(changeset)
        if len(encoded(changeset)) > 8 * 1024 * 1024:
            raise ValueError("changeset exceeds 8 MiB")
        if len({op["id"] for op in changeset["operations"]}) != len(
            changeset["operations"]
        ):
            raise ValueError("duplicate changeset feature ID")
        summary = []
        from .routing import compile_graph

        old_graph = compile_graph(list(self.records()))
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if changeset["baseVersion"] != self.version():
                raise ValueError(
                    "dataset version conflict; refresh and rebase changeset"
                )
            for op in changeset["operations"]:
                old = None
                if op["operation"] == "create":
                    if self.db.execute(
                        "SELECT 1 FROM features WHERE id=?", (op["id"],)
                    ).fetchone():
                        raise ValueError("permanent ID collision")
                    record = copy.deepcopy(op["value"]) | dict(
                        id=op["id"],
                        schemaVersion=2,
                        status="active",
                        revision=1,
                        previous=None,
                    )
                else:
                    old = self.get(op["id"])
                    if digest(old) != op["expected"]:
                        raise ValueError("feature revision conflict")
                    if old["status"] == "removed":
                        raise ValueError("tombstones are immutable")
                    record = copy.deepcopy(old)
                    if op["operation"] == "delete":
                        record["status"] = "removed"
                    else:
                        record.update(copy.deepcopy(op["value"]))
                        references = old["properties"].get("sources")
                        if references:
                            record["properties"].setdefault("sources", references)
                    record.update(revision=old["revision"] + 1, previous=digest(old))
                record["administration"] = self.admin.classify(record["geometry"])
                check_revision(record, old)
                validate_feature(record, self.admin)
                self.put(record, changeset["id"], validate_input=False)
                summary.append(
                    {
                        "id": record["id"],
                        "operation": op["operation"],
                        "featureType": record["featureType"],
                        "before": old,
                        "after": record,
                        "boundaryReview": record["featureType"]
                        == "administrative_boundary",
                    }
                )
            self.validate_relationships()
            new_graph = compile_graph(list(self.records()))
            self.check_connectivity(old_graph, new_graph)
            self.db.execute(
                "INSERT INTO applied VALUES (?,?)", (changeset["id"], digest(changeset))
            )
            version = self.version()
            if dry_run:
                self.db.rollback()
            else:
                self.db.commit()
            return {
                "version": version,
                "changes": summary,
                "boundaryReview": any(c["boundaryReview"] for c in summary),
            }
        except BaseException:
            self.db.rollback()
            raise

    def validate_relationships(self):
        records = list(self.records())
        for record in records:
            if record["status"] == "removed":
                continue
            routing = record["properties"].get("routing") or {}
            explicit = [
                ref["connector_id"]
                for ref in record["properties"].get("connectors") or []
                if ref.get("namespace") == "mazo"
            ]
            for key in [*routing.get("connectors", []), *explicit]:
                target = self.get(key)
                if target["featureType"] != "connector" or target["status"] != "active":
                    raise ValueError("routing references missing/deleted connector")
            if record["featureType"] == "road":
                refs = [
                    {"connector_id": key, "at": index}
                    for index, key in enumerate(routing.get("connectors", []))
                ]
                refs += [
                    ref
                    for ref in record["properties"].get("connectors") or []
                    if ref.get("namespace") == "mazo"
                ]
                if refs and record["geometry"]["type"] != "LineString":
                    raise ValueError(
                        "explicit road connector edits require a single LineString"
                    )
                for ref in refs:
                    if not 0 <= ref["at"] <= 1:
                        raise ValueError("invalid connector linear reference")
                    expected = shape(record["geometry"]).interpolate(
                        ref["at"], normalized=True
                    )
                    actual = shape(self.get(ref["connector_id"])["geometry"])
                    if expected.distance(actual) > 0.00005:
                        raise ValueError(
                            "road and canonical connector coordinates disagree"
                        )
            for key in record["properties"].get("references", []):
                if self.get(key)["status"] != "active":
                    raise ValueError("relationship references deleted feature")
            lineage = record["properties"].get("lineage")
            if isinstance(lineage, dict) and lineage.get("operation") in (
                "split",
                "road-endpoint",
                "road-connector",
            ):
                if lineage.get("from") == record["id"]:
                    raise ValueError("self-referential feature lineage")
                self.get(lineage.get("from", ""))
            for key in record["properties"].get("mergedFrom") or []:
                self.get(key)
            for key in record["properties"].get("splitChildren") or []:
                self.get(key)
        from .routing import compile_graph

        compile_graph(records)

    @staticmethod
    def check_connectivity(before, after):
        def components(graph):
            neighbors = {key: set() for key in graph["nodes"]}
            for edge in graph["edges"]:
                neighbors[edge["from"]].add(edge["to"])
                neighbors[edge["to"]].add(edge["from"])
            groups = {}
            number = 0
            for start in neighbors:
                if start in groups:
                    continue
                pending = [start]
                groups[start] = number
                while pending:
                    for nxt in neighbors[pending.pop()]:
                        if nxt not in groups:
                            groups[nxt] = number
                            pending.append(nxt)
                number += 1
            return groups

        old, new = components(before), components(after)
        surviving = {}
        for key in old.keys() & new.keys():
            surviving.setdefault(old[key], set()).add(new[key])
        if any(len(groups) > 1 for groups in surviving.values()):
            raise ValueError(
                "routing connectivity regression: surviving road component was disconnected"
            )

    def export_snapshot(self, output, metadata, previous=None):
        """16 ID-prefix partitions, content addressed. Only modified partitions get new hashes."""
        output = Path(output)
        output.mkdir(parents=True, exist_ok=True)
        manifest = {
            "schemaVersion": 1,
            "recordSchema": 2,
            "version": self.version(),
            "boundaryVersion": self.admin.version,
            "metadata": metadata,
            "shards": {},
        }

        def pack(records, kind):
            entries = {}

            def bucket(values, prefix):
                body = b"".join(encoded(r) for r in values)
                if len(body) > 2 * 1024 * 1024 and len({r["id"] for r in values}) > 1:
                    for digit in "0123456789abcdef":
                        child = [
                            r
                            for r in values
                            if r["id"].replace("-", "").startswith(prefix + digit)
                        ]
                        if child:
                            bucket(child, prefix + digit)
                    return
                if len(body) > 16 * 1024 * 1024:
                    raise ValueError(
                        "single-feature history shard exceeds release bound; archive history before expansion"
                    )
                packed = gzip.compress(body, mtime=0)
                sha = hashlib.sha256(packed).hexdigest()
                filename = kind + "-" + prefix + "." + sha + ".jsonl.gz"
                (output / filename).write_bytes(packed)
                entries[prefix] = {
                    "file": filename,
                    "sha256": sha,
                    "bytes": len(packed),
                    "records": len(values),
                }

            for digit in "0123456789abcdef":
                bucket([r for r in records if r["id"][0] == digit], digit)
            return entries

        manifest["shards"] = pack(list(self.records()), "records")
        histories = [
            dict(
                id=row[0],
                revision=row[1],
                sha256=row[2],
                record=json.loads(row[3]),
                changeset=row[4],
            )
            for row in self.db.execute(
                "SELECT id,revision,sha,body,changeset FROM history ORDER BY id,revision"
            )
        ]
        manifest["history"] = {"shards": pack(histories, "history")}
        manifest["applied"] = dict(
            self.db.execute("SELECT id,sha FROM applied ORDER BY id")
        )
        # The manifest is the commit point. Existing immutable blobs remain for rollback.
        temp = output / ".manifest.tmp"
        temp.write_bytes(encoded(manifest))
        temp.replace(output / "manifest.json")
        return manifest

    def load_snapshot(self, root, verify_geometry=True):
        root = Path(root)
        if root.is_symlink() or (root / "manifest.json").is_symlink():
            raise ValueError("symlink snapshot manifest")
        manifest = load(root / "manifest.json")
        if (
            manifest["schemaVersion"] != 1
            or manifest["recordSchema"] != 2
            or manifest["boundaryVersion"] != self.admin.version
        ):
            raise ValueError("unsupported snapshot or classifier version")

        def read(entry):
            name = entry["file"]
            if not re.fullmatch(
                r"(?:records|history)-[a-f0-9]{1,32}\.[a-f0-9]{64}\.jsonl\.gz", name
            ):
                raise ValueError("unsafe snapshot path")
            path = root / name
            if path.is_symlink():
                raise ValueError("symlink snapshot path")
            raw = path.read_bytes()
            if (
                len(raw) != entry["bytes"]
                or hashlib.sha256(raw).hexdigest() != entry["sha256"]
            ):
                raise ValueError("snapshot checksum mismatch")
            # Bound decompression for this published pilot; national storage needs streaming ingestion.
            with gzip.GzipFile(fileobj=__import__("io").BytesIO(raw)) as stream:
                body = stream.read(16 * 1024 * 1024 + 1)
            if len(body) > 16 * 1024 * 1024:
                raise ValueError("snapshot shard expansion limit exceeded")
            return [json.loads(line) for line in body.splitlines()]

        if sum(e["records"] for e in manifest["shards"].values()) > 20000:
            raise ValueError("regional snapshot release limit exceeded")
        with self.db:
            for key, entry in sorted(manifest["shards"].items()):
                records = read(entry)
                if len(records) != entry["records"] or any(
                    not r["id"].replace("-", "").startswith(key) for r in records
                ):
                    raise ValueError("snapshot shard membership mismatch")
                for record in records:
                    self.put(record, validate_input=verify_geometry)
            histories = []
            for entry in manifest["history"]["shards"].values():
                histories.extend(read(entry))
            histories.sort(key=lambda h: (h["id"], h["revision"]))
            self.db.execute("DELETE FROM history")
            grouped = {}
            for h in histories:
                if (
                    digest(h["record"]) != h["sha256"]
                    or h["id"] != h["record"]["id"]
                    or h["revision"] != h["record"]["revision"]
                ):
                    raise ValueError("history checksum or identity mismatch")
                old = grouped.get(h["id"])
                check_revision(h["record"], old)
                grouped[h["id"]] = h["record"]
                self.db.execute(
                    "INSERT INTO history VALUES (?,?,?,?,?)",
                    (
                        h["id"],
                        h["revision"],
                        h["sha256"],
                        encoded(h["record"]).decode(),
                        h["changeset"],
                    ),
                )
            if {r["id"]: digest(r) for r in self.records()} != {
                key: digest(r) for key, r in grouped.items()
            }:
                raise ValueError("history does not match current records")
            self.db.executemany(
                "INSERT INTO applied VALUES (?,?)", manifest.get("applied", {}).items()
            )
            if self.version() != manifest["version"]:
                raise ValueError("dataset snapshot version mismatch")
            self.validate_relationships()
        return manifest
