import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--site', default='https://mazoplatforms.github.io/maps/')
    args = parser.parse_args()
    if not args.site.startswith('https://'):
        raise ValueError('basemap reuse requires HTTPS')
    with urllib.request.urlopen(args.site + 'data/sri-lanka/manifest.json', timeout=60) as response:
        manifest = json.load(response)
    if set(manifest['archives']) != {'base', 'transportation', 'buildings', 'places'}:
        raise ValueError('unexpected basemap themes')
    args.output.mkdir(parents=True, exist_ok=True)
    for theme, archive in manifest['archives'].items():
        sha = archive['sha256']
        if not re.fullmatch('[a-f0-9]{64}', sha) or archive['file'] != f'{theme}.{sha}.pmtiles':
            raise ValueError('invalid immutable archive reference')
        path = args.output / archive['file']
        temporary = path.with_suffix('.partial')
        digest = hashlib.sha256()
        length = 0
        try:
            with urllib.request.urlopen(args.site + 'data/sri-lanka/' + archive['file'], timeout=120) as response, temporary.open('xb') as stream:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    length += len(chunk)
                    if length > archive['bytes']:
                        raise ValueError('archive exceeds declared size')
                    stream.write(chunk)
            if length != archive['bytes'] or digest.hexdigest() != sha:
                raise ValueError('reused archive checksum mismatch')
            temporary.rename(path)
        finally:
            if temporary.exists():
                temporary.unlink()
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
