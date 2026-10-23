# Mazo Maps architecture

Mazo Maps is a static MapLibre site. GitHub Actions resolves the current official Overture release, filters source features by bbox, runs the published Overture PMTiles profiles, validates the archives, and publishes the site through GitHub Pages. No map-data build or local dependency installation is required.

## Regional data pipeline

The configured bbox is `[79.3, 5.8, 82.1, 10.1]` (min longitude, min latitude, max longitude, max latitude). The workflow builds four separate PMTiles archives using the official Overture tile-builder image and its bbox filter:

- `base.pmtiles`: land, land cover, land use, water, and any other base-theme feature layers present in the extract.
- `transportation.pmtiles`: road/rail segments and connectors.
- `buildings.pmtiles`: buildings and building parts where present.
- `places.pmtiles`: place features, including primary names where source names are available.

The official bbox operation selects features whose bounding boxes intersect the region. Geometries are not clipped to the bbox. It does not create or infer missing features. Tile profiles define zoom ranges; the coverage manifest records the actual release, input row counts, named-row counts, builder image digest, archive sizes, hashes, metadata and available layer names. Counts are source Parquet rows before tile deduplication, not visible-map feature totals. The manifest is not a completeness guarantee.

The build fails if required source types are empty, a non-empty source type has no corresponding output layer, the PMTiles archive is invalid, an available vector layer has no light/dark style rule, or named place records are absent. Source types with zero intersecting rows are listed explicitly in the manifest; their empty style rules are removed from the published copy, while every available layer must be styled. Other feature types that are present are reported rather than silently discarded. GitHub Pages deployment is skipped above a 900 MiB safety threshold; the assembled site is still uploaded as a short-lived Actions artifact. The hard published-site limit is 1 GB.

## Browser map

`assets/js/config.js` owns map bounds and style URLs. Light and dark MapLibre styles reference same-origin PMTiles archives through the PMTiles protocol and retain source attribution. MapLibre GL JS and the PMTiles browser adapter are loaded from version-pinned CDN URLs. Label glyphs are served by the public OpenFreeMap font endpoint; this is an external dependency and is not part of the self-hosted geographic archive.

The initial and reset camera fit the full Sri Lanka extent with padding on desktop and mobile. Roads and place names use Overture's primary-name property where it exists. MapLibre's attribution control remains enabled alongside the page-level notice.

## Verification and publication

Before deploy, `scripts/validate-tiles.py` verifies archive structure, geographic bounds, zoom metadata, required vector layers, input feature counts and SHA-256 hashes. It writes `data/sri-lanka/manifest.json`. After deploy, an Actions browser job checks HTTP byte-range responses for each archive, waits for the map to load, queries rendered road, building and place layers in Colombo, Jaffna, Trincomalee, Batticaloa, Kandy and Galle in both themes, captures a screenshot and uploads the verification evidence as an Actions artifact.

The Pages deployment and live browser test are skipped if the site exceeds the safe size threshold. This avoids claiming a deployed map when GitHub Pages cannot host the payload; the build artifact remains available from the Actions run.

## Scope and future data

This is a regional Overture extract, not Google Maps-equivalent coverage, a routing service, a live traffic product, or an operational service boundary. No project-owned POIs are added. New sources must document release, license, attribution, geographic coverage, provenance and refresh policy before they are integrated. See [Data sources](DATA_SOURCES.md) and [Attribution](../ATTRIBUTION.md).
