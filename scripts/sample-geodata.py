"""Bounded, one-time real Overture sample for architecture benchmarks, never production."""
import argparse
import json
import re
import time
from pathlib import Path
from urllib.request import urlopen

from geodata.core import encoded
from geodata.upstream import connect, install_extensions


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--release', default='2026-10-21.0')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', args.release) or args.output.exists():
        raise ValueError('use a valid pinned release and new output directory')
    args.output.mkdir(parents=True)
    db = connect()
    install_extensions(db, ['httpfs', 'spatial'])
    db.execute("SET s3_region='us-west-2'")
    db.execute("SET memory_limit='1GB'")
    db.execute('SET threads=2')
    db.execute('SET enable_geoparquet_conversion=false')
    for theme, kind, limit in [('places', 'place', 2000), ('buildings', 'building', 10000),
                                ('transportation', 'segment', 2000)]:
        started = time.monotonic()
        url = f's3://overturemaps-us-west-2/release/{args.release}/theme={theme}/type={kind}/*'
        # STAC bounds select candidates; verify each item's bounds before trusting
        # the collection's current positional layout. Fail if that layout changes.
        def fetch_json(url):
            with urlopen(url, timeout=60) as response:
                return json.load(response)
        collection = fetch_json(f'https://stac.overturemaps.org/{args.release}/{theme}/{kind}/collection.json')
        items = [link for link in collection['links'] if link['rel'] == 'item']
        bounds = collection['extent']['spatial']['bbox'][1:]
        if len(items) != len(bounds):
            raise ValueError('unexpected STAC partition layout; review sampler')
        files = []
        for link, bbox in zip(items, bounds):
            if bbox[0] <= 80.0 and bbox[2] >= 79.8 and bbox[1] <= 7.1 and bbox[3] >= 6.8:
                item = fetch_json(link['href'])
                if item['bbox'] != bbox:
                    raise ValueError('STAC candidate bounds mismatch')
                files.append(item['assets']['aws']['href'])
        if not files:
            raise ValueError('no STAC candidates')
        rows = db.execute('''SELECT id, ST_AsGeoJSON(ST_GeomFromWKB(geometry)), to_json(t)
            FROM read_parquet(?) t WHERE bbox.xmin >= 79.8 AND bbox.xmax <= 80.0
            AND bbox.ymin >= 6.8 AND bbox.ymax <= 7.1 LIMIT ?''', [files, limit]).fetchall()
        features = []
        for key, geom, raw in rows:
            properties = json.loads(raw)
            for field in ('id', 'geometry', 'bbox'):
                properties.pop(field, None)
            features.append(dict(id=key, featureType='road' if kind == 'segment' else kind,
                                 geometry=json.loads(geom), properties=properties))
        source = dict(provider='overture', release=args.release, url=url,
                      license='CDLA-Permissive-2.0' if theme == 'places' else 'ODbL-1.0')
        path = args.output / (theme + '.json')
        path.write_bytes(encoded({'source': source, 'features': features, 'sampleFiles': files}))
        print(f'{theme}: {len(features)} records, {path.stat().st_size} bytes, '
              f'{time.monotonic() - started:.2f}s', flush=True)


if __name__ == '__main__':
    main()
