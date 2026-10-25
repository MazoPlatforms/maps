# Mazo Maps

**Mazo Maps** is an open-source mapping project by Mazo Platforms, Inc. It publishes a Sri Lanka vector basemap built from official Overture Maps data and displayed with MapLibre.

GitHub Actions resolves the latest official Overture release, extracts features intersecting `[79.3, 5.8, 82.1, 10.1]`, builds four PMTiles archives, validates their feature layers and byte-range delivery, and deploys when the site payload fits GitHub Pages. The release manifest records source counts and archive hashes. This is a regional extract, not a completeness guarantee or a service-coverage claim. Reviewed community JSON records can supplement this upstream baseline; they do not imply complete local coverage.

The website opens directly into a full-screen map with floating search, category
filters, layers, directions handoff and light/dark controls. A small licensed
GeoNames index adds cities and nature destinations at overview zoom. See
[Full-screen map](docs/fullscreen-map.md) for coverage and verification.

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

## Community maintenance

Use the map’s **＋** contribution panel to prepare a JSON proposal. Contributors submit GitHub pull requests; admins review the exact commit before merging. Each accepted feature lives in `records/<type>/<prefix>/<id>.json`; Actions compiles a checksummed community map/search bundle. See [Contributing](CONTRIBUTING.md) for lifecycle, licenses, review checks and required branch rules. Baseline Overture replacements are not enabled by this bounded release.

## Run locally

Serve this directory with any static HTTP server, then open its local URL. For example, with Python:

```sh
node scripts/records.mjs --output data/community
python3 -m http.server 8000
```

MapLibre GL JS is bundled locally. The map requires an internet connection for label glyphs, vector archives, and live routing. Regional vector archives are served from this GitHub Pages site. No API key or secret is required.

Directions are calculated on demand through FOSSGIS OSRM and shown on the map. Requests include the selected map coordinates, are saved in the provider logs, and follow its one request per second and light usage policy. Offline routing uses routes cached on that device only. See [routing, performance and provider limits](docs/performance-routing.md).

## Map attribution and licensing

The map retains Overture Maps and OpenStreetMap attribution in the MapLibre style and visible page notice. Review [Attribution](ATTRIBUTION.md) and [Data sources](docs/DATA_SOURCES.md) before changing sources.

Project source is licensed under MIT; see [LICENSE](LICENSE). Third-party software and data retain their own licenses.

## GitHub Pages

The workflow downloads and processes data only on GitHub-hosted runners. A verified site artifact is retained for seven days. If the assembled site exceeds a 900 MiB safety threshold, Pages deployment is skipped and the artifact remains available from the run. GitHub Pages has a 1 GB published-site limit. In repository settings, set **Build and deployment → Source** to **GitHub Actions**. The project URL is `https://mazoplatforms.github.io/maps/`.

## OpenStreetMap integration roadmap

The project is evaluating a separately sourced OpenStreetMap snapshot alongside the existing Overture baseline. The [OSM + Overture integration policy](docs/OSM_OVERTURE_INTEGRATION.md) defines provenance, licensing, duplicate detection, acceptance checks, and staged activation. **No second OSM basemap or merged dataset is enabled yet.** Existing Overture and community layers remain unchanged.

## Roadmap boundary

The national baseline is the listed Overture regional extract, supplemented by any accepted community JSON records. Coverage depends on the selected release and source data; no Google Maps equivalence or complete local POI coverage is claimed. Label glyphs remain a public external dependency. No geographic data is invented or bundled as a placeholder.
