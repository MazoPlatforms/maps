# Independent geographic database: recovery and migration

**24 October update:** [The indexed regional implementation](storage-decision.md) now materializes complete Mazo-owned records, with an integrated editor/API/SDK/offline/routing checkpoint. This earlier pilot report is retained as history; see [current progress](development-progress.md) and [acceptance evidence](release-acceptance.md).

Verified on 23 October 2026, starting from `main` at `69fb1f3` and the existing remote development branch at `1235be1`. The initial working tree was clean. `git fetch origin` confirmed these heads; there was one development branch, `feat/geographic-contributions`. Work continues there. No changes to main or unrelated files were discarded.

## Recovered implementation

Phase 1 is a working static MapLibre viewer: local renderer/PMTiles dependencies, two themes, city/reset/GPS controls, first-frame loading, immutable archive identities, nationwide tile-generation and Pages workflows, source manifests, and rendering checks. The source tree contains no national canonical feature records or committed national PMTiles.

Phase 2 already supplied authoritative boundary snapshots (9 provinces, 25 districts, 339 DS divisions), classification, contribution schema/CLI, optimistic Git revision history, sparse replacements/tombstones, provenance checks, deterministic overlay generation, and a browser overlay adapter. These tools remain available. The old production architecture uses Overture archives plus sparse suppression/replacement layers. It is a migration compatibility path, **not the target database architecture**.

There was no browser drawing/geometry editor, persistence endpoint, or multiuser editing UI to recover. The existing browser contribution renderer was tested locally in both themes: unchanged, replaced, added and deleted originals behaved correctly. The published manifest inspected in this recovery lacks `sourceIdentity`; the legacy code correctly requires an identity-verified refresh before allowing upstream modifications/deletions against that particular basemap. The earlier audit's reported 984 MB identity-enabled publication is not assumed to describe the current live deployment.

## Canonical contract implemented in the pilot

`schemas/feature-v2.json`, `scripts/geodata/canonical.py` and `scripts/canonical.py` implement an independent full-record model. They perform no upstream fetches. Each imported record stores complete geometry and properties, sources/licenses, immutable original import identity/release/fingerprint, a permanent Mazo UUID, administrative memberships, status, revision and previous-record hash. Nested original properties survive in the record/API; vector tiles keep scalar display attributes.

The requested physical layout is retained:

```
data/sri-lanka/{province}/{district}/{ds-division}/{feature-type}/{feature-id}.json
```

Administrative names include authoritative codes. The existing classifier assigns the lexicographically first intersected province/district/DS tuple as the canonical location, records all positive-measure intersections, and never splits crossing geometry into duplicate records. Geometry movement can change the path but never the Mazo ID. All requested feature types are validated, including administrative boundaries. Existing building parts, land cover, infrastructure and bathymetry types are retained too. Transportation segments retain their original subtype; a nationwide importer must explicitly account for rail and other non-road segments.

Import UUIDv5 identity depends on a fixed Mazo namespace, provider, source feature type and original ID, **not** the source release or administrative path. Imports refuse duplicate identities and never overwrite local edits. Legacy v1 contribution migration retains existing Mazo UUIDs and edited geometry. When importing the national source, the importer must reuse migrated IDs for matching legacy targets rather than producing a second record; that nationwide identity reconciliation is not implemented yet.

Imported records support direct offline updates and deletion. `removed` records remain as tombstones with geometry, properties and provenance intact. Expected record hashes reject stale edits. Multiple uncommitted edits at the repository's canonical root share a revision anchored to HEAD; Git history validates each committed revision, including path moves and deletion retention. Custom pilot roots increment each edit and must supply their own review/history discipline. Source references cannot be removed from revision history; origin fingerprints are historical evidence, never a requirement to recheck upstream.

The physical store and CLI deliberately stop at **20,000 records**. A single record may be up to 16 MiB, accommodating the committed official province geometries that exceed the legacy 2 MiB overlay limit. These are explicit pilot limits. The file store scans records for lookup/edit and the builder retains pilot data in memory; neither is represented as a national storage engine.

## Offline outputs and editor preparation

`canonical.py build` emits a full per-ID JSON API (including tombstones), ID/path/revision/hash index, DS membership index, per-layer GeoJSON sequences, a dataset manifest, attribution and checksums. With pinned Tippecanoe 2.79.0 it also creates a content-addressed PMTiles archive and both styles, using only Mazo records. Every tiled feature has the exact Mazo UUID in the string `id` property. These tiles are generated caches; they are never the editable source. Tile density reduction is allowed for display; complete geometry is retained in records and API. Label glyphs remain the existing external font dependency.

`assets/js/canonical-records.js` resolves a selected Mazo UUID to its canonical API record, checks the hash and identity, resolves canonical styles against the dataset URL, and prepares updates/deletions with an expected revision hash. Persisting an edit still requires the CLI and Git review. This adapter is prepared for an editor, but is not wired into the current production viewer and does not provide drawing, authentication, submission, conflict UI, or a successful-save indicator.

A real preview containing 30 original full-resolution Overture places was tiled and rendered in both themes. A rendered Mazo ID was resolved back to the checksum-verified canonical API record and an edit draft. Browser requests were confined to the local preview. This verifies the independent preview path, **not a national production cutover or every editing feature**.

## Running the pilot

Use Python 3.12 and `requirements-geodata.txt`. Codespaces' default Python was 3.14; a separate temporary Python 3.12 environment was used for verification. Install Tippecanoe from tag `2.79.0`, verified at `68ab8dcc229f95b8b25877697d5e8d66783af503`, when tile output is needed. The contribution workflow has a separate offline canonical tile integration job.

Use a scratch root before the storage decision; no national source records are added to this repository by these commands:

```sh
python scripts/canonical.py --root /tmp/mazo-records import-snapshot /tmp/sample.json
python scripts/canonical.py --root /tmp/mazo-records validate
python scripts/canonical.py --root /tmp/mazo-records get MAZO_UUID
python scripts/canonical.py --root /tmp/mazo-records update MAZO_UUID /tmp/patch.json --expected RECORD_SHA256
python scripts/canonical.py --root /tmp/mazo-records delete MAZO_UUID --expected RECORD_SHA256
python scripts/canonical.py --root /tmp/mazo-records build --output /tmp/mazo-output --tippecanoe /path/to/tippecanoe
```

A snapshot is `{ "source": { "provider": "...", "release": "...", "url": "...", "license": "..." }, "features": [{ "id": "original-source-id", "featureType": "place", "geometry": { ... }, "properties": { ... } }] }`. Additional source-specific attribution must remain in the original properties/source notices. Locally surveyed additions can enter through the same snapshot contract with their own Mazo survey source IDs and license; a dedicated canonical add UI is not implemented. A patch replaces the specified `geometry`, `properties`, or append-only `sources` field. Original nested provider IDs/licenses in `properties.sources` are retained automatically and cannot be removed. Omitted fields remain unchanged. It does not perform a nested JSON merge.

Explicit v1 migration stages records into a new root:

```sh
python scripts/canonical.py --root /tmp/mazo-migrated migrate-v1 /path/to/legacy-record-tree
```

At the repository root, `validate --base-ref COMMIT` verifies Git revision/tombstone history as well as the working tree. The build must target a new directory outside canonical input. Batch imports validate inputs before writing; they are not a transactional national loader and can leave a partial batch after an I/O failure. Never use rendered PMTiles as migration input: clipping, simplification, attribute loss and tile duplication prevent faithful reconstruction.

## Nationwide migration gates and remaining work

1. Decide the physical national storage and durable Mazo-controlled hosting after reviewing [benchmark evidence](canonical-benchmark.md). The requested file layout remains the pilot; the proposed indexed alternative has **not** silently replaced it.
2. Pin allowed source releases and keep full-resolution regional source snapshots, exact source IDs, source notices/license texts, hashes and import counts in durable Mazo storage. The old builder currently deletes its filtered Parquet, so those inputs must be captured during a deliberate one-time import. Short-lived Actions artifacts are not the source of truth.
3. Reconcile legacy contribution targets and imported IDs, preserving all edits and tombstones; import unchanged features as full canonical records. Validate every requested type and account for all source partitions and non-road transportation. Feature merging/splitting requires explicit lineage rules, never implicit ID reuse.
4. Quarantine invalid geometries or records outside the pinned DS coverage for review. Some real sample points fall outside DS polygons; do not fabricate a DS code, move the point, or discard it silently. Offshore/cross-border features and future boundary revisions need an explicit classification policy. Editing administrative boundary features does not automatically change the pinned classifier; publish a versioned classifier migration separately.
5. Build all production PMTiles and APIs from the complete canonical dataset, verify original-vs-import counts/hashes, attribution/license bundles, geometry, tombstones, all-zoom identity, both themes and full national resource budgets. The pilot tile profile is not yet equivalent to the established Overture Planetiler profiles at every zoom. Nested style attributes, minzoom/density choices, land-use availability and all feature types need national visual verification.
6. Change Pages/build workflows and viewer config together to consume a canonical snapshot. Remove automatic upstream refresh/lookup/reuse and legacy suppressions only after a side-by-side acceptance check. Current workflows intentionally continue their legacy behavior until that cutover; putting v2 files into the production tree now fails legacy validation rather than publishing a partial independent map.
7. Add the browser editing UI and a reviewed submission path. The current deliverable is canonical CLI editing and a browser data adapter, not a deployed editor.

Licensing survives migration: Mazo independently maintains its database and IDs, but does not acquire exclusive ownership of upstream copyrights or erase source obligations. Overture's [official attribution/license table](https://docs.overturemaps.org/attribution/) distinguishes ODbL themes, permissive places sources and individual upstream notices. Preserve source-level provenance, review derivative database publication/share-alike obligations and distribute the relevant license texts/notices with the durable dataset. The pilot's license fields and attribution document do not by themselves complete every national redistribution obligation. Survey Department/OCHA boundaries retain CC BY 3.0 IGO attribution. Project MIT applies to software.

## Verification in this recovery

- Python unittest: **29 passed across the current suites** (11 canonical, 14 geodata, 4 history), including real tile generation/decoding. The initial full discovery passed 28 tests; after the provider-provenance fix, `test_canonical.py`, `test_geodata.py` and `test_history.py` each passed again, totaling 29. Set `TIPPECANOE=/path/to/tippecanoe` to exercise the native tile test; otherwise that one integration test is explicitly skipped.
- `node --test tests/*.test.mjs`: **12 passed**, including canonical API checksum/identity/path checks and edit/delete draft preparation.
- `python scripts/verify-upstream.py`: passed native plain-Parquet **and GeoParquet** geometry/properties/ID verification, missing-ID handling and duplicate rejection. Fixed the verified double-decoding bug exposed by DuckDB's automatic GeoParquet conversion.
- `scripts/verify-contributions.mjs`: Chromium passed the existing unchanged/replacement/addition/deletion scenario in both themes.
- `scripts/verify-canonical.mjs /tmp/mazo-canonical-browser`: Chromium rendered 30 real imported places in each theme, resolved a rendered UUID to its canonical API record, prepared an expected-hash draft, and made zero external requests. [Recorded output](benchmarks/canonical-browser.json).
- A second canonical browser check on the 13,995-record regional build rendered buildings and roads in both themes (6,870 rendered tile features per theme, not a unique-record count), resolved a Mazo UUID to its canonical API record, and observed zero external requests. [Recorded output](benchmarks/canonical-regional-browser.json). The camera used a known sampled building coordinate; the limited sample does not cover every camera position.
- `python scripts/canonical.py validate`: passed offline against the current empty canonical tree; this is not evidence of a completed national import.
- Python compilation, workflow YAML parsing and `git diff --check` passed.

No nationwide canonical import, full national canonical tile build, production cutover, browser geometry editing, multiuser persistence, or complete source-license redistribution bundle was tested or completed. No Pages deployment was attempted. Generated geography, temporary comparison repositories, dependencies and browser binaries remained outside the project working tree.
