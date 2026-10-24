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
version_hash = hashlib.sha256(
    f"{manifest['release']}:{manifest['builtAt']}:{manifest['overtureTilesImage']}".encode()
)
for asset in sorted((site / "assets").rglob("*")):
    if asset.is_file() and asset.suffix in {".js", ".css", ".json"}:
        # Remove prior cache keys and build substitutions for repeatable finalization.
        content = re.sub(r"\?v=[a-f0-9]+", "", asset.read_text())
        if asset in styles.values():
            style = json.loads(content)
            style.get("metadata", {}).pop("mazo:release", None)
            style["layers"] = [layer for layer in style["layers"] if not layer.get("source") or layer.get("source-layer") in archive_layers[layer["source"]]]
            for source in style.get("sources", {}).values():
                source["url"] = re.sub(r"\.[a-f0-9]{64}\.pmtiles", ".pmtiles", source["url"])
            content = json.dumps(style, sort_keys=True)
        version_hash.update(asset.relative_to(site).as_posix().encode())
        version_hash.update(content.encode())
version = version_hash.hexdigest()[:16]
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
    app.write_text(re.sub(r"(\./(?:config|archive-source)\.js)(?:\?v=[a-f0-9]+)?", rf"\1?v={version}", app.read_text()))
config = site / "assets/js/config.js"
if config.is_file():
    config.write_text(re.sub(r"(sri-lanka-(?:light|dark)\.json)(?:\?v=[a-f0-9]+)?", rf"\1?v={version}", config.read_text()))

manifest["siteVersion"] = version
manifest["styleLayersOmittedForAbsentSourceLayers"] = omitted
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Styles retain every available vector layer; omitted {len(omitted)} rules for absent source layers.")
