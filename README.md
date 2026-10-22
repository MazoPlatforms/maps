# Mazo Maps

**Mazo Maps** is an open-source mapping project by Mazo Platforms, Inc. It begins with an interactive MapLibre map and a clear, extensible structure for future vector-tile and points-of-interest work.

The current map is a public demonstration centered on Colombo. It uses OpenFreeMap styles and OpenStreetMap data; it does not imply RideNow or Mazo service coverage, and it does not yet publish project-owned POIs or Overture data.

## Project structure

```text
index.html                 GitHub Pages site
assets/css/site.css        Responsive presentation and light/dark themes
assets/js/app.js           Theme controls and MapLibre initialization
assets/js/config.js        Map provider settings and future source registry
assets/mazo-mark.svg       Project mark
data/overture/             Documented future data extension point
docs/                      Architecture and data-source notes
.github/workflows/         GitHub Pages deployment
```

## Run locally

Serve this directory with any static HTTP server, then open its local URL. For example, with Python:

```sh
python3 -m http.server 8000
```

The map requires an internet connection to load MapLibre GL JS and OpenFreeMap tiles. The rest of the page remains readable if those services are unavailable. No API key or secret is required.

## Map attribution and licensing

The map displays **OpenFreeMap © OpenMapTiles · Data from OpenStreetMap contributors** using MapLibre's attribution control and a page-level notice. OpenStreetMap data is licensed under ODbL. OpenFreeMap states that commercial usage is allowed, attribution is required, and its public service has no SLA. See [Attribution](ATTRIBUTION.md) before changing map sources.

Project source is licensed under MIT; see [LICENSE](LICENSE). Third-party software and data retain their own licenses.

## GitHub Pages

The workflow deploys the repository root to GitHub Pages on updates to `main`. In repository settings, set **Build and deployment → Source** to **GitHub Actions** if Pages has not already been enabled. The expected project URL is `https://mazoplatforms.github.io/maps/` once Pages is enabled and the workflow completes.

## Roadmap boundary

Overture Maps and POI sources are planned extension points, not live features. No geographic data is invented or bundled as a placeholder. Before adding a source, record its release, license, attribution, coverage, provenance and refresh policy.
