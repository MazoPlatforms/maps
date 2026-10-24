"""Verify a fully assembled canonical site before it can be published."""

import argparse
import hashlib
import posixpath
from pathlib import Path

from geodata.core import encoded, load


def checked_file(root: Path, relative: str) -> Path:
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("unsafe published path: " + relative)
    path = root / candidate
    if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
        raise ValueError("published path escapes the site: " + relative)
    if not path.is_file():
        raise ValueError("published asset is missing: " + relative)
    return path


def verify(site: Path) -> dict:
    root = site.resolve(strict=True)
    api = root / "api/v1"
    manifest = load(api / "manifest.json")
    if manifest.get("complete") is not False or manifest.get("records", 0) > 20000:
        raise ValueError("canonical publication must remain bounded and incomplete")
    if not manifest.get("coverage", {}).get("coverage", "").strip():
        raise ValueError("canonical coverage statement is missing")
    schema = load(root / "schemas/feature-v2.json")
    required_types = set(schema["properties"]["featureType"]["enum"])
    if not required_types.issubset(manifest.get("types", {})):
        raise ValueError("canonical API omits supported feature types")
    for relative, descriptor in manifest["files"].items():
        if descriptor.get("file") != relative:
            raise ValueError("canonical API file descriptor mismatch")
        path = checked_file(api, relative)
        body = path.read_bytes()
        if len(body) != descriptor["bytes"] or hashlib.sha256(body).hexdigest() != descriptor["sha256"]:
            raise ValueError("canonical API checksum mismatch: " + relative)
    tile = manifest.get("tiles")
    if not tile:
        raise ValueError("canonical release has no PMTiles archive")
    tile_path = checked_file(root / "data/mazo", tile["file"])
    tile_body = tile_path.read_bytes()
    if len(tile_body) != tile["bytes"] or hashlib.sha256(tile_body).hexdigest() != tile["sha256"]:
        raise ValueError("canonical PMTiles checksum mismatch")
    for theme in ("light", "dark", "offline-light", "offline-dark"):
        style_path = checked_file(root / "data/mazo", theme + ".json")
        style = load(style_path)
        url = style.get("sources", {}).get("mazo", {}).get("url", "")
        if not url.endswith(tile["file"]):
            raise ValueError("canonical style references the wrong tile archive: " + theme)
    license_index = manifest.get("licenses", {})
    license_index_path = checked_file(api, license_index.get("file", ""))
    license_data = load(license_index_path)
    licenses = license_data.get("texts", [])
    if not licenses:
        raise ValueError("canonical source license texts are missing")
    for item in licenses:
        relative = posixpath.normpath(posixpath.join("api/v1", item["file"]))
        path = checked_file(root, relative)
        body = path.read_bytes()
        if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ValueError("source license checksum mismatch: " + item["file"])
    offline = load(root / "offline-manifest.json")
    if not offline.get("files") or offline.get("coverage") != manifest["coverage"]:
        raise ValueError("offline package metadata does not match canonical coverage")
    for item in offline["files"]:
        path = checked_file(root, item["file"])
        body = path.read_bytes()
        if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ValueError("offline package checksum mismatch: " + item["file"])
    if "Independent Mazo sample" not in (root / "index.html").read_text(encoding="utf-8"):
        raise ValueError("public page is missing the explicitly labeled sample entry")
    return {
        "version": manifest["version"],
        "records": manifest["records"],
        "complete": manifest["complete"],
        "coverage": manifest["coverage"],
        "apiFiles": len(manifest["files"]),
        "offlineFiles": len(offline["files"]),
        "offlineBytes": sum(item["bytes"] for item in offline["files"]),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.site)
    print(
        f"Verified canonical publication: {result['records']} records, "
        f"complete={result['complete']}, {result['apiFiles']} API files, "
        f"{result['offlineFiles']} offline assets ({result['offlineBytes']} bytes)"
    )


if __name__ == "__main__":
    main()
