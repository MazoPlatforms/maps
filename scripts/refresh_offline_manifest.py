"""Rehash an assembled offline package after production assets are finalized."""

import argparse
import hashlib
from pathlib import Path

from geodata.core import encoded, load


def refresh(site: Path) -> dict:
    site = site.resolve(strict=True)
    path = site / "offline-manifest.json"
    manifest = load(path)
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("offline manifest has no files")
    for item in files:
        relative = Path(item["file"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("unsafe offline asset path")
        target = site / relative
        if target.is_symlink() or not target.resolve(strict=True).is_relative_to(site):
            raise ValueError("offline asset escapes the site root")
        if not target.is_file():
            raise ValueError("offline asset is missing: " + item["file"])
        body = target.read_bytes()
        item["bytes"] = len(body)
        item["sha256"] = hashlib.sha256(body).hexdigest()
    manifest["version"] = hashlib.sha256(encoded(files)).hexdigest()
    path.write_bytes(encoded(manifest))
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    args = parser.parse_args()
    manifest = refresh(args.site)
    print(
        f"Offline manifest refreshed: {len(manifest['files'])} files, "
        f"{sum(item['bytes'] for item in manifest['files'])} bytes, "
        f"coverage complete={manifest['coverage'].get('complete', False)}"
    )


if __name__ == "__main__":
    main()
