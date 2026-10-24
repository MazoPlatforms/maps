# Full-screen map

The landing page is replaced by a viewport-sized MapLibre map, with the Mazo
identity, floating search, category filters and tool panels. No bottom navigation
or external UI framework is used. One-finger panning is enabled; pinch, rotate,
keyboard navigation, compass, location, island reset and fullscreen remain.
Safe-area spacing and 44px controls support mobile layouts. Theme preference and
reduced motion remain respected. Category filters operate on actual named POIs;
these detailed POIs appear at zoom 14. The source archives already prioritize roads by zoom. Below zoom 8 (before
rail features enter the source), untagged line geometry is rendered as major
roads: the official tile builder can omit tags for short low-zoom features.
This preserves actual highway geometry without inventing features or changing
the geographic archives. Native labels below zoom 13 require an actual source name.

Overview labels use 79 real GeoNames point records, including cities, towns and
national parks/nature reserves. Population and zoom prioritize labels using native
MapLibre collision placement. The downloaded Sri Lanka export was 1,515,587 bytes;
the published subset is about 35 KB. GeoNames CC BY 4.0 attribution is visible on
the map and documented in ATTRIBUTION.md. Park labels are approximate destination
points, not park boundaries or entrances. No geographic archives are removed or
replaced. No Google assets or services are used.

Search covers the overview index, alternate names and currently rendered POIs.
It is not nationwide address search. Directions submits selected location coordinates to FOSSGIS OSRM and displays
actual road geometry, distance, travel time and turn instructions on the map.
Results can be reused from device cache offline. Existing city shortcuts remain
in Layers. Provider limits and privacy are documented in
[performance and routing](performance-routing.md).

Run `node --test tests/map.test.mjs`. Candidate browser checks are in
`scripts/verify-rendering.mjs`, using real published PMTiles range bytes. They
exercise desktop/mobile, both themes, low-zoom labels, full viewport sizing,
search, directions links, category selection, layer toggles, native pan/rotate,
zoom controls and touch gestures. The Pages workflow runs them before build and
publication. Real-device Android/iOS verification is separate from emulation.

The first hosted candidate run passed all seven regression tests and four real
Chromium viewport/theme cases (Actions run 40096322164). Measured first geographic
frame: 2,261 ms desktop and 758 ms mobile emulation; these are software-rendered
runner measurements, not device guarantees. Browser verification exposed existing
external glyph-service 404s for some decorative supplementary Unicode characters
in imported POI names; ordinary labels and all required map layers rendered.
