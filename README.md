# Mazo Maps

**Mazo Maps** is an open-source mapping project by Mazo Platforms, Inc. Its target is an independently maintained geographic database with permanent Mazo feature IDs. The current production viewer displays a Sri Lanka Overture-derived basemap with MapLibre; an offline canonical-record pilot is available on the development branch.

A nationwide refresh resolves the latest official Overture release, extracts features intersecting `[79.3, 5.8, 82.1, 10.1]`, builds four PMTiles archives, validates their feature layers and byte-range delivery, and deploys when the site payload fits GitHub Pages. The release manifest records source counts and archive hashes. This is a regional extract, not a completeness guarantee or a service-coverage claim. The map does not publish project-owned POIs.

## Project structure

```text
index.html                 GitHub Pages site
assets/css/site.css        Responsive presentation and light/dark themes
assets/js/app.js           Theme controls and MapLibre initialization
assets/js/config.js        Sri Lanka bounds and style configuration
assets/mazo-mark.svg       Project mark
assets/styles/             Light and dark MapLibre styles
data/sri-lanka/            Sparse records; generated PMTiles remain ignored
data/boundaries/           Versioned Survey Department/OCHA hierarchy
scripts/                   Tile validation and live range/render smoke checks
docs/                      Architecture, data-source and attribution notes
.github/workflows/         Overture tile build, verification and Pages deployment
```

## Run locally

Serve this directory with any static HTTP server, then open its local URL. For example, with Python:

```sh
python3 -m http.server 8000
```

The legacy map uses the public OpenFreeMap glyph endpoint. The independent canonical pilot bundles MapLibre, glyphs and Tamil shaping assets for offline use after downloading its region. Regional vector archives and the pilot static API are served from this GitHub Pages site. No API key or secret is required.

## Map attribution and licensing

The map retains Overture Maps and OpenStreetMap attribution in the MapLibre style and visible page notice. Review [Attribution](ATTRIBUTION.md) and [Data sources](docs/DATA_SOURCES.md) before changing sources.

Project source is licensed under MIT; see [LICENSE](LICENSE). Third-party software and data retain their own licenses.

## GitHub Pages

Nationwide processing runs on native ARM64 GitHub-hosted runners; ordinary changes reuse fully checksum-verified published archives. A verified site artifact is retained for seven days. If the assembled site exceeds a 990,000,000-byte safety threshold, Pages deployment is skipped and the artifact remains available from the run. GitHub Pages has a 1 GB published-site limit. Pages uses the GitHub Actions deployment source and deploys only from `main`. The project URL is `https://mazoplatforms.github.io/maps/`.

## Roadmap boundary

Only the listed Overture regional extract is included. Coverage depends on the selected release and source data; no Google Maps equivalence or complete local POI coverage is claimed. The legacy production view still requests label glyphs from a public endpoint; canonical pilot builds bundle their own glyph assets. No geographic data is invented or bundled as a placeholder.

## Geographic contributions

The existing Overture PMTiles remain the unchanged baseline. Sparse contributions live at `data/sri-lanka/{province}/{district}/{ds-division}/{feature-type}/{feature-id}.json`; directory components include authoritative administrative codes. UUID records carry source references, geometry, schema version, revision history and add/modify/remove status. Cross-division features have one canonical record and all intersected divisions in their classification.

The pinned Survey Department/OCHA boundary dataset and contribution JSON Schema accompany the Python validation/build pipeline. Published community layers are content addressed, checked against the active basemap and loaded by the existing viewer after its first frame. Small contribution changes reuse checksum-verified nationwide archives. [The repository audit](docs/architecture-audit.md) records provenance, architecture, verification and deployment limits.

## Independent canonical dataset

The v2 pilot supports full imported records, offline updates/tombstones, stable IDs, provenance, the requested administrative JSON paths, and canonical API/index/PMTiles generation. Nationwide expansion is capped pending the measured storage decision. See [verified recovery and migration requirements](docs/canonical-data.md) and [real-data scalability evidence](docs/canonical-benchmark.md). Existing overlays remain a compatibility path while production cutover is incomplete.

## Integrated regional development release

The existing development branch now includes an independently owned canonical sample, transactional changesets, a browser editor, static `/api/v1/` compiler, JavaScript SDK with TypeScript declarations, English/Tamil/Sinhala search, an offline pilot bundle with self-hosted HarfBuzz Tamil shaping and localized label selection, and experimental car routing. The offline Chromium test uses real OCHA Colombo Tamil/Sinhala names and confirms local glyph requests. This is **not nationwide completion or an approved production deployment**.

Build and run the same website using [deployment and preview instructions](docs/deployment.md). Use `?dataset=canonical` to select the independent sample; the current public national viewer remains the default compatibility mode. See [editor guide](docs/editor-guide.md), [contribution workflow](CONTRIBUTING.md), [API/SDK](docs/api-sdk.md), [offline/routing](docs/offline-routing.md), [storage decision](docs/storage-decision.md), [security](docs/security.md), and [release acceptance](docs/release-acceptance.md). Resume engineering from [development progress](docs/development-progress.md).
