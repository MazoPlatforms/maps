import argparse
import json
import re
from pathlib import Path

import duckdb

from geodata.core import LAYER, digest, encoded, load


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--records', type=Path, required=True)
    p.add_argument('--release', required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', args.release):
        raise ValueError('invalid Overture release')
    targets = {}
    for path in sorted(args.records.rglob('*.json')):
        if len(path.relative_to(args.records).parts) != 5:
            continue
        r = load(path)
        if 'upstream' in r:
            key = r['upstream']['id']
            if key in targets:
                raise ValueError('duplicate upstream target')
            targets[key] = r['featureType']
    features = []
    if targets:
        db = duckdb.connect()
        db.execute('INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;')
        db.execute("SET s3_region='us-west-2'")
        for kind in sorted(set(targets.values())):
            theme, layer = LAYER[kind]
            ids = sorted(key for key in targets if targets[key] == kind)
            url = f's3://overturemaps-us-west-2/release/{args.release}/theme={theme}/type={layer}/*'
            rows = db.execute('SELECT ST_AsGeoJSON(ST_GeomFromWKB(geometry)), to_json(t) FROM read_parquet(?, hive_partitioning=true) t WHERE id IN (SELECT unnest(?))', [url, ids]).fetchall()
            found = set()
            for geom, raw in rows:
                properties = json.loads(raw)
                key = properties['id']
                if key in found:
                    raise ValueError('duplicate Overture source ID')
                found.add(key)
                for column in ('geometry', 'bbox', 'id', 'theme', 'type'):
                    properties.pop(column, None)
                f = {'id': key, 'featureType': kind, 'geometry': json.loads(geom), 'properties': properties}
                features.append(f | {'sha256': digest(f), 'status': 'present'})
            features.extend({'id': key, 'featureType': kind, 'status': 'missing'} for key in ids if key not in found)
    result = {'schemaVersion': 1, 'provider': 'overture', 'release': args.release, 'features': sorted(features, key=lambda f: f['id'])}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded(result))


if __name__ == '__main__':
    main()
