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
    # Font source TTFs are compiler inputs. Runtime glyph PBFs and their OFL
    # notices are packaged; users do not download the 3.5 MB source originals.
    if rel.parts[:3] == ("assets", "fonts", "source") and rel.suffix.lower() in [".ttf", ".otf", ".woff", ".woff2"]:
        continue
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
font_manifest_path = ROOT / "assets/fonts/manifest.json"
has_fonts = False
if font_manifest_path.exists():
    font_manifest = load(font_manifest_path)
    expected_faces = {
        "Noto Sans Regular",
        "Noto Sans Tamil Regular",
        "Noto Sans Sinhala Regular",
    }
    if font_manifest.get("fontstack") != "Noto Sans Regular" or {
        source.get("name") for source in font_manifest.get("sources", [])
    } != expected_faces:
        raise ValueError("font manifest does not contain the required Noto faces")
    generator_license = (ROOT / font_manifest["generatorLicense"]).resolve()
    license_text = generator_license.read_text(encoding="utf-8")
    if ROOT.resolve() not in generator_license.parents or "All rights reserved" not in license_text or "Redistribution and use" not in license_text:
        raise ValueError("MapLibre font-maker license notice is missing")
    for name, expected in font_manifest["generatorHashes"].items():
        generator_file = (ROOT / "scripts/vendor/maplibre-font-maker" / name).resolve()
        if ROOT.resolve() not in generator_file.parents or hashlib.sha256(generator_file.read_bytes()).hexdigest() != expected:
            raise ValueError(f"font generator input integrity check failed: {name}")
    has_fonts = bool(font_manifest.get("files"))
    for source in font_manifest["sources"]:
        source_path = (ROOT / source["file"]).resolve()
        license_path = (ROOT / source["license"]).resolve()
        if ROOT.resolve() not in source_path.parents or ROOT.resolve() not in license_path.parents:
            raise ValueError("font source path escapes the repository")
        source_bytes = source_path.read_bytes()
        if hashlib.sha256(source_bytes).hexdigest() != source["sha256"]:
            raise ValueError(f"font input integrity check failed: {source['file']}")
        if "SIL OPEN FONT LICENSE" not in license_path.read_text(encoding="utf-8"):
            raise ValueError(f"font license notice missing: {source['license']}")
    listed_ranges = set()
    for item in font_manifest.get("files", []):
        font_path = (ROOT / item["file"]).resolve()
        if ROOT.resolve() not in font_path.parents:
            raise ValueError("font bundle path escapes the repository")
        listed_ranges.add(Path(item["file"]).stem + ".pbf")
        body = font_path.read_bytes()
        if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ValueError(f"font bundle integrity check failed: {item['file']}")
    if not has_fonts:
        raise ValueError("font manifest contains no glyph ranges")
    if listed_ranges != {f"{item}.pbf" for item in font_manifest["ranges"]}:
        raise ValueError("font range manifest and generated glyph files disagree")
    shaping_path = ROOT / "assets/fonts/complex-text-manifest.json"
    shaping = load(shaping_path)
    plugin_path = (ROOT / shaping["runtime"]["file"]).resolve()
    if (ROOT.resolve() not in plugin_path.parents or
            hashlib.sha256(plugin_path.read_bytes()).hexdigest() != shaping["runtime"]["sha256"]):
        raise ValueError("HarfBuzz complex-text runtime is missing or changed")
    plugin_license = ROOT / "assets/vendor/complex-text/LICENSE-MIT.txt"
    if "MIT License" not in plugin_license.read_text(encoding="utf-8"):
        raise ValueError("complex-text runtime MIT notice is missing")
    if "Apache License" not in (ROOT / "assets/vendor/complex-text/LICENSE-Apache-2.0.txt").read_text(encoding="utf-8"):
        raise ValueError("embedded HarfBuzzJS Apache notice is missing")
    if "Permission is hereby granted" not in (ROOT / "assets/vendor/complex-text/LICENSE-HARFBUZZJS-MIT.txt").read_text(encoding="utf-8"):
        raise ValueError("checked HarfBuzzJS source MIT notice is missing")
    if "MIT License" not in (ROOT / "assets/vendor/complex-text/LICENSE-PGF-ENCODING-MIT.txt").read_text(encoding="utf-8"):
        raise ValueError("embedded pgf-encoding MIT notice is missing")
    if len(shaping["files"]) != 30:
        raise ValueError("unexpected encoded complex-text glyph range set")
    for item in shaping["files"]:
        glyph_path = (ROOT / item["file"]).resolve()
        if ROOT.resolve() not in glyph_path.parents:
            raise ValueError("complex-text glyph path escapes the repository")
        body = glyph_path.read_bytes()
        if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ValueError(f"complex-text glyph integrity check failed: {item['file']}")
    if "SIL OPEN FONT LICENSE" not in (ROOT / "assets/fonts/Noto Sans Multiscript Regular/OFL.txt").read_text(encoding="utf-8"):
        raise ValueError("complex-text Noto font OFL notice is missing")
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
            "mode": "glyph-enabled; local Noto Sans and offline HarfBuzz Tamil shaping" if has_fonts else "geometry-only; map labels require a complete licensed glyph bundle",
            "files": files,
        }
    )
)
print(version, len(files), sum(f["bytes"] for f in files))
