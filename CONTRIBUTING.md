# Contributing geography and code

Use the existing development branch `feat/geographic-contributions`. Do not merge unreviewed changes into main. Geographic source records are Mazo-owned snapshots; compiled API, routing and tile files are generated.

## Website

Open **Independent Mazo sample**, then **Edit Mazo sample**. Select a real canonical feature or draw a new one. Provide your source URL, name and summary, accept the contribution terms, preview the changeset, and choose **Download & submit**. Fork the repository with all branches (uncheck **Copy main branch only**), create a contribution branch from **feat/geographic-contributions**, upload the downloaded JSON to `contributions/` there, and open a PR targeting the development branch. The website does not hold tokens, authenticate users, upload files or create PRs automatically. GitHub handles your login, fork and PR creation directly.

## Direct fork or command-line contribution

Use `schemas/changeset-v1.json` and the same complete canonical records. First materialize the complete snapshot plus transaction journal with `python scripts/validate-changesets.py --output /tmp/current`, then export individual logical administrative JSON files with `python scripts/dataset.py --snapshot /tmp/current/snapshot export-json --output /tmp/records`. A bare baseline snapshot does not include later journal operations. Read the dataset version from the canonical manifest and the expected record hash from the API feature shard (`hashes[id]`). Submit `create`, `update`, or `delete` operations. Never invent an expected hash, edit identity/origin fields, remove licensing, or physically delete source history.

Run:

```sh
python scripts/validate-changesets.py --changesets contributions/YOUR_CHANGESET.json --output /tmp/review
```

The command applies operations atomically to an isolated indexed store, checks geometry/bounds, authoritative administrative membership, source licensing references, IDs, prior hashes, tombstones, unsafe metadata and supported routing relationships, then writes before/after GeoJSON and a summary. Dataset conflicts must be rebased against the current version; concurrent independent proposals are not silently merged. Raw snapshot edits require a deliberate source-import/history review, not a browser changeset.

## Review and publication

At least one authorized maintainer must approve ordinary geography; two must approve administrative boundary changes. Maintainers must inspect source rights, expected geometry changes, routing impact and CI previews. GitHub confirmed `itzmzn` has administrator permission; `.github/CODEOWNERS` and `.github/maintainers.json` name that verified maintainer. A read-only exact-head approval job loads its script and allowlist from the trusted base commit. Branch-protection settings still returned 403 and enforcement is unverified. A second authorized boundary reviewer, administrator-reviewed policy bootstrap on the protected base, and verified required checks are production blockers. A PR author cannot satisfy approval policy by adding a field or label to a changeset.

The canonical CI workflow has read-only permissions and uploads a reviewable regional site artifact. It uses no privileged secrets and does not deploy. The existing main Pages workflow is preserved; it does not yet publish this incomplete canonical release. Accepted proposals can be materialized with `scripts/validate-changesets.py` and consumed by `scripts/build-dataset.py --snapshot /tmp/review/snapshot`. Repeated generation emits the same canonical API bytes and reuses unchanged content hashes. PMTiles are rebuilt for this one small region; affected-district national incremental builds remain unimplemented.

Do not treat a successful build artifact as an approved or deployed production map. Font capture, license review, branch protection, complete editing/topology acceptance and production hosting gates remain open.

## History, undo and reverts

Local undo/redo changes only a draft. Source history records full committed revisions and changeset IDs; snapshots and Git history support deterministic restoration. To reverse an accepted update, submit a new expected-hash update restoring the old geometry/properties while retaining provenance. To reverse a creation, submit a tombstone deletion. Restoring a tombstoned permanent ID is intentionally rejected by the existing contract and requires a separately reviewed restoration/lineage policy; do not fabricate a replacement identity or rewrite old history.

See `LICENSE-DATA.md` for contributor and geographic data terms. Code is MIT. Do not submit credentials or personal/confidential observations.
