import tempfile
from pathlib import Path

from shapely.geometry import Point

from geodata.core import digest
from geodata.upstream import connect, install_extensions, query_source

with tempfile.TemporaryDirectory() as directory:
    db = connect()
    install_extensions(db, ("spatial",))
    db.execute(
        "CREATE TABLE fixture(id VARCHAR, geometry BLOB, names STRUCT(primary_name VARCHAR), version INTEGER)"
    )
    db.execute(
        "INSERT INTO fixture VALUES (?, ?, ?, ?)",
        ["stable-id", Point(80.7, 7.95).wkb, {"primary_name": "Fixture"}, 1],
    )
    path = Path(directory) / "fixture.parquet"
    db.execute("COPY fixture TO ? (FORMAT PARQUET)", [str(path)])
    records = query_source(db, path, ["stable-id", "missing-id"], "place")
    present = next(f for f in records if f["id"] == "stable-id")
    assert present["geometry"] == {"type": "Point", "coordinates": [80.7, 7.95]}
    assert present["properties"]["names"]["primary_name"] == "Fixture"
    assert present["sha256"] == digest(
        {k: present[k] for k in ("id", "featureType", "geometry", "properties")}
    )
    assert next(f for f in records if f["id"] == "missing-id")["status"] == "missing"
    # Real GeoParquet metadata triggers DuckDB automatic geometry conversion.
    geo = Path(directory) / "geoparquet.parquet"
    db.execute("CREATE TABLE geo AS SELECT id, ST_GeomFromWKB(geometry) AS geometry, names, version FROM fixture")
    db.execute("SET enable_geoparquet_conversion=true")
    db.execute("COPY geo TO ? (FORMAT PARQUET)", [str(geo)])
    db.execute("SET enable_geoparquet_conversion=true")
    assert query_source(db, geo, ["stable-id"], "place")[0]["geometry"] == present["geometry"]
    db.execute("INSERT INTO fixture SELECT * FROM fixture")
    path.unlink()
    db.execute("COPY fixture TO ? (FORMAT PARQUET)", [str(path)])
    try:
        query_source(db, path, ["stable-id"], "place")
    except ValueError as error:
        assert "duplicate" in str(error)
    else:
        raise AssertionError("Duplicate upstream ID accepted")
    db.close()
print(
    "Native DuckDB spatial/Parquet resolution preserved source IDs, geometry and nested properties; missing and duplicate IDs were detected."
)
