# Data sources and provenance

## Current

- **Basemap styles and vector tiles:** OpenFreeMap public instance. The project states that commercial use is allowed and requires attribution. MapLibre's attribution control is enabled; the page also identifies OpenFreeMap, OpenMapTiles and OpenStreetMap.
- **Underlying geographic data:** OpenStreetMap contributors, available under the Open Database License (ODbL). See [OpenStreetMap copyright and license](https://www.openstreetmap.org/copyright).
- **Map renderer:** MapLibre GL JS, version 6.15.0 from UNPKG. MapLibre GL JS is open source under the BSD 3-Clause License; see [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js).

The OpenFreeMap public service is provided as-is and does not provide an SLA. This demo does not cache or redistribute its tiles.

## Planned, not yet integrated

- **Overture Maps:** no Overture data is downloaded, hosted or displayed by this site. Before integration, document the chosen release, source theme, format, license, attribution, update cadence and any transformations.
- **Points of interest:** no project POI dataset is published. A provider and data governance policy have not been selected.

## Attribution shown to map visitors

OpenFreeMap © OpenMapTiles · Data from OpenStreetMap contributors. Keep MapLibre's built-in attribution control visible when changing map styles or providers.
