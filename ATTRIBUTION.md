# Attribution and third-party notices

## Geographic data

The regional vector basemap is generated from official Overture Maps data and includes OpenStreetMap-derived content. The map credits:

**© OpenStreetMap contributors, Overture Maps Foundation**

Keep the MapLibre attribution control and visible page-level attribution enabled. See the [Overture Maps attribution guidance](https://docs.overturemaps.org/attribution/) and [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright). OpenStreetMap data is available under the Open Database License (ODbL). Dataset-specific licensing and attribution remain with the source data.

## Map rendering and label glyphs

- **MapLibre GL JS 6.15.0**, served from `assets/vendor/`, under the BSD 3-Clause License: <https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt>.
- **PMTiles JavaScript 4.5.0**, served from `assets/vendor/`, under the BSD 3-Clause License: <https://github.com/protomaps/PMTiles/blob/main/LICENSE>.
- **Label glyphs:** requested from the public OpenFreeMap font endpoint. This is a third-party availability dependency; it does not provide the basemap vector archives.
- **Tile generation:** the GitHub Actions build uses the official Overture `overture-tiles` container and its published profiles and records the resolved container digest in the build manifest.

- **fflate 0.8.2**, bundled with the PMTiles adapter, under the MIT License. Its license is included in `assets/vendor/fflate-license.txt`.

## Project software and fonts

Mazo Maps source code is licensed under MIT; see `LICENSE`. The interface uses system fonts. Third-party data, software and fonts retain their respective licenses.

Do not remove or obscure map data attribution when changing rendering, style or source configuration.
