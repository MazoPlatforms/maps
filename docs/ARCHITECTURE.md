# Mazo Maps architecture

Mazo Maps is a static GitHub Pages site. The initial release keeps the site and its map configuration in plain HTML, CSS and JavaScript modules; there is no application server, account system, build step or secret-bearing client configuration.

## Current map path

`assets/js/app.js` initializes MapLibre GL JS from a pinned CDN version. `assets/js/config.js` owns the initial center, zoom limits and style URLs. OpenFreeMap supplies the public vector map styles/tiles; the style controls their actual source composition and attribution. The map opens at Colombo as a viewport choice, not as a claim of service coverage. No project-owned POI data is currently loaded.

The map renderer, style provider and project data layers are separate concerns. The theme switch chooses OpenFreeMap Positron or Dark styles while keeping the same camera state. MapLibre's attribution control remains enabled.

## Future source integration

Overture and POI entries in `assets/js/config.js` are explicitly marked `planned`, with no endpoints or layer data. Future adapters should be added only after selecting a dataset release, license, attribution text, geographic coverage, refresh policy and schema. Keep source-specific identifiers and provenance in each feature; never blend datasets in a way that obscures ownership or license obligations. `data/overture/README.md` records the intended extension point.

## Hosting

`.github/workflows/pages.yml` deploys the repository root to GitHub Pages after a push to `main`. No credentials are required for the static site. MapLibre GL JS is loaded from UNPKG and map styles/tiles from OpenFreeMap, so map availability depends on those third parties and internet access. A self-hosted or otherwise contracted map source can later be configured by changing the provider adapter without adding secrets to public files.
