# Mazo Maps

**Mazo Maps** is an open-source mapping project by Mazo Platforms, Inc. It publishes a Sri Lanka vector basemap built from official Overture Maps data and displayed with MapLibre.

GitHub Actions resolves the latest official Overture release, extracts features intersecting `[79.3, 5.8, 82.1, 10.1]`, builds four PMTiles archives, validates their feature layers and byte-range delivery, and deploys when the site payload fits GitHub Pages. The release manifest records source counts and archive hashes. This is a regional extract, not a completeness guarantee or a service-coverage claim. The map does not publish project-owned POIs.

## Project structure

```text
index.html                 GitHub Pages site
assets/css/site.css        Responsive presentation and light/dark themes
assets/js/app.js           Theme controls and MapLibre initialization
assets/js/config.js        Sri Lanka bounds and style configuration
assets/mazo-mark.svg       Project mark
assets/styles/             Light and dark MapLibre styles
data/sri-lanka/            Actions-generated PMTiles and provenance manifest
scripts/                   Tile validation and live range/render smoke checks
docs/                      Architecture, data-source and attribution notes
.github/workflows/         Overture tile build, verification and Pages deployment
```

## Run locally

Serve this directory with any static HTTP server, then open its local URL. For example, with Python:

```sh
python3 -m http.server 8000
```

The map requires an internet connection for MapLibre GL JS and label glyphs. Regional vector archives are served from this GitHub Pages site. No API key or secret is required.

## Map attribution and licensing

The map retains Overture Maps and OpenStreetMap attribution in the MapLibre style and visible page notice. Review [Attribution](ATTRIBUTION.md) and [Data sources](docs/DATA_SOURCES.md) before changing sources.

Project source is licensed under MIT; see [LICENSE](LICENSE). Third-party software and data retain their own licenses.

## GitHub Pages

The workflow downloads and processes data only on GitHub-hosted runners. A verified site artifact is retained for seven days. If the assembled site exceeds a 900 MiB safety threshold, Pages deployment is skipped and the artifact remains available from the run. GitHub Pages has a 1 GB published-site limit. In repository settings, set **Build and deployment → Source** to **GitHub Actions**. The project URL is `https://mazoplatforms.github.io/maps/`.

## Roadmap boundary

Only the listed Overture regional extract is included. Coverage depends on the selected release and source data; no Google Maps equivalence or complete local POI coverage is claimed. Label glyphs remain a public external dependency. No geographic data is invented or bundled as a placeholder.

## Geographic contributions

The existing Overture PMTiles remain the unchanged baseline. Sparse contributions live at `data/sri-lanka/{province}/{district}/{ds-division}/{feature-type}/{feature-id}.json`; directory components include authoritative administrative codes. UUID records carry source references, geometry, schema version, revision history and add/modify/remove status. Cross-division features have one canonical record and all intersected divisions in their classification.

The pinned Survey Department/OCHA boundary dataset and contribution JSON Schema accompany the Python validation/build pipeline. Published community layers are content addressed, checked against the active basemap and loaded by the existing viewer after its first frame. Small contribution changes reuse checksum-verified nationwide archives. [The repository audit](docs/architecture-audit.md) records provenance, architecture, verification and deployment limits.
