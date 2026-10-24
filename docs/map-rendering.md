# Mazo map rendering

The light and dark MapLibre styles use the existing Sri Lanka PMTiles and retain their source attribution. Geographic records, the website layout, city picker, location, fullscreen, theme and navigation controls are unchanged. No proprietary Google Maps tiles or assets are used. Existing open map glyph services are retained; place icons are original Mazo artwork.

## Cartography

- Water is muted blue; land, parks and buildings use soft neutral or green tones. Building outlines appear only at close zooms.
- Motorways, main roads and local streets have separate interpolated widths and gentle outlines. Rounded joins/caps preserve the actual line geometry. Named roads use line labels with upright, map-aligned placement.
- Transportation connectors remain in the data with their display disabled. They are network topology, not places.
- Named place records use a combined pin and text symbol, so MapLibre can resolve both through collision handling. Categories use the published `basic_category`, with source-category fallbacks. Original canvas artwork covers food, healthcare, shopping, lodging, education, worship, transport, nature and a neutral unknown-category pin. Names and categories are never inferred from proximity.
- Building detail starts at zoom 13 and place symbols at 14. The existing zoom-14 vector detail can be overzoomed to the existing limit of 16; this does not create additional geographic detail.
- Native MapLibre interaction preserves reduced-motion preferences. Device pixel ratio is capped at 2, the tile cache at 64 entries per source, and all place icons share nine small images rather than individual DOM markers.

## Verification

Run the six local regression checks:

```sh
node --test tests/map.test.mjs
```

The real-data browser verifier serves candidate website files under `/maps/` while reading the unchanged, content-addressed archives from the public site. It verifies both themes at desktop (1440 × 1000) and mobile touch (390 × 844, device scale 3 capped to 2), real buildings/roads/place names, hidden connector dots, zoom controls, animated pan/rotation, mobile two-finger dragging and zoom-dependent detail. It saves screenshots and measurements in `RENDER_EVIDENCE_DIR` (default `/tmp/mazo-render-evidence`). Playwright is a verification tool only; the production site has no new package dependency.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_PATH=/path/to/chromium \
node scripts/verify-rendering.mjs
```

Software Chromium measurements describe this test machine, not Android hardware. Physical Android, Safari and Firefox have not been verified in this session. Place coverage, source categories, glyph availability and road-name completeness are limited by the existing published dataset. Road names appear where native collision and line-length rules allow them.

The publisher now includes styles and client assets in its cache version, so a cartography update reaches browsers even when geographic archives are unchanged. Checksums still protect each original archive.
