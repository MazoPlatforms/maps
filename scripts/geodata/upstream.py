import json
import tempfile
from pathlib import Path

import duckdb

from .core import digest


def connect():
    return duckdb.connect(config={'extension_directory': str(Path(tempfile.gettempdir()) / 'mazo-duckdb-extensions'), 'custom_extension_repository': 'https://extensions.duckdb.org'})


def query_source(db, url, ids, kind):
    rows = db.execute('SELECT ST_AsGeoJSON(ST_GeomFromWKB(geometry)), to_json(t) FROM read_parquet(?, hive_partitioning=true) t WHERE id IN (SELECT unnest(?))', [str(url), ids]).fetchall()
    found, features = set(), []
    for geom, raw in rows:
        properties = json.loads(raw)
        key = properties['id']
        if key in found:
            raise ValueError('duplicate Overture source ID')
        found.add(key)
        for column in ('geometry', 'bbox', 'id', 'theme', 'type'):
            properties.pop(column, None)
        feature = {'id': key, 'featureType': kind, 'geometry': json.loads(geom), 'properties': properties}
        features.append(feature | {'sha256': digest(feature), 'status': 'present'})
    features.extend({'id': key, 'featureType': kind, 'status': 'missing'} for key in ids if key not in found)
    return features
