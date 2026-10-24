"""Reject rewritten/deleted committed snapshot history against a trusted Git base."""

import argparse
import io
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path
from geodata.core import ROOT, Administration
from geodata.store import Store

p = argparse.ArgumentParser()
p.add_argument("--base-ref", required=True)
p.add_argument("--report", type=Path)
a = p.parse_args()
base = subprocess.check_output(
    ["git", "rev-parse", "--verify", a.base_ref + "^{commit}"], cwd=ROOT, text=True
).strip()
exists = (
    subprocess.run(
        ["git", "cat-file", "-e", base + ":data/canonical/manifest.json"],
        cwd=ROOT,
        capture_output=True,
    ).returncode
    == 0
)
if not exists:
    print(
        "Initial canonical import: no baseline snapshot. Requires explicit maintainer source/license review."
    )
    if a.report:
        a.report.write_text(json.dumps({"boundaryReview": True, "initialImport": True}))
    raise SystemExit(0)
admin = Administration(ROOT / "data/boundaries/sri-lanka")
with tempfile.TemporaryDirectory() as temp:
    temp = Path(temp)
    archive = subprocess.check_output(
        ["git", "archive", base, "data/canonical"], cwd=ROOT
    )
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(temp, filter="data")
    old = Store(temp / "old.sqlite", admin)
    new = Store(temp / "new.sqlite", admin)
    old.load_snapshot(temp / "data/canonical", verify_geometry=False)
    new.load_snapshot(ROOT / "data/canonical")
    for row in old.db.execute("SELECT id,revision,sha,body,changeset FROM history"):
        candidate = new.db.execute(
            "SELECT id,revision,sha,body,changeset FROM history WHERE id=? AND revision=?",
            row[:2],
        ).fetchone()
        if candidate != row:
            raise ValueError(
                "committed feature history was rewritten or removed: " + row[0]
            )
    old_boundaries = {
        r["id"]: r
        for r in old.records()
        if r["featureType"] == "administrative_boundary"
    }
    boundary = any(
        r["featureType"] == "administrative_boundary"
        and r != old_boundaries.get(r["id"])
        for r in new.records()
    )
    if a.report:
        a.report.write_text(
            json.dumps({"boundaryReview": boundary, "initialImport": False})
        )
    print("Committed snapshot history retained; complete head snapshot validated.")
    old.close()
    new.close()
