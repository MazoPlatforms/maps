"""Rebuild indexed Mazo snapshots, validate/apply reviewed changesets, export previews."""
import argparse
import gzip
import json
import tempfile
from pathlib import Path

from geodata.core import Administration, ROOT, encoded, load
from geodata.store import Store


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot',type=Path,default=ROOT/'data/canonical')
    sub=p.add_subparsers(dest='command',required=True)
    for name in ['validate','apply','export-json']:
        c=sub.add_parser(name)
        if name!='export-json':c.add_argument('changesets',type=Path,nargs='*')
        if name in ['apply','export-json']:c.add_argument('--output',type=Path,required=True)
        if name=='validate':c.add_argument('--preview',type=Path)
    args=p.parse_args()
    admin=Administration(ROOT/'data/boundaries/sri-lanka')
    with tempfile.TemporaryDirectory() as temp:
        store=Store(Path(temp)/'canonical.sqlite',admin)
        manifest=store.load_snapshot(args.snapshot)
        summaries=[]
        for path in getattr(args,'changesets',[]):
            if path.stat().st_size>8*1024*1024 or path.is_symlink():raise ValueError('unsafe or excessive changeset')
            cs=load(path)
            if cs['id'] in manifest.get('applied',{}):
                from geodata.core import digest
                if manifest['applied'][cs['id']]!=digest(cs):raise ValueError('applied changeset was modified')
                continue
            summaries.append(store.apply(cs))
        if args.command=='apply':store.export_snapshot(args.output,manifest['metadata'])
        elif args.command=='export-json':
            for r in store.records():
                path=args.output/admin.path(r);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(encoded(r))
        elif args.preview:
            args.preview.mkdir(parents=True,exist_ok=True)
            (args.preview/'summary.json').write_bytes(encoded(summaries))
            for side in ['before','after']:
                features=[]
                for summary in summaries:
                    for change in summary['changes']:
                        r=change[side]
                        if r:features.append({'type':'Feature','geometry':r['geometry'],'properties':{'id':r['id'],'type':r['featureType'],'status':r['status']}})
                (args.preview/(side+'.geojson')).write_bytes(encoded({'type':'FeatureCollection','features':features}))
        print(json.dumps({'version':store.version(),'changesets':len(summaries),'boundaryReview':any(s['boundaryReview'] for s in summaries)}))
        store.close()

if __name__=='__main__':main()
