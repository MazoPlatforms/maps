# Architecture audit

Audit baseline: `69fb1f3af178d170cc9e13df7f53df5d89ebb340` on 23 October 2026. Every tracked file at that baseline was read; the table records complete-file SHA-256 fingerprints. Minified vendored software was also scanned for module/worker/resource references and dynamic execution surfaces; this is an architectural review, not a formal dependency vulnerability assessment.

## Verified existing architecture

This repository is a static MapLibre viewer, not a server, editor, routing engine or geographic database. It already covers Sri Lanka's bounding box `[79.3, 5.8, 82.1, 10.1]`, including northern, eastern and western islands; it is not an exact national-polygon clip. There were no tracked PMTiles archives or contribution records at the audit baseline. Archives are generated in Actions and published under `data/sri-lanka/` with an accompanying provenance manifest.

The official Overture pipeline resolves a release from its STAC catalog, extracts bbox-filtered Parquet and runs Base, Transportation, Buildings and Places Planetiler profiles. The existing themes expose `land`, `water`, `land_cover`, `land_use`, `infrastructure`, `bathymetry`, `segment`, `connector`, `building`, `building_part` and `place`, subject to actual source availability. Administrative divisions were absent from the original viewer. Labels use the profile's `@name`; transportation filters use `subtype` and `class`. Source row counts are not rendered-feature totals.

The upstream `OvertureProfile.addFullTags` retains primitive source IDs, but size-dependent attributes are insufficient as an all-zoom identity guarantee. Numeric MVT IDs are hashes and may exceed JavaScript's safe-integer range. The contribution architecture uses the exact string `id` property. Refreshed basemaps patch that property to unconditional retention, then sample decoded tiles across zooms and six cities before recording an identity capability in their manifest. Older basemaps cannot publish updates/deletions until a verified refresh succeeds.

The viewer dynamically imports self-hosted MapLibre GL JS 6.15.0 and PMTiles 4.5.0 (bundled fflate 0.8.2). Local light/dark styles use bounds and zoom metadata to avoid irrelevant tile requests. Geographic first-frame detection reveals the map before all labels and archives finish. Content-addressed archive filenames prevent Pages replica timestamp ETags from triggering full-range retries. GPS is requested only after a user gesture. The external OpenFreeMap glyph endpoint remains an availability dependency.

The original Pages workflow tested Node code, ran a native ARM64 builder, verified archives with go-pmtiles 1.31.2, assembled an artifact, enforced a 943,718,400-byte safety ceiling and deployed with Pages OIDC. A successful existing published manifest used Overture 2026-10-21.0 and four archives totaling 933,811,934 bytes, leaving little room for unneeded source data. Artifact retention is seven days; artifacts alone are not durable source storage. The updated assembly copies public assets and optimized layers only, excluding the 28 MB boundary inputs and contribution history.

## Contribution model and integrity

Unchanged Overture data stays in its four optimized archives. A UUID identifies one sparse record for an addition, full replacement or tombstone. Records follow `data/sri-lanka/{province}/{district}/{ds-division}/{feature-type}/{feature-id}.json`. Administrative path segments combine readable names with authoritative codes to avoid collisions. Crossing geometry is never split: the lexicographically first intersected province/district/DS code tuple determines the canonical path, and every positive-measure intersection remains on the record. Points exactly on boundaries retain all covering divisions; polygon/line boundary-only touches do not create false memberships. Classification is two-dimensional WGS84 intersection, not metric area allocation.

Version 1 supports points, multipoints, lines, multilines, polygons and multipolygons, with type constraints. The JSON Schema is strict; the validator additionally rejects nonfinite/out-of-range coordinates, open/self-intersecting polygons, empty/degenerate geometry, duplicate keys/UUIDs/upstream targets, reserved properties, incorrect classification and noncanonical paths. UUIDs and upstream identity/type remain immutable across revisions. Revision hashes support optimistic concurrency, including record moves. Removed records remain immutable tombstones; removing a file is rejected against Git history. A formerly added feature can be tombstoned without inventing an Overture target.

Updates and deletions carry exact upstream IDs, releases and fingerprints. Only touched upstream features are queried from the active Overture release, with DuckDB; no nationwide per-feature JSON expansion occurs. A changed, missing or retyped upstream feature blocks publication. An explicit rebase changes the expected source fingerprint through a new revision; it does not silently alter the edited geometry. Git review remains the trust boundary for provenance and deliberate conflict resolutions. Source snapshots supplied to offline commands are trusted inputs; CI refreshes them from Overture.

The build sorts records and memberships, emits compact content-addressed GeoJSON plus deterministic gzip, suppression lists, administrative references and SHA-256 checksums. It omits wall-clock timestamps and absolute paths. Output is staged in a new directory; it cannot overwrite source records. The sparse overlay has a 16 MiB publication ceiling and each record a 2 MiB ceiling. These are explicit capacity limits, not a claim of unlimited collaborative scale. MapLibre creates its own vector tile index for the sparse GeoJSON overlay. A future larger deployment requires a versioned vector-tile output migration.

The browser checks manifest schema, active release/archive hashes, layer length and SHA-256 before applying changes. Original style rules receive exact source-ID suppression filters; replacement rules use the same styling in the same layer order. Original suppression and overlay installation happen in one style update. Unknown/failed bundles leave the original map available with a notice. Both themes preserve community layers. Source attribution is escaped before use in the attribution control.

## Authoritative administrative dataset

The committed dataset originates from the Survey Department of Sri Lanka and is published by OCHA Field Information Services Section through HDX `cod-ab-lka`. The pinned GeoJSON ZIP resource `ac173fa4-dd42-4be4-aaed-a2e445525865` was modified on 26 January 2026; SHA-256 is `ae6af39f1d440d3b775f0936ff97e5b61c12b99264cc84721cf64e1070a703c7`. Its v03 geometry is valid on 16 August 2022. This is a pinned authoritative historical snapshot, not a claim that every current administrative change is represented.

The imported files preserve original geometries, parent PCODEs and English/Sinhala/Tamil names. Their manifest records compressed-file checksums and derived counts: nine provinces, 25 districts and 339 DS divisions in this snapshot. No DS count is hardcoded into validation. Parent codes are checked; feature classification uses the DS polygons and their authoritative parent references. The import fails on checksum/version/invalid-geometry changes, rather than repairing geography silently. A boundary migration stages reclassified records separately, increments revisions and retains original records for review. Unknown schema versions fail closed; no implicit schema migration rewrites existing records.

An earlier candidate, geoBoundaries gbOpen, was rejected as the combined hierarchy because its province/district snapshots were OSM-derived while its DS snapshot used Survey Department/OCHA data. The selected HDX resource provides all levels consistently. Boundary retrieval and normalization ran on GitHub Actions because the cloud proxy blocked HDX/media downloads; the versioned normalized inputs are now available locally from Git.

## Builds, deployment and verification

The Pages workflow retains the existing ARM64 national build and OIDC deployment. Ordinary contribution/client changes reuse immutable archives from the existing published site, checking complete byte lengths and SHA-256 values. Explicit refreshes and changes to national-build scripts regenerate archives. Contribution validation and touched-source conflict checks run separately, so small edits do not rebuild the basemap. A missing or changed reused archive fails closed; refresh is the recovery path. Deployment is restricted to `main`; development-branch verification cannot replace the public site.

The contribution workflow runs on pull requests and development/main pushes with read-only repository permissions. It executes the existing Node suite, geographic unit/integration tests, Git-history checks, current-upstream resolution, two independent output builds with byte comparison and a real Chrome rendering test. Pages also reruns data tests and validates contributions before assembly. The browser fixture is explicitly synthetic test data and is never published as geography. It verifies an unchanged original, a replacement, an addition and a deletion in both themes. The deployed smoke test checks real nationwide data in six cities, archive range responses, reset controls and mobile overflow.

Existing validation commands are `node --test tests/map.test.mjs`, `scripts/validate-tiles.py` with explicit archive/count/release arguments, `scripts/finalize-styles.py` on an assembled site, and the Playwright-based `scripts/verify-live-map.mjs`. The expanded suites are `node --test tests/*.test.mjs` and Python unittest discovery for `test_*.py`. The contribution CLI implements classification, add/override/update/delete, explicit upstream rebase, validation, staged boundary migration and deterministic publication. Basemap verification still uses the original PMTiles verifier and constrained zoom-header corrections.

## Dependencies, licensing and security

Project software is MIT. MapLibre and PMTiles are BSD-3-Clause; included MapLibre component notices and fflate's MIT notice remain in the site. Geographic data retain their upstream licenses, including Overture/OSM ODbL obligations and Survey Department/OCHA CC BY 3.0 IGO attribution. Per-record sources carry licensing and provenance; project MIT does not relicense those data. Attribution remains visible in the viewer and repository.

Python dependencies and transitive versions are pinned in `requirements-geodata.txt`: Shapely/GEOS-backed geometry, JSON Schema validation and DuckDB upstream queries. Node 22, Python 3.12, Playwright 1.55.0 and go-pmtiles 1.31.2 are selected in CI. The official builder is pinned to the previously verified image digest rather than its former mutable `latest` tag. The patch rejects an unexpected upstream Java source layout. DuckDB downloads version-compatible, signed native extensions for spatial/S3 access; extension hosting and S3 availability remain build dependencies.

The application has no embedded API secret, backend credentials or server-side mutation endpoint. Collaboration currently uses Git branches/reviews and CLI operations, not a multiuser browser editor. CI uses no `pull_request_target` and no secret-bearing writes for untrusted PR code. Pages writes/id-token grants are scoped to deployment. Actions are still version-tag pinned rather than immutable commit pinned; supply-chain review and dependency vulnerability scanning remain ongoing maintenance. No unsupported claim of a vulnerability-free dependency tree is made. Maliciously large/complex geometries can still consume CI CPU within runner limits; limits and geometry validation reduce, but do not eliminate, that risk.

Sparse contributions and complete nationwide tile generation have different determinism boundaries. Contribution bytes/checksums are deterministic for the same records, boundary files, pinned dependencies and active basemap. Existing nationwide builds retain upstream metadata/timestamps and are not asserted to be bit-for-bit reproducible. Immutable published archives are reused byte-for-byte for small changes.

## Complete baseline file inventory

| File | Verified role | SHA-256 |
| --- | --- | --- |
| `.github/workflows/live-map-smoke.yml` | Manual deployed-site Range and Chrome rendering verification; evidence artifacts. | `3aaf0690fcb69af69bf82b128b8d1e01b6c01d9ae5c9066a3ae8b88257c82a72` |
| `.github/workflows/pages.yml` | Native ARM nationwide builder, tests, checksum finalization, size gate and Pages OIDC deployment. | `c967e493a0766ecdef410e0b761dee1d5d155a2510fc9e43d9af2b78724c0573` |
| `.gitignore` | Generated PMTiles, manifest, site, counts and verification exclusions. | `5e0a84fbc5c763bd24be242edcceed8b13129c12f8f7c73011308c1c40c58b55` |
| `.nojekyll` | Pages static asset behavior. | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `ATTRIBUTION.md` | Overture/OSM and vendored dependency attribution. | `c91a081c7614486b4a01cd8da7a4851ab71309f5bb6e25c7359ba5d7f7c9d962` |
| `LICENSE` | Project software MIT license; no geographic-data relicensing. | `650182270e9aa91cda6610f08a2cf43c712a47a46b06f6f404b996c95d8c20ec` |
| `README.md` | Project scope, static development, pipeline and coverage limits. | `27eb34bfeaae71d55b82a1213910343571c5690949a2f86955222fc25ca0407a` |
| `assets/css/site.css` | Responsive layout, first-frame status, themes, focus and reduced-motion styling. | `ee394b75503c5426ff57b5e4f4e7685c9fe063f2b35420e543295e3c775f4364` |
| `assets/js/app.js` | MapLibre boot, PMTiles registration, cached themes, first frame, controls, GPS and test hooks. | `6d485967ce8682be6c481b1cfbf32de2b9dda7b38d6af212a9d289b5455e5884` |
| `assets/js/archive-source.js` | Content-addressed PMTiles ETag normalization; transport and TLS retained. | `f7e874331f1359c6e17b79870a5a1ddc50fd392ccf3f687011229bdc503ddae9` |
| `assets/js/config.js` | Sri Lanka bbox, two style paths and six city views. | `f459c2c74492876357ac7533e10436adcc074aeca4261131c168699a0bb646f8` |
| `assets/mazo-mark.svg` | Static vector logo; no script or external references. | `4b9258888ff61c2107e3cc56a42a6392dd21c19fc38e51473a904e9006ac1b78` |
| `assets/styles/sri-lanka-dark.json` | Dark MapLibre style, four PMTiles sources, source-layer rules and external glyph endpoint. | `19af2339c809ec7049baa69310845068bc7a809a69ec6b88642cc22d3ca3aad2` |
| `assets/styles/sri-lanka-light.json` | Light counterpart with the same layers and source bounds. | `285d5d9f8530afd24ddd373297270d7971b3f5f09ce0be62237eae8ef8709091` |
| `assets/vendor/fflate-license.txt` | Bundled fflate MIT notice. | `0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551` |
| `assets/vendor/maplibre-gl-worker.mjs` | Vendored MapLibre worker; local module, tile decoding and layout. | `1c69066368331aae63967ed24a9affcf962cf55fcc6d8f532a8b040f736dbcfa` |
| `assets/vendor/maplibre-gl.css` | Vendored MapLibre controls and attribution CSS. | `a90798a1953017790e590f7e1bd35ff103a8a4263972cb47290b78adf86f8c20` |
| `assets/vendor/maplibre-gl.mjs` | Vendored MapLibre 6.15.0 ESM renderer; local worker reference. | `41198b23679a7d8892183408bbef2eabdc74745beb90261f6be0f660b7aeb2fd` |
| `assets/vendor/maplibre-license.txt` | BSD-3-Clause and included component notices. | `ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2` |
| `assets/vendor/pmtiles-license.txt` | PMTiles reference implementation BSD-3-Clause notice. | `0371c38f338835f7fc13ed71176f3d92144e22c8b736a31cced57adbbeb647b3` |
| `assets/vendor/pmtiles.mjs` | Bundled PMTiles 4.5.0 and fflate 0.8.2; range fetch/decompression. | `aaf80e875b34b66bd206d6ab63d313cc6e1f6a813bc464373a4ddc8f86e6d41c` |
| `data/overture/README.md` | Generated archive location and authentic source scope. | `2d4e02484ee721d2b52a0790660fd2355cc51ad680fd23e2ee02c43e394200d0` |
| `docs/ARCHITECTURE.md` | Original viewer, pipeline, cache identity and first-frame rationale. | `bb9cd9390619348f8a384d9fee7d9eccf7d43dc7119741545b477609fca5a27e` |
| `docs/DATA_SOURCES.md` | Overture themes, source-count semantics and absence of fabricated geometry. | `42b7ecfd5bbf2cbd390753eecb1690cdcc6e040906c65d22f900af89c63aafea` |
| `docs/index.html` | Static project notes and documentation navigation. | `02f89fbd5ab24932574b2efa7a98188ea56cd6523e78e40c4b1f2c82bf3de663` |
| `index.html` | Accessible viewer shell, controls, six-city selector and visible attribution. | `458dec8af80dafacbbdb7fdac4ee614fef5168f513486e0a87ca2e073bf00293` |
| `scripts/build-overture-theme.sh` | Official bbox Parquet extraction, per-type counts, four Planetiler profiles and cleanup. | `b61cf04333d81fcc65a08f645fdf7864b95bdd416ec398bd229ed65c915333c4` |
| `scripts/finalize-styles.py` | Archive hash verification, immutable filenames, source-layer coverage and client cache stamps. | `8764ca6a250e64deda84b52f38dbffe9eadc2dbd4e54e8887aaf6e47c20e4534` |
| `scripts/validate-tiles.py` | PMTiles verifier, constrained header correction, bbox/layer/count checks and provenance manifest. | `4ceb3e5ffe14c8789a0ea370b82f6e239c663b55f2b9d2198217a002159ae5a0` |
| `scripts/verify-live-map.mjs` | Four live byte ranges, six cities in both themes, mobile controls and screenshots. | `47b213e4b54ab9cceff094e8669dfb4f828efd2c6f62aa14a3881625052a0e9e` |
| `tests/map.test.mjs` | Five existing Node tests covering bounds, first frame, controls/cache, ETags and publication integrity. | `97a1ff28857fb18e45f16da59684663dd2223233d562e6faba510bc507be1f12` |
