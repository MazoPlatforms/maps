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

## Overview cities and destinations

`assets/data/destinations.geojson` is a small, filtered Sri Lanka gazetteer from
[GeoNames Sri Lanka export](https://download.geonames.org/export/dump/LK.zip),
retrieved 2026-10-24. GeoNames data is licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Credit: [GeoNames](https://www.geonames.org/). Names, alternate names, source IDs,
population and point coordinates are retained; records are filtered to populated
places with population >=10,000, administrative seats, selected named destinations,
and named national parks/nature reserves. Repeated names are deduplicated. Park
points label destinations; they do not represent legal boundaries or entrances.
This index is not an exhaustive address or POI database. Existing Overture and
OpenStreetMap attribution remains applicable to the underlying tiles.


## Routing and typeface

Directions use the public FOSSGIS OSRM routing servers. Route data is derived
from OpenStreetMap (ODbL 1.0): the directions panel credits OpenStreetMap and
links to "Fix the map" as the FOSSGIS service requests. FOSSGIS reports a maximum
of one request per second, prohibits scraping/heavy use, and logs route requests;
its volunteer operated service has no uptime guarantee. See
[service information](https://routing.openstreetmap.de/about.html) and
[OSM based services](https://github.com/fossgis/openstreetmap.de/blob/main/content/nutzen/dienste-osm-de.md).
This public demo endpoint is for light use. Heavier or commercial traffic needs
a dedicated provider or self hosted OSRM service.

The UI uses a self hosted Latin subset of Inter, licensed under the SIL Open Font
License 1.1; the license is included at `assets/fonts/OFL-Inter.txt`.

## Community-maintained records

The optional community layer retains each record's source attribution and license
in `data/community/manifest.json` and its checksummed records bundle. It does not
relicense upstream Overture data. Admins must review evidence and license
compatibility before accepting data. No invented demonstration records are shipped.
See [Contributing](CONTRIBUTING.md).
