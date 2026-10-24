# Full-screen map

The landing page is replaced by a viewport-sized MapLibre map, with the Mazo
identity, floating search, category filters and tool panels. No bottom navigation
or external UI framework is used. One-finger panning is enabled; pinch, rotate,
keyboard navigation, compass, location, island reset and fullscreen remain.
Safe-area spacing and 44px controls support mobile layouts. Theme preference and
reduced motion remain respected. Category filters operate on actual named POIs;
these detailed POIs appear at zoom 14. Roads below zoom 10 are restricted to major
classes to keep the national view legible.

Overview labels use 79 real GeoNames point records, including cities, towns and
national parks/nature reserves. Population and zoom prioritize labels using native
MapLibre collision placement. The downloaded Sri Lanka export was 1,515,587 bytes;
the published subset is about 35 KB. GeoNames CC BY 4.0 attribution is visible on
the map and documented in ATTRIBUTION.md. Park labels are approximate destination
points, not park boundaries or entrances. No geographic archives are removed or
replaced. No Google assets or services are used.

Search covers the overview index, alternate names and currently rendered POIs.
It is not nationwide address search. Directions validates two indexed/selected
locations and provides an explicit OpenStreetMap routing handoff with their actual
coordinates. It does not pretend to calculate routes locally. An external routing
website requires internet access. Existing city shortcuts remain in Layers.

Run `node --test tests/map.test.mjs`. Candidate browser checks are in
`scripts/verify-rendering.mjs`, using real published PMTiles range bytes. They
exercise desktop/mobile, both themes, low-zoom labels, full viewport sizing,
search, directions links, category selection, layer toggles, native pan/rotate,
zoom controls and touch gestures. The Pages workflow runs them before build and
publication. Real-device Android/iOS verification is separate from emulation.
