"""Deterministic bounded static API and optimized canonical map publication."""

import hashlib
import json
import math
import shutil
import tempfile
import unicodedata
from pathlib import Path

from shapely.geometry import shape
from .canonical import build as build_tiles, file_digest
from .core import ROOT, digest, encoded


def names(properties):
    result = []

    def visit(value):
        if isinstance(value, str):
            result.append(value)
        elif isinstance(value, dict):
            if isinstance(value.get("value"), str):
                result.append(value["value"])
            else:
                for v in value.values():
                    visit(v)
        elif isinstance(value, list):
            for v in value:
                visit(v)

    visit(properties.get("names", {}))
    for key in ["name", "name:en", "name:si", "name:ta", "alt_name"]:
        visit(properties.get(key, []))
    return sorted(set(result))


def normalize(value):
    return unicodedata.normalize("NFKC", value).casefold().strip()


def build_publication(store, metadata, output, tippecanoe=None):
    output = Path(output)
    if output.exists():
        raise ValueError("publication requires a new destination")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".api-", dir=output.parent))
    try:
        records = {r["id"]: r for r in store.records()}
        if len(records) > 20000:
            raise ValueError(
                "bounded regional release limit exceeded; national export not verified"
            )
        api = stage / "api/v1"
        api.mkdir(parents=True)
        files = {}

        def write(path, value):
            body = encoded(value)
            sha = hashlib.sha256(body).hexdigest()
            # Immutable public resources prevent a CDN mixing revisions.
            p = Path(path)
            filename = str(p.with_name(p.stem + "." + sha + p.suffix))
            (api / filename).parent.mkdir(parents=True, exist_ok=True)
            (api / filename).write_bytes(body)
            entry = {"file": filename, "sha256": sha, "bytes": len(body)}
            files[filename] = entry
            return entry

        buckets = {format(i, "x"): [] for i in range(16)}
        grid = {}
        kinds = {}
        admin_members = {}
        search = {}
        positions = {}
        for r in records.values():
            buckets[r["id"][0]].append(r)
            if r["status"] == "removed":
                continue
            kind = r["featureType"]
            kinds.setdefault(kind, []).append(r["id"])
            g = shape(r["geometry"])
            c = g.representative_point()
            position = [c.x, c.y]
            cell = f"{math.floor(c.x*20)}_{math.floor(c.y*20)}"
            grid.setdefault(cell, []).append(r["id"])
            positions[r["id"]] = position
            for membership in r["administration"]["intersections"]:
                admin_members.setdefault(membership["dsDivision"], []).append(r["id"])
            terms = names(r["properties"])
            if terms:
                entry = {
                    "id": r["id"],
                    "names": terms,
                    "normalized": [normalize(n) for n in terms],
                    "position": position,
                    "type": kind,
                    "category": r["properties"].get("categories", {}),
                    "administration": r["administration"]["canonical"],
                }
                for prefix in {
                    word[:1] for n in terms for word in normalize(n).split()
                }:
                    search.setdefault(prefix, []).append(entry)
        shard_index = {
            key: write(
                "features/" + key + ".json",
                {"records": value, "hashes": {r["id"]: digest(r) for r in value}},
            )
            for key, value in buckets.items()
        }
        search_index = {
            key: write("search/" + str(ord(key)) + ".json", value)
            for key, value in sorted(search.items())
            if key
        }
        kind_index = {
            key: write("types/" + key + ".json", ids)
            for key, ids in sorted(kinds.items())
        }
        # Include empty resource indexes for supported but currently unpopulated kinds.
        from .canonical import VALIDATOR

        for kind in VALIDATOR.schema["properties"]["featureType"]["enum"]:
            if kind not in kind_index:
                kind_index[kind] = write("types/" + kind + ".json", [])
        levels = {}
        for level, features in store.admin.divisions.items():
            levels[level] = write(
                "regions/" + level + ".json", [f["properties"] for f in features]
            )
        region_index = write(
            "regions/index.json",
            {
                "levels": levels,
                "memberships": admin_members,
                "grid": grid,
                "positions": positions,
                "regions": [
                    {
                        "id": "colombo-sample",
                        "name": metadata["name"],
                        "bbox": metadata["bbox"],
                        "complete": False,
                    }
                ],
            },
        )
        from .routing import compile_graph

        graph_entry = write("routing/car.json", compile_graph(list(records.values())))
        tile_manifest = None
        if tippecanoe:
            generated = stage / "tile-build"
            tile_manifest = build_tiles(records, store.admin, generated, tippecanoe)
            target = stage / "data/mazo"
            target.mkdir(parents=True)
            for name in [
                "light.json",
                "dark.json",
                tile_manifest["tiles"]["file"],
                "ATTRIBUTION.md",
            ]:
                shutil.copyfile(generated / name, target / name)
            bundled_glyphs = ROOT / "assets/fonts/manifest.json"
            for theme in ["light", "dark"]:
                style = json.loads((target / (theme + ".json")).read_bytes())
                if bundled_glyphs.exists():
                    style["glyphs"] = (
                        "__MAZO_SITE_ROOT__/assets/fonts/{fontstack}/{range}.pbf"
                    )
                (target / (theme + ".json")).write_bytes(encoded(style))
                if bundled_glyphs.exists():
                    style.pop("sprite", None)
                    symbol_layers = []
                    for layer in style["layers"]:
                        if layer["type"] != "symbol":
                            symbol_layers.append(layer)
                            continue
                        layout = layer.get("layout", {})
                        layout.pop("icon-image", None)
                        if "text-field" in layout:
                            symbol_layers.append(layer)
                    style["layers"] = symbol_layers
                else:
                    style.pop("glyphs", None)
                    style.pop("sprite", None)
                    style["layers"] = [l for l in style["layers"] if l["type"] != "symbol"]
                (target / ("offline-" + theme + ".json")).write_bytes(encoded(style))
            shutil.rmtree(generated)
        license_info = write(
            "licenses.json",
            {
                "notice": "Mazo-maintained derived geographic data; source-specific licenses apply.",
                "sources": [
                    json.loads(s)
                    for s in sorted(
                        {
                            json.dumps(
                                {k: v for k, v in source.items() if k != "id"},
                                sort_keys=True,
                            )
                            for r in records.values()
                            for source in r["sources"]
                        }
                    )
                ],
                "providerNotices": sorted(
                    {
                        str(reference.get("dataset"))
                        + " · "
                        + str(reference.get("license") or "See source-specific notices")
                        for r in records.values()
                        for reference in r["properties"].get("sources") or []
                    }
                ),
                "texts": [
                    {
                        "file": "../../data/canonical/licenses/" + p.name,
                        "sha256": file_digest(p),
                        "bytes": p.stat().st_size,
                    }
                    for p in sorted((ROOT / "data/canonical/licenses").glob("*"))
                    if p.is_file()
                ],
                "notices": "../../LICENSE-DATA.md",
            },
        )
        manifest = {
            "schemaVersion": 1,
            "version": store.version(),
            "recordSchema": 2,
            "coverage": metadata,
            "complete": False,
            "records": len(records),
            "features": shard_index,
            "search": search_index,
            "types": kind_index,
            "regions": region_index,
            "licenses": license_info,
            "routing": graph_entry,
            "tiles": tile_manifest["tiles"] if tile_manifest else None,
            "files": files,
        }
        (api / "manifest.json").write_bytes(encoded(manifest))
        (api / "versions.json").write_bytes(
            encoded({"current": store.version(), "versions": [store.version()]})
        )
        (api / "checksums.json").write_bytes(
            encoded({k: v["sha256"] for k, v in files.items()})
        )
        (stage / "build.json").write_bytes(
            encoded({"datasetVersion": store.version(), "records": len(records)})
        )
        stage.rename(output)
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)
