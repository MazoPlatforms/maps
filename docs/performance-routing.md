# Map performance and directions

## Current loading profile

The deployed map renders local, content-addressed PMTiles through HTTP byte-range
requests. MapLibre asks for tiles that intersect the current viewport and zoom;
the site does not fetch an island-wide GeoJSON copy of its buildings and roads.
Archive byte ranges use their SHA-256 filename as a stable cache validator, and
GitHub Pages serves the normal gzip/Brotli-compressed text assets. MapLibre is
self-hosted. The overview index is 34,297 bytes uncompressed (79 licensed points);
it is fetched once after initial map rendering, indexed once, and shared with the
map source. Search work is debounced and searches the prebuilt local name/alias
index plus the visible POIs.

The self-hosted Latin Inter WOFF2 subset is 38,380 bytes, loaded with `font-display:
swap`; the SIL OFL license is in `assets/fonts/OFL-Inter.txt`. The build's asset
fingerprint includes JavaScript, styles, JSON/GeoJSON and fonts, so versioned
imports and browser caches invalidate when those assets change.

The browser verifier uses actual published PMTiles byte ranges and four desktop /
mobile, light / dark map contexts. Mobile runs at DPR 3 (MapLibre caps its render
ratio at 2), with a 4x CPU slowdown and 150ms / 1.6Mbps network emulation. It
records first visible frame, device-pixel ratio, rendered tiles/features, transfer
bytes, JavaScript heap, overview-index time and route response size. These are
repeatable Chromium measurements, not claims about every Android handset. The
main-branch live smoke test checks both themes in six cities, viewport fit, the
published manifest, and HTTP 206 responses for each archive. Run the same checks
with `node --test tests/*.test.mjs` and the Pages workflow.

## In-app directions

The directions panel calls FOSSGIS's public OSRM endpoints for car, bicycle and
foot routes. A request includes the two selected map coordinates. The service logs
requests; do not enter private locations or personal data. Route geometry is
rendered as a GeoJSON line on the Mazo map, with endpoint markers, measured
kilometres, estimated time and OSRM turn-by-turn steps. Route responses are cached
in the browser Cache API for six hours; saved routes can be opened offline. The
cache is device-local and is never published by the map site.

All browser tabs in the same browser profile share an origin-wide Web Lock and
requests are spaced by at least one second. Identical in-flight queries are
coalesced. The UI shows distinct no-route, 429, server, timeout, network and
uncached-offline errors. API tokens are not used or published. FOSSGIS requests
include the normal page referrer and no cookies or credentials.

FOSSGIS identifies these as community test / demo routing servers, permits
embedding in other sites, and offers car, bike and foot profiles. Its published
policy says one request per second maximum, no scraping or heavy usage; the server
logs routes, updates its OSM graph roughly every two days, and gives no uptime
promise. [Service information](https://routing.openstreetmap.de/about.html) ·
[OSM Germany service description](https://github.com/fossgis/openstreetmap.de/blob/main/content/nutzen/dienste-osm-de.md).
The live service answered browser CORS requests for all three profiles during
verification; Colombo–Kandy returned a 114.6km driving route with 35 steps. That
check proves the current endpoint works, not a future availability commitment.

OpenRouteService is not configured. Its current public API requires a user API
key. The Standard tier currently documents 2,000 directions requests per rolling
24-hour window and 40 requests per minute; its documentation says each API key
belongs to one person and must not be shipped in a client app. Sources:
[API key and quota guidance](https://giscience.github.io/openrouteservice/frequently-asked-questions),
[Standard plan limits](https://openrouteservice.org/plans/),
[endpoint restrictions](https://openrouteservice.org/restrictions/). Keeping such a
key private requires a server. A busy or commercially critical routing product
needs an authorized, dedicated routing provider or a Mazo operated OSRM backend;
the public demo does not promise production uptime.

Route geometry is calculated from OpenStreetMap data under ODbL 1.0. Directions
credit OpenStreetMap contributors and link to the FOSSGIS "Fix the map" page. The
route provider receives the selected coordinates and records the request in its
server logs.
