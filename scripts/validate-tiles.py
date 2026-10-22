#!/usr/bin/env python3
"""Validate regional Overture PMTiles and write a provenance/size manifest."""
import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_LAYERS = {
    "base": {"land", "water"},
    "transportation": {"segment", "connector"},
    "buildings": {"building"},
    "places": {"place"},
}
SOURCE_LAYERS = {
    "base": {"bathymetry": "bathymetry", "infrastructure": "infrastructure", "land": "land", "land_cover": "land_cover", "land_use": "land_use", "water": "water"},
    "transportation": {"segment": "segment", "connector": "connector"},
    "buildings": {"building": "building", "building_part": "building_part"},
    "places": {"place": "place"},
}
EXPECTED_COUNTS = {
    "base": {"land", "land_use", "water"},
    "transportation": {"segment", "connector"},
    "buildings": {"building"},
    "places": {"place"},
}


def command_json(*args):
    return json.loads(subprocess.check_output(args, text=True))


def first(data, *keys):
    for key in keys:
        if key in data:
            return data[key]
    return None


def check_bounds(header, bbox):
    values = [first(header, *keys) for keys in (
        ("min_lon_e7", "minLonE7"), ("min_lat_e7", "minLatE7"),
        ("max_lon_e7", "maxLonE7"), ("max_lat_e7", "maxLatE7"),
    )]
    if all(value is not None for value in values):
        bounds = [value / 10_000_000 for value in values]
    else:
        bounds = first(header, "bounds")
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise ValueError("PMTiles header is missing verifiable geographic bounds")
    west, south, east, north = bounds
    x0, y0, x1, y1 = bbox
    if east < x0 or west > x1 or north < y0 or south > y1:
        raise ValueError(f"archive bounds {bounds} do not intersect requested bbox {bbox}")
    return bounds


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--counts-dir", required=True, type=Path)
    parser.add_argument("--release", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--bbox", required=True)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    bbox = [float(part) for part in args.bbox.split(",")]
    if len(bbox) != 4 or not (bbox[0] < bbox[2] and bbox[1] < bbox[3]):
        raise ValueError("invalid bbox")

    archives = {}
    input_counts = {}
    for theme in EXPECTED_LAYERS:
        archive = args.data_dir / f"{theme}.pmtiles"
        if not archive.is_file() or archive.stat().st_size == 0:
            raise ValueError(f"missing or empty PMTiles archive: {theme}")
        subprocess.run(["pmtiles", "verify", str(archive)], check=True)
        header = command_json("pmtiles", "show", str(archive), "--header-json")
        metadata = command_json("pmtiles", "show", str(archive), "--metadata")
        layers = {item.get("id", item.get("name")) for item in metadata.get("vector_layers", [])}
        missing = EXPECTED_LAYERS[theme] - layers
        if missing:
            raise ValueError(f"{theme} PMTiles omits required layers: {sorted(missing)}; actual layers: {sorted(layer for layer in layers if layer)}")
        min_zoom = first(header, "min_zoom", "minZoom", "minzoom")
        max_zoom = first(header, "max_zoom", "maxZoom", "maxzoom")
        if not isinstance(min_zoom, int) or not isinstance(max_zoom, int) or max_zoom < min_zoom:
            raise ValueError(f"{theme} PMTiles has invalid zoom metadata")
        bounds = check_bounds(header, bbox)
        digest = sha256_file(archive)
        archives[theme] = {
            "file": archive.name,
            "bytes": archive.stat().st_size,
            "sha256": digest,
            "minZoom": min_zoom,
            "maxZoom": max_zoom,
            "bounds": bounds,
            "tileEntries": first(header, "tile_entries_count", "tileEntriesCount"),
            "layers": sorted(layer for layer in layers if layer),
        }

        count_file = args.counts_dir / f"{theme}.tsv"
        counts = {}
        for line in count_file.read_text().splitlines():
            source_type, row_text, named_text = line.split("\t", 2)
            counts[source_type] = {"rows": int(row_text), "namedRows": int(named_text)}
        unknown_types = set(counts) - SOURCE_LAYERS[theme].keys()
        if unknown_types:
            raise ValueError(f"unrecognized source feature types would be unaccounted for in {theme}: {sorted(unknown_types)}")
        missing_counts = [name for name in EXPECTED_COUNTS[theme] if counts.get(name, {}).get("rows", 0) <= 0]
        if missing_counts:
            raise ValueError(f"no bbox-filtered Overture source rows for {theme}: {missing_counts}")
        omitted = [source_type for source_type, item in counts.items() if item["rows"] and SOURCE_LAYERS[theme][source_type] not in layers]
        if omitted:
            raise ValueError(f"bbox-filtered source types have no corresponding PMTiles layer in {theme}: {sorted(omitted)}")
        if theme == "places" and not any(item["namedRows"] for item in counts.values()):
            raise ValueError("no named place features were present in the bbox-filtered Overture data")
        input_counts[theme] = counts

    manifest = {
        "project": "Mazo Maps",
        "area": "Batticaloa, Sri Lanka",
        "bbox": bbox,
        "release": args.release,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "overtureTilesImage": args.image_digest,
        "archives": archives,
        "bboxFilteredSourceFeatureCounts": input_counts,
        "countNote": "Counts are source Parquet rows selected by Overture's bbox filter before tiling. namedRows counts source rows with a names object; these are not deduplicated rendered-tile feature totals.",
        "attribution": "© OpenStreetMap contributors, Overture Maps Foundation",
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(item["bytes"] for item in archives.values())
    print(f"Validated {len(archives)} PMTiles archives ({total} bytes), Overture {args.release}")


if __name__ == "__main__":
    main()
