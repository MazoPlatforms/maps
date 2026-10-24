"""Assemble an independent preview/release artifact; does not deploy."""

import argparse
import hashlib
import shutil
from pathlib import Path
from geodata.core import ROOT, encoded, load

p = argparse.ArgumentParser()
p.add_argument("--build", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
a = p.parse_args()
if a.output.exists():
    raise ValueError("site output must be new")
shutil.copytree(a.build, a.output)
for name in [
    "index.html",
    "service-worker.js",
    "LICENSE",
    "ATTRIBUTION.md",
    "LICENSE-DATA.md",
]:
    if (ROOT / name).exists():
        shutil.copyfile(ROOT / name, a.output / name)
for name in ["assets", "sdk", "schemas", "docs"]:
    shutil.copytree(ROOT / name, a.output / name, dirs_exist_ok=True)
licenses = ROOT / "data/canonical/licenses"
if licenses.exists():
    shutil.copytree(licenses, a.output / "data/canonical/licenses")
manifest = load(a.output / "api/v1/manifest.json")
files = []
for path in sorted(a.output.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(a.output)
    if rel.parts[0] in ["docs", "schemas"] or rel.name == "service-worker.js":
        continue
    if rel.parts[0] == "assets" and len(rel.parts) > 1 and rel.parts[1] == "styles":
        continue
    # Geometry-only mode intentionally has no glyph/sprite dependencies.
    if rel.parts[:2] == ("data", "mazo") and rel.name in ["light.json", "dark.json"]:
        continue
    body = path.read_bytes()
    files.append(
        {
            "file": str(rel),
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
        }
    )
version = hashlib.sha256(encoded(files)).hexdigest()
(a.output / "offline-manifest.json").write_bytes(
    encoded(
        {
            "schemaVersion": 1,
            "version": version,
            "datasetVersion": manifest["version"],
            "coverage": manifest["coverage"],
            "regions": load(a.output / "api/v1" / manifest["regions"]["file"])[
                "regions"
            ],
            "mode": "geometry-only; map labels require a complete licensed glyph bundle",
            "files": files,
        }
    )
)
print(version, len(files), sum(f["bytes"] for f in files))
