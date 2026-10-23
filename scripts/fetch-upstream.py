import argparse
import json
import re
from pathlib import Path


from geodata.core import LAYER, encoded, load
from geodata.upstream import connect, query_source


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
        db = connect()
        db.execute('INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;')
        db.execute("SET s3_region='us-west-2'")
        for kind in sorted(set(targets.values())):
            theme, layer = LAYER[kind]
            ids = sorted(key for key in targets if targets[key] == kind)
            url = f's3://overturemaps-us-west-2/release/{args.release}/theme={theme}/type={layer}/*'
            features.extend(query_source(db, url, ids, kind))
    result = {'schemaVersion': 1, 'provider': 'overture', 'release': args.release, 'features': sorted(features, key=lambda f: f['id'])}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded(result))


if __name__ == '__main__':
    main()
