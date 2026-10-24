"""Same offline transaction path for website exports and fork PR files."""

import argparse
import json
import tempfile
from pathlib import Path
from geodata.core import ROOT, Administration, load, encoded, digest
from geodata.store import Store

p = argparse.ArgumentParser()
p.add_argument("--snapshot", type=Path, default=ROOT / "data/canonical")
p.add_argument("--changesets", type=Path, nargs="*")
p.add_argument("--output", type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
admin = Administration(ROOT / "data/boundaries/sri-lanka")
with tempfile.TemporaryDirectory() as temp:
    store = Store(Path(temp) / "validated.sqlite", admin)
    manifest = store.load_snapshot(a.snapshot)
    paths = (
        a.changesets
        if a.changesets is not None
        else sorted((ROOT / "contributions").glob("*.json"))
    )
    pending = []
    for path in paths:
        if path.is_symlink() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("unsafe changeset input")
        cs = load(path)
        if cs["id"] in manifest.get("applied", {}):
            if manifest["applied"][cs["id"]] != digest(cs):
                raise ValueError("committed applied changeset was altered")
        else:
            pending.append(cs)
    summaries = []
    while pending:
        matches = [cs for cs in pending if cs["baseVersion"] == store.version()]
        if len(matches) != 1:
            raise ValueError(
                "changeset dataset conflict: rebase dependent or concurrent proposals"
            )
        cs = matches[0]
        summaries.append(store.apply(cs))
        pending.remove(cs)
    before = []
    after = []
    text = []
    for summary in summaries:
        for change in summary["changes"]:
            text.append(
                f"- {change['operation']} {change['featureType']} `{change['id']}`"
            )
            for side, collection in [("before", before), ("after", after)]:
                r = change[side]
                if r:
                    collection.append(
                        {
                            "type": "Feature",
                            "geometry": r["geometry"],
                            "properties": {
                                "id": r["id"],
                                "type": r["featureType"],
                                "status": r["status"],
                            },
                        }
                    )
    for side, collection in [("before", before), ("after", after)]:
        (a.output / (side + ".geojson")).write_bytes(
            encoded({"type": "FeatureCollection", "features": collection})
        )
    review = {
        "version": store.version(),
        "changesets": len(summaries),
        "boundaryReview": any(s["boundaryReview"] for s in summaries),
        "changes": text,
    }
    (a.output / "review.json").write_bytes(encoded(review))
    (a.output / "summary.md").write_text(
        "\n".join(text) or "No pending geographic edits.\n"
    )
    store.export_snapshot(a.output / "snapshot", manifest["metadata"])
    store.close()
    print(json.dumps(review))
