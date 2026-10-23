import json
import tempfile
import gzip
import re
import urllib.request
from pathlib import Path

import duckdb

from .core import digest


def connect():
    return duckdb.connect(config={'extension_directory': str(Path(tempfile.gettempdir()) / 'mazo-duckdb-extensions')})


def install_extensions(db, extensions):
    platform = db.execute('PRAGMA platform').fetchone()[0]
    version = duckdb.__version__
    if not re.fullmatch(r'[a-z0-9_]+', platform) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('unsupported DuckDB extension platform')
    for extension in extensions:
        if extension not in ('httpfs', 'spatial'):
            raise ValueError('unsupported extension')
        installed = db.execute('SELECT installed FROM duckdb_extensions() WHERE extension_name = ?', [extension]).fetchone()
        if not installed or not installed[0]:
            url = f'https://extensions.duckdb.org/v{version}/{platform}/{extension}.duckdb_extension.gz'
            with urllib.request.urlopen(url, timeout=120) as response:
                binary = gzip.decompress(response.read())
            with tempfile.TemporaryDirectory(prefix='mazo-extension-') as temporary:
                path = Path(temporary) / (extension + '.duckdb_extension')
                path.write_bytes(binary)
                escaped = str(path).replace("'", "''")
                db.execute("INSTALL '" + escaped + "'")
        db.execute('LOAD ' + extension)


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
