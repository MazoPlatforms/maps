#!/usr/bin/env python3
"""Drop style rules only for source layers absent in this release's extract."""
import json
import sys
from pathlib import Path

site = Path(sys.argv[1])
manifest_path = site / "data/batticaloa/manifest.json"
manifest = json.loads(manifest_path.read_text())
styles = {
    "light": site / "assets/styles/batticaloa-light.json",
    "dark": site / "assets/styles/batticaloa-dark.json",
}
archive_layers = {
    name: set(info["layers"])
    for name, info in manifest["archives"].items()
}
omitted = []
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
    style["layers"] = kept
    path.write_text(json.dumps(style, indent=2) + "\n")

unstyled = {
    source: sorted(layers - referenced[source])
    for source, layers in archive_layers.items()
    if layers - referenced[source]
}
if unstyled:
    raise SystemExit(f"PMTiles source layers have no matching light/dark style rules: {unstyled}")

manifest["styleLayersOmittedForAbsentSourceLayers"] = omitted
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Styles retain every available vector layer; omitted {len(omitted)} rules for absent source layers.")
