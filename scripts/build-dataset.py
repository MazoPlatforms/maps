import argparse
import tempfile
from pathlib import Path
from geodata.core import Administration, ROOT
from geodata.store import Store
from geodata.publication import build_publication

p = argparse.ArgumentParser()
p.add_argument("--snapshot", type=Path, default=ROOT / "data/canonical")
p.add_argument("--output", type=Path, required=True)
p.add_argument("--tippecanoe")
a = p.parse_args()
with tempfile.TemporaryDirectory() as temp:
    admin = Administration(ROOT / "data/boundaries/sri-lanka")
    store = Store(Path(temp) / "records.sqlite", admin)
    manifest = store.load_snapshot(a.snapshot)
    print(
        build_publication(store, manifest["metadata"], a.output, a.tippecanoe)[
            "version"
        ]
    )
    store.close()
