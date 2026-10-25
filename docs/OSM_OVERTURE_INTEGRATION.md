# OpenStreetMap + Overture integration policy

Status: design and implementation boundary. **This document does not enable a second source in the published map.**

## Existing production baseline

The published basemap is derived from official Overture regional extracts. Overture can already contain OpenStreetMap-derived features. The reviewed community JSON layer is supplemental and does not rewrite the Overture baseline. Preserve the existing PMTiles pipeline, MapLibre styles, routing handoff, validation and release manifests until a new pipeline passes acceptance tests.

## Source acquisition

1. Obtain an OSM extract from a provider that permits the intended use, recording URL, snapshot date, extract bounds, SHA-256, license and attribution.
2. Use the same Sri Lanka AOI as the existing Overture build. Do not infer that a bounding-box extract is complete.
3. Normalize OSM node/way/relation identities as `osm:node:<id>`, `osm:way:<id>`, and `osm:relation:<id>`. Keep source IDs separate from Mazo community record IDs.
4. Preserve source tags, timestamp where available, geometry, original attribution and dataset version in a provenance sidecar. Do not copy third-party business ratings or opening hours without permission.

## Conflation rules

- Prefer explicit upstream OSM identity when Overture provenance identifies the same OSM object; do not emit it twice.
- Geometry proximity alone is **not** sufficient to merge roads, adjacent buildings, or neighboring shops.
- For place candidates, require compatible feature type, normalized name, and spatial proximity; send uncertain matches to review instead of automatically collapsing them.
- Preserve different shop units at the same address and multiple POIs in the same building.
- Compare transportation topology and routing connectivity separately from rendering geometry.
- Keep OSM-only features in a distinct source layer until attribution, styling, count checks and duplicate sampling pass.
- A community record with an explicit upstream reference may propose a correction, but upstream replacement requires a separate reviewed policy and refresh-conflict resolution. Do not silently mutate Overture data.

## Licensing and publication gate

OpenStreetMap data is ODbL 1.0; Overture themes and constituent sources can have different obligations. Before distributing a combined database, review whether ODbL share-alike applies to the particular combination and whether separate, independently attributed layers are more appropriate. Keep all required source notices visible and retain per-record provenance. MIT licensing of application code does not relicense geographic data.

## Acceptance checks before activation

- Reproducible pinned input snapshots and checksum-verified downloads
- Deterministic normalized output across repeated runs
- Zero duplicate source identities and zero unreviewed conflation decisions
- Valid coordinates and geometries within expected geographic coverage
- OSM-only vs Overture-only vs matched counts in the manifest
- Sampled visual QA in Colombo, Kandy, Jaffna, Batticaloa and Kattankudy
- Search results do not double-list matched places
- Road connectivity and routing regressions tested independently
- Light/dark styles and attribution verified in a real browser
- GitHub Pages size, byte-range and artifact limits checked
- Existing community JSON validation and PR checks remain passing

## Phased delivery

1. Inventory existing Overture source identities and licenses.
2. Add a pinned OSM snapshot acquisition and provenance manifest in CI.
3. Build a **report-only** OSM/Overture overlap analyzer.
4. Review match samples and define source-specific merge thresholds.
5. Publish an optional OSM-only overlay behind an explicit configuration switch.
6. Add search deduplication, browser verification and rollback.
7. Consider combined publication only after legal and geographic QA sign-off.

No synthetic geographic records, hidden source replacement, or automatic OSM edits should be introduced.
