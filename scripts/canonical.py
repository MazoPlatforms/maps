"""Offline canonical pilot CLI; legacy contributions.py remains available."""
import argparse
import json
from pathlib import Path

from geodata.core import Administration, ROOT, digest, load
from geodata.canonical import FileStore, PILOT_LIMIT, build, import_feature, migrate_record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT / 'data/sri-lanka')
    parser.add_argument('--boundaries', type=Path, default=ROOT / 'data/boundaries/sri-lanka')
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('validate', 'build'):
        p = sub.add_parser(command)
        p.add_argument('--base-ref')
        if command == 'build':
            p.add_argument('--output', type=Path, required=True)
            p.add_argument('--tippecanoe', help='Optional executable; omitted builds API/indexes only')
            p.add_argument('--maxzoom', type=int, choices=range(0, 17), default=14)
    p = sub.add_parser('import-snapshot')
    p.add_argument('input', type=Path, help='JSON {source, features}; full resolution')
    p = sub.add_parser('migrate-v1')
    p.add_argument('input', type=Path, help='Legacy record tree; new root must be empty')
    p = sub.add_parser('get')
    p.add_argument('id')
    for command in ('update', 'delete'):
        p = sub.add_parser(command)
        p.add_argument('id')
        p.add_argument('--expected', required=True, help='Current record SHA-256 from get')
        if command == 'update':
            p.add_argument('patch', type=Path)
    args = parser.parse_args()
    admin = Administration(args.boundaries)
    store = FileStore(args.root, admin)
    if args.command in ('import-snapshot', 'migrate-v1'):
        # Batch validation happens before writes; no national expansion or overwrite.
        if args.command == 'import-snapshot':
            snapshot = load(args.input)
            if len(snapshot['features']) > PILOT_LIMIT:
                raise ValueError('nationwide conversion blocked: pilot limit is 20000')
            records = [import_feature(f, snapshot['source'], admin) for f in snapshot['features']]
        else:
            if args.root.exists():
                raise ValueError('migration requires a new root')
            paths = list(args.input.rglob('*.json'))
            if len(paths) > PILOT_LIMIT:
                raise ValueError('migration exceeds pilot limit')
            records = [migrate_record(load(p), admin) for p in paths
                       if len(p.relative_to(args.input).parts) == 5]
        existing = store.scan()
        ids = [r['id'] for r in records]
        origins = [tuple(r['origin'][k] for k in ('provider', 'featureType', 'id'))
                   for r in [*existing.values(), *records] if 'origin' in r]
        if len(ids) != len(set(ids)) or set(ids) & existing.keys() or len(origins) != len(set(origins)):
            raise ValueError('duplicate identity: import never replaces Mazo edits')
        if len(existing) + len(records) > PILOT_LIMIT:
            raise ValueError('pilot capacity exceeded')
        for record in records:
            store.write(record)
        print(f'{len(records)} canonical records written; commit before publication')
        return
    if args.command in ('update', 'delete'):
        record = store.edit(args.id, args.expected,
                            load(args.patch) if args.command == 'update' else None,
                            remove=args.command == 'delete')
        print(json.dumps({'id': record['id'], 'sha256': digest(record), 'revision': record['revision']}))
        return
    baseline = None
    if getattr(args, 'base_ref', None):
        if args.root.resolve() != (ROOT / 'data/sri-lanka').resolve():
            raise ValueError('--base-ref requires repository canonical root')
        from geodata.history import validate_history
        baseline = validate_history(ROOT, args.base_ref)
    records = store.scan(baseline)
    if args.command == 'get':
        record = records[args.id]
        print(json.dumps({'sha256': digest(record), 'record': record}, ensure_ascii=False))
    elif args.command == 'build':
        if args.root.resolve() == args.output.resolve() or args.root.resolve() in args.output.resolve().parents:
            raise ValueError('build output must be outside canonical records')
        print(json.dumps(build(records, admin, args.output, args.tippecanoe, args.maxzoom)))
    else:
        print(f'{len(records)} canonical records validated offline')


if __name__ == '__main__':
    main()
