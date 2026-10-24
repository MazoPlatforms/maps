import json
import tempfile
from importlib.metadata import distribution
from pathlib import Path

import duckdb

from .core import digest


def connect():
    return duckdb.connect(
        config={
            "extension_directory": str(
                Path(tempfile.gettempdir()) / "mazo-duckdb-extensions"
            )
        }
    )


def install_extensions(db, extensions):
    if db.execute("SELECT current_setting('allow_unsigned_extensions')").fetchone()[0]:
        raise ValueError("unsigned DuckDB extensions are prohibited")
    for extension in extensions:
        if extension not in ("httpfs", "spatial"):
            raise ValueError("unsupported extension")
        package = distribution("duckdb-extension-" + extension)
        if package.version != duckdb.__version__:
            raise ValueError("DuckDB extension version mismatch")
        candidates = [
            package.locate_file(path)
            for path in package.files
            if str(path).endswith("/" + extension + ".duckdb_extension")
        ]
        if len(candidates) != 1:
            raise ValueError("ambiguous packaged extension")
        escaped = str(candidates[0]).replace("'", "''")
        db.execute("INSTALL '" + escaped + "'")
        db.execute("LOAD " + extension)


def query_source(db, url, ids, kind):
    # DuckDB spatial auto-converts GeoParquet WKB to GEOMETRY by default.
    # Keep the same lossless WKB path for GeoParquet and plain Parquet snapshots.
    db.execute("SET enable_geoparquet_conversion=false")
    rows = db.execute(
        "SELECT ST_AsGeoJSON(ST_GeomFromWKB(geometry)), to_json(t) FROM read_parquet(?, hive_partitioning=true) t WHERE id IN (SELECT unnest(?))",
        [str(url), ids],
    ).fetchall()
    found, features = set(), []
    for geom, raw in rows:
        properties = json.loads(raw)
        key = properties["id"]
        if kind == "road" and properties.get("subtype") != "road":
            raise ValueError("upstream transportation subtype conflict")
        if key in found:
            raise ValueError("duplicate Overture source ID")
        found.add(key)
        for column in ("geometry", "bbox", "id", "theme", "type"):
            properties.pop(column, None)
        feature = {
            "id": key,
            "featureType": kind,
            "geometry": json.loads(geom),
            "properties": properties,
        }
        features.append(feature | {"sha256": digest(feature), "status": "present"})
    features.extend(
        {"id": key, "featureType": kind, "status": "missing"}
        for key in ids
        if key not in found
    )
    return features
