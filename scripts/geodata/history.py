import json
import subprocess
from pathlib import Path

from .core import digest


def git(repo, *arguments):
    return subprocess.check_output(["git", *arguments], cwd=repo, text=True).strip()


def records_at(repo, ref):
    commit = git(repo, "rev-parse", "--verify", ref + "^{commit}")
    names = git(
        repo, "ls-tree", "-r", "--name-only", commit, "data/sri-lanka"
    ).splitlines()
    records = {}
    for name in names:
        if name.endswith(".json") and len(Path(name).parts) == 7:
            record = json.loads(git(repo, "show", commit + ":" + name))
            if record["id"] in records:
                raise ValueError("duplicate historical permanent ID")
            records[record["id"]] = record
    return records


def check_revision(record, old):
    if old is None:
        if record["revision"] != 1 or record["previous"] is not None:
            raise ValueError("new record requires revision one")
        return
    if digest(record) == digest(old):
        return
    if record["revision"] != old["revision"] + 1 or record["previous"] != digest(old):
        raise ValueError("revision conflict")
    if old["status"] == "removed" and any(
        record[key] != old[key] for key in ("status", "geometry", "properties")
    ):
        raise ValueError("tombstone content changed")
    if record["id"] != old["id"] or record["featureType"] != old["featureType"] or any(
        record.get("origin", record.get("upstream", {})).get(key) != old.get("origin", old.get("upstream", {})).get(key)
        for key in ("id", "featureType")
    ):
        raise ValueError("permanent source identity changed")

    if record.get("schemaVersion") == 2:
        if any(source not in record["sources"] for source in old["sources"]):
            raise ValueError("source provenance and licensing must be retained")
        original_references = old.get("properties", {}).get("sources") or []
        current_references = record.get("properties", {}).get("sources") or []
        if any(reference not in current_references for reference in original_references):
            raise ValueError("original per-provider source references must be retained")
        if old.get("schemaVersion") == 2 and record.get("origin") != old.get("origin"):
            raise ValueError("original import provenance is immutable")


def validate_history(repo, base, head="HEAD"):
    base = git(repo, "rev-parse", "--verify", base + "^{commit}")
    head = git(repo, "rev-parse", "--verify", head + "^{commit}")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", base, head], cwd=repo, check=True
    )
    commits = git(
        repo,
        "rev-list",
        "--reverse",
        "--topo-order",
        base + ".." + head,
        "--",
        "data/sri-lanka",
    ).splitlines()
    for commit in commits:
        current = records_at(repo, commit)
        parents = git(repo, "show", "-s", "--format=%P", commit).split()
        states = [records_at(repo, parent) for parent in parents] or [{}]
        if set().union(*(set(state) for state in states)) - set(current):
            raise ValueError("historical records must be retained as tombstones")
        for key, record in current.items():
            candidates = [state[key] for state in states if key in state]
            if any(digest(record) == digest(old) for old in candidates):
                continue
            failures = []
            for old in candidates or [None]:
                try:
                    check_revision(record, old)
                    break
                except ValueError as error:
                    failures.append(error)
            else:
                raise ValueError(f"historical revision conflict: {key}") from failures[
                    0
                ]
    return records_at(repo, head)


def next_revision(repo, record):
    committed = records_at(repo, "HEAD").get(record["id"])
    if committed is None:
        return {"revision": 1, "previous": None}
    return {"revision": committed["revision"] + 1, "previous": digest(committed)}
