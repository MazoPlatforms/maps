"""Explicit one-time font bundle capture; normal builds and runtime do not fetch fonts upstream."""

import argparse
import concurrent.futures
import hashlib
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import quote
from geodata.core import ROOT, load, encoded
from geodata.publication import names

p = argparse.ArgumentParser()
p.add_argument("--samples", nargs="+", type=Path, required=True)
a = p.parse_args()
chars = set("".join(chr(i) for i in range(32, 127)))
for path in a.samples:
    for f in load(path)["features"]:
        for name in names(f["properties"]):
            chars.update(name)
ranges = {ord(c) // 256 * 256 for c in chars}
out = ROOT / "assets/fonts" / "Noto Sans Regular"
out.mkdir(parents=True, exist_ok=True)


def fetch(start):
    name = f"{start}-{start+255}.pbf"
    url = (
        "https://tiles.openfreemap.org/fonts/" + quote("Noto Sans Regular") + "/" + name
    )
    with urlopen(url, timeout=60) as response:
        body = response.read()
    if not body or b"<html" in body[:100].lower():
        raise ValueError("invalid glyph response")
    (out / name).write_bytes(body)
    return {
        "file": "Noto Sans Regular/" + name,
        "url": url,
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
    }


entries = list(
    concurrent.futures.ThreadPoolExecutor(max_workers=4).map(fetch, sorted(ranges))
)
(ROOT / "assets/fonts/manifest.json").write_bytes(
    encoded({"font": "Noto Sans Regular", "license": "OFL-1.1", "files": entries})
)
print(len(entries), "glyph ranges captured")
