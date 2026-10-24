"""Bounded real-data benchmark in a NEW scratch directory; never populates this repo."""
import argparse
import gzip
import json
import os
import platform
import resource
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

from geodata.canonical import FileStore, PILOT_LIMIT, build, file_digest, import_feature
from geodata.core import Administration, ROOT, digest, encoded, load


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--samples', type=Path, nargs='+', required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--tippecanoe')
    args = p.parse_args()
    if args.work.exists():
        raise ValueError('work directory must be new')
    args.work.mkdir(parents=True)
    stats = {'date': '2026-10-23', 'platform': platform.platform(), 'python': platform.python_version(),
             'cpus': os.cpu_count(), 'samples': [], 'timingsSeconds': {}, 'cases': []}

    def timed(name, function):
        start = time.perf_counter()
        value = function()
        stats['timingsSeconds'][name] = round(time.perf_counter() - start, 4)
        return value

    admin = timed('loadBoundaries', lambda: Administration(ROOT / 'data/boundaries/sri-lanka'))
    inputs = []
    for path in args.samples:
        snapshot = load(path)
        stats['samples'].append({'file': path.name, 'sha256': file_digest(path),
                                 'features': len(snapshot['features']), 'source': snapshot['source']})
        inputs.extend((feature, snapshot['source']) for feature in snapshot['features'])
    # Sample the median-size full boundary at each level, without invented geometry.
    manifest = load(ROOT / 'data/boundaries/sri-lanka/manifest.json')
    source = manifest['source']
    for level, entry in manifest['levels'].items():
        path = ROOT / 'data/boundaries/sri-lanka' / entry['file']
        stats['samples'].append({'file': path.name, 'sha256': file_digest(path),
                                 'features': entry['count'], 'source': source})
        features = sorted(load(path)['features'], key=lambda f: len(encoded(f)))
        selected = features[len(features) // 2]
        stats['samples'][-1]['selectedIds'] = [selected['properties']['id']]
        for f in [selected]:
            inputs.append((dict(id=f['properties']['id'], featureType='administrative_boundary',
                                geometry=f['geometry'], properties={k: v for k, v in f['properties'].items() if k != 'id'}),
                           dict(provider='Survey Department of Sri Lanka / OCHA',
                                release=manifest['version'], url=source['dataset'], license=source['license'])))
    if len(inputs) > PILOT_LIMIT:
        raise ValueError('sample exceeds pilot capacity')
    stats['unclassified'] = []
    def classify_inputs():
        records = []
        for feature, source in inputs:
            try:
                records.append(import_feature(feature, source, admin))
            except ValueError as error:
                if str(error) != 'geometry does not intersect a Sri Lankan DS division':
                    raise
                stats['unclassified'].append({'id': feature['id'], 'featureType': feature['featureType'],
                                              'reason': str(error)})
        return records
    records = timed('classifyAndValidateImports', classify_inputs)
    stats['records'] = len(records)
    stats['featureTypes'] = {kind: sum(r['featureType'] == kind for r in records)
                             for kind in sorted({r['featureType'] for r in records})}
    # Interleave types at each measured size; preserve all real unique source identities.
    groups = [[r for r in records if r['featureType'] == kind] for kind in stats['featureTypes']]
    ordered = []
    while any(groups):
        for group in groups:
            if group:
                ordered.append(group.pop())
    for size in sorted({min(1000, len(records)), min(5000, len(records)), len(records)}):
        repo = args.work / f'files-{size}'
        repo.mkdir()
        root = repo / 'data/sri-lanka'
        root.mkdir(parents=True)
        store = FileStore(root, admin)
        def git(*arguments):
            return subprocess.check_output(['git', *arguments], cwd=repo, stderr=subprocess.DEVNULL, text=True)
        git('init', '-q')
        git('config', 'user.name', 'Mazo benchmark')
        git('config', 'user.email', 'benchmark@example.invalid')
        case = {'records': size, 'timingsSeconds': {}}
        def measure(name, function):
            start = time.perf_counter()
            result = function()
            case['timingsSeconds'][name] = round(time.perf_counter() - start, 4)
            return result
        measure('writeRecordsWithValidation', lambda: [store.write(r) for r in ordered[:size]])
        state = measure('readValidateAndClassify', store.scan)
        measure('gitAdd', lambda: git('add', 'data'))
        measure('gitInitialCommit', lambda: git('commit', '-qm', 'Real sample'))
        measure('gitStatusClean', lambda: git('status', '--porcelain'))
        old = ordered[0]
        measure('lookupAndEditOne', lambda: store.edit(old['id'], digest(old),
                 {'properties': old['properties'] | {'benchmark_note': 'local edit; not published'}}))
        measure('gitStatusEdited', lambda: git('status', '--porcelain'))
        measure('gitDiffOne', lambda: git('diff', '--stat'))
        git('add', 'data')
        git('commit', '-qm', 'Edit one canonical record')
        measure('gitGc', lambda: git('gc', '--quiet'))
        clone = args.work / f'clone-{size}'
        measure('gitCloneLocal', lambda: subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', str(repo), str(clone)], check=True))
        case['canonicalBytes'] = sum(p.stat().st_size for p in root.rglob('*.json'))
        case['allocatedRecordBytes'] = sum(p.stat().st_blocks * 512 for p in root.rglob('*.json'))
        case['gitBytesAfterGc'] = sum(p.stat().st_size for p in (repo / '.git').rglob('*') if p.is_file())
        case['gitObjects'] = git('count-objects', '-v').strip()
        if size == len(records):
            state = store.scan()
            output = args.work / 'publication'
            built = measure('buildApiIndexesAndPmtiles', lambda: build(state, admin, output, args.tippecanoe))
            case['publicationBytes'] = sum(p.stat().st_size for p in output.rglob('*') if p.is_file())
            case['publicationFiles'] = sum(p.is_file() for p in output.rglob('*'))
            case['tiles'] = built['tiles']
            stats['canonicalBytesPerType'] = {kind: sum(len(encoded(r)) for r in state.values() if r['featureType'] == kind)
                                               for kind in stats['featureTypes']}
            # Measurement-only alternative: same JSON and feature identities in one indexed store.
            db = sqlite3.connect(args.work / 'comparison.sqlite')
            db.execute('CREATE TABLE records (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            measure('sqliteInsertAll', lambda: db.executemany('INSERT INTO records VALUES (?,?)',
                     [(r['id'], encoded(r).decode()) for r in state.values()]))
            db.commit()
            measure('sqliteLookupOne', lambda: db.execute('SELECT body FROM records WHERE id=?', (old['id'],)).fetchone())
            measure('sqliteExportAll', lambda: list(db.execute('SELECT body FROM records ORDER BY id')))
            db.close()
            case['sqliteBytes'] = (args.work / 'comparison.sqlite').stat().st_size
            case['gzipCanonicalBytes'] = len(gzip.compress(b''.join(encoded(r) for r in state.values()), mtime=0))
        stats['cases'].append(case)
        print(json.dumps(case), flush=True)
    stats['peakRssKiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    disk = shutil.disk_usage(args.work)
    stats['scratchDiskFreeBytesAtEnd'] = disk.free
    stats['memoryTotalKiB'] = next(line.strip() for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))
    args.output.write_bytes(encoded(stats))


if __name__ == '__main__':
    main()
