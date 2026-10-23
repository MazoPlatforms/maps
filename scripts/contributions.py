import argparse
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from geodata.core import Administration, ROOT, build, digest, encoded, geometry, load, read_upstream, validate_records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT / 'data/sri-lanka')
    parser.add_argument('--boundaries', type=Path, default=ROOT / 'data/boundaries/sri-lanka')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('validate', 'build'):
        p = sub.add_parser(name)
        p.add_argument('--basemap', type=Path, required=True)
        p.add_argument('--upstream', type=Path)
        p.add_argument('--baseline', type=Path)
        p.add_argument('--base-ref')
        if name == 'build':
            p.add_argument('--output', type=Path, required=True)
    p = sub.add_parser('classify')
    p.add_argument('geometry', type=Path)
    p = sub.add_parser('add')
    p.add_argument('input', type=Path)
    p = sub.add_parser('override')
    p.add_argument('input', type=Path)
    p.add_argument('--snapshot', type=Path, required=True)
    p.add_argument('--source-id', required=True)
    p = sub.add_parser('update')
    p.add_argument('id')
    p.add_argument('input', type=Path)
    p = sub.add_parser('rebase')
    p.add_argument('id')
    p.add_argument('--snapshot', type=Path, required=True)
    p = sub.add_parser('delete')
    p.add_argument('id')
    p = sub.add_parser('migrate')
    p.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    admin = Administration(args.boundaries)
    if args.command == 'classify':
        print(encoded(admin.classify(load(args.geometry))).decode(), end='')
        return
    if args.command in ('validate', 'build'):
        basemap = load(args.basemap)
        upstream = read_upstream(args.upstream, basemap['release'])
        baseline = None
        if args.baseline:
            baseline = {r['id']: r for p in args.baseline.rglob('*.json') if len(p.relative_to(args.baseline).parts) == 5 for r in [load(p)]}
        if args.base_ref:
            commit = subprocess.check_output(['git', 'rev-parse', '--verify', args.base_ref + '^{commit}'], cwd=ROOT, text=True).strip()
            paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit, 'data/sri-lanka'], cwd=ROOT, text=True).splitlines()
            baseline = {}
            for name in paths:
                if name.endswith('.json') and len(Path(name).parts) == 7:
                    r = json.loads(subprocess.check_output(['git', 'show', commit + ':' + name], cwd=ROOT))
                    if r['id'] in baseline:
                        raise ValueError('duplicate baseline ID')
                    baseline[r['id']] = r
        records = validate_records(args.root, admin, upstream, baseline)
        if args.command == 'build':
            if args.output.resolve() == args.root.resolve() or args.root.resolve() in args.output.resolve().parents:
                raise ValueError('build output must be outside contribution records')
            args.output.parent.mkdir(parents=True, exist_ok=True)
            if args.output.exists():
                raise ValueError('build output already exists')
            temporary = Path(tempfile.mkdtemp(prefix='.contributions-', dir=args.output.parent))
            try:
                build(records, admin, upstream, basemap, temporary)
                temporary.rename(args.output)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        print(f'{len(records)} contribution records validated')
        return
    existing = {}
    if args.root.is_symlink() or any(p.is_symlink() for p in args.root.rglob('*')):
        raise ValueError('symlink contribution path')
    for path in args.root.rglob('*.json'):
        if len(path.relative_to(args.root).parts) != 5:
            continue
        record = load(path)
        if record['id'] in existing:
            raise ValueError('duplicate permanent ID')
        existing[record['id']] = (path, record)
    if args.command == 'migrate':
        if args.output.exists() or args.output.resolve() == args.root.resolve() or args.root.resolve() in args.output.resolve().parents:
            raise ValueError('migration requires a new destination')
        staged = []
        for _, r in existing.values():
            if r['schemaVersion'] != 1:
                raise ValueError('unsupported schema migration')
            new_admin = admin.classify(r['geometry'])
            if new_admin != r['administration']:
                r = r | {'administration': new_admin, 'revision': r['revision'] + 1, 'previous': digest(r)}
            staged.append((admin.path(r), r))
        for path, r in staged:
            destination = args.output / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(encoded(r))
        print(f'{len(staged)} records staged for boundary migration')
        return
    if args.command == 'override':
        snapshot = load(args.snapshot)
        current = read_upstream(args.snapshot, snapshot['release']).get(args.source_id)
        if not current or current.get('status') != 'present':
            raise ValueError('upstream feature unavailable')
        r = load(args.input)
        r.update(schemaVersion=1, id=str(uuid.uuid4()), status='modified', revision=1, previous=None,
                 featureType=current['featureType'], upstream={k: current[k] for k in ('id', 'release', 'sha256', 'featureType')})
        r.setdefault('geometry', current['geometry'])
        r.setdefault('properties', current['properties'])
        previous_path = None
    elif args.command == 'add':
        r = load(args.input)
        r.update(schemaVersion=1, id=str(uuid.uuid4()), status='added', revision=1, previous=None)
        previous_path = None
    else:
        if args.id not in existing:
            raise ValueError('unknown permanent ID')
        previous_path, old = existing[args.id]
        if old['status'] == 'removed' and args.command != 'rebase':
            raise ValueError('tombstones are immutable')
        r = dict(old)
        if args.command == 'update':
            patch = load(args.input)
            if set(patch) - {'geometry', 'properties', 'sources'}:
                raise ValueError('identity fields are immutable')
            r.update(patch)
        elif args.command == 'rebase':
            if 'upstream' not in old:
                raise ValueError('record has no upstream target')
            snapshot = load(args.snapshot)
            current = read_upstream(args.snapshot, snapshot['release']).get(old['upstream']['id'])
            if not current or current.get('status') != 'present' or current['featureType'] != old['featureType']:
                raise ValueError('upstream target missing or changed type')
            r['upstream'] = {k: current[k] for k in ('id', 'release', 'sha256', 'featureType')}
            source = next(s for s in old['sources'] if s['provider'] == 'overture' and s['id'] == current['id'])
            reference = source | {'release': current['release']}
            r['sources'] = old['sources'] + ([reference] if reference not in old['sources'] else [])
        else:
            r['status'] = 'removed'
        r.update(revision=old['revision'] + 1, previous=digest(old))
    geometry(r['geometry'], r['featureType'])
    r['administration'] = admin.classify(r['geometry'])
    from jsonschema import Draft202012Validator, FormatChecker
    Draft202012Validator(load(ROOT / 'schemas/contribution-v1.json'), format_checker=FormatChecker()).validate(r)
    path = args.root / admin.path(r)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path != previous_path:
        raise ValueError('record collision')
    descriptor, temp = tempfile.mkstemp(dir=path.parent, prefix='.record-')
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(encoded(r))
        os.replace(temp, path)
    finally:
        if Path(temp).exists():
            Path(temp).unlink()
    if previous_path and previous_path != path:
        previous_path.unlink()
    print(path.relative_to(args.root))


if __name__ == '__main__':
    main()
