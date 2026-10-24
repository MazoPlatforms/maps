#!/usr/bin/env python3
import hashlib
import json
import re
import sys
from pathlib import Path

site = Path(sys.argv[1])
manifest_path = site / "data/sri-lanka/manifest.json"
manifest = json.loads(manifest_path.read_text())
styles = {
    "light": site / "assets/styles/sri-lanka-light.json",
    "dark": site / "assets/styles/sri-lanka-dark.json",
}
archive_layers = {
    name: set(info["layers"])
    for name, info in manifest["archives"].items()
}
for theme, archive in manifest["archives"].items():
    name = f"{theme}.{archive['sha256']}.pmtiles"
    current = site / "data/sri-lanka" / archive["file"]
    target = current.with_name(name)
    if not current.is_file():
        raise SystemExit(f"Missing archive: {current.name}")
    with current.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != archive["sha256"]:
        raise SystemExit(f"Archive checksum mismatch: {current.name}")
    if current != target:
        current.rename(target)
    archive["file"] = name

omitted = manifest.get("styleLayersOmittedForAbsentSourceLayers", [])
referenced = {name: set() for name in archive_layers}

for theme, path in styles.items():
    style = json.loads(path.read_text())
    kept = []
    for layer in style["layers"]:
        source = layer.get("source")
        source_layer = layer.get("source-layer")
        if source and source_layer:
            if source_layer not in archive_layers[source]:
                omitted.append({"style": theme, "layer": layer["id"], "sourceLayer": source_layer})
                continue
            referenced[source].add(source_layer)
        kept.append(layer)
    for name, source in style["sources"].items():
        base = source["url"].split("?", 1)[0].rsplit("/", 1)[0]
        source["url"] = base + "/" + manifest["archives"][name]["file"]
    style["metadata"]["mazo:release"] = manifest["release"]
    style["layers"] = kept
    path.write_text(json.dumps(style, indent=2) + "\n")

unstyled = {
    source: sorted(layers - referenced[source])
    for source, layers in archive_layers.items()
    if layers - referenced[source]
}
if unstyled:
    raise SystemExit(f"PMTiles source layers have no matching light/dark style rules: {unstyled}")

client_digest = hashlib.sha256()
for directory in (site / "assets/js", site / "assets/styles", site / "assets/css"):
    for path in sorted(directory.glob("*")):
        if path.is_file():
            content = re.sub(rb"\?v=[a-f0-9]{16}", b"", path.read_bytes())
            content = re.sub(rb"\.[a-f0-9]{64}\.pmtiles", b".pmtiles", content)
            client_digest.update(path.name.encode() + content)
version = hashlib.sha256(
    f"{client_digest.hexdigest()}:{manifest['release']}:{manifest['builtAt']}:{manifest['overtureTilesImage']}".encode()
).hexdigest()[:16]

for page in (site / "index.html", site / "docs/index.html"):
    if page.is_file():
        content = re.sub(
            r"(assets/(?:js/app\.js|css/site\.css))(?:\?v=[a-f0-9]+)?",
            rf"\1?v={version}",
            page.read_text(),
        )
        page.write_text(content)

app = site / "assets/js/app.js"
if app.is_file():
    app.write_text(re.sub(r"(\./(?:config|archive-source|contributions)\.js)(?:\?v=[a-f0-9]+)?", rf"\1?v={version}", app.read_text()))
config = site / "assets/js/config.js"
if config.is_file():
    config.write_text(re.sub(r"(sri-lanka-(?:light|dark)\.json)(?:\?v=[a-f0-9]+)?", rf"\1?v={version}", config.read_text()))

manifest["siteVersion"] = version
manifest["styleLayersOmittedForAbsentSourceLayers"] = omitted
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Styles retain every available vector layer; omitted {len(omitted)} rules for absent source layers.")
