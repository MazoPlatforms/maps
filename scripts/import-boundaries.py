import argparse
import gzip
import hashlib
import json
import zipfile
from pathlib import Path

from geodata.core import Administration, encoded, geometry

SOURCE = 'https://data.humdata.org/dataset/0bedcaf3-88cd-4591-b9d5-5d3220e26abf/resource/ac173fa4-dd42-4be4-aaed-a2e445525865/download/lka_admin_boundaries.geojson.zip'
SHA256 = 'ae6af39f1d440d3b775f0936ff97e5b61c12b99264cc84721cf64e1070a703c7'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if hashlib.file_digest(args.archive.open('rb'), 'sha256').hexdigest() != SHA256:
        raise ValueError('authoritative boundary archive checksum mismatch')
    if args.output.exists():
        raise ValueError('boundary version destination already exists')
    manifest = {'schemaVersion': 1, 'version': 'ocha-lka-v03-2026-01-26',
                'source': {'publisher': 'OCHA Field Information Services Section', 'authority': 'Survey Department of Sri Lanka',
                           'url': SOURCE, 'dataset': 'https://data.humdata.org/dataset/cod-ab-lka',
                           'resourceModified': '2026-01-26T15:49:39.853941', 'sha256': SHA256,
                           'license': 'CC BY 3.0 IGO', 'licenseUrl': 'https://creativecommons.org/licenses/by/3.0/igo/',
                           'validOn': '2022-08-16', 'version': 'v03'}, 'levels': {}}
    prepared = {}
    with zipfile.ZipFile(args.archive) as archive:
        for number, level in ((1, 'province'), (2, 'district'), (3, 'dsDivision')):
            original = json.loads(archive.read(f'lka_admin{number}.geojson'))
            features = []
            for f in original['features']:
                p = f['properties']
                if p['version'] != 'v03' or p['valid_on'] != '2022-08-16':
                    raise ValueError('boundary source version changed')
                geometry(f['geometry'], 'administrative_boundary')
                properties = {'id': p[f'adm{number}_pcode'], 'name': p[f'adm{number}_name'],
                              'names': {language: p.get(f'adm{number}_name{suffix}') for language, suffix in [('en', ''), ('si', '1'), ('ta', '2')]}}
                if number >= 2:
                    properties['province'] = p['adm1_pcode']
                if number == 3:
                    properties['district'] = p['adm2_pcode']
                features.append({'type': 'Feature', 'properties': properties, 'geometry': f['geometry']})
            features.sort(key=lambda f: f['properties']['id'])
            body = gzip.compress(encoded({'type': 'FeatureCollection', 'features': features}), mtime=0)
            name = level + '.geojson.gz'
            prepared[name] = body
            manifest['levels'][level] = {'file': name, 'count': len(features), 'sha256': hashlib.sha256(body).hexdigest()}
    args.output.mkdir(parents=True)
    for name, body in prepared.items():
        (args.output / name).write_bytes(body)
    (args.output / 'manifest.json').write_bytes(encoded(manifest))
    Administration(args.output)
    print(json.dumps({level: item['count'] for level, item in manifest['levels'].items()}))


if __name__ == '__main__':
    main()
