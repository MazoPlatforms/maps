# Development progress

## Current checkpoint (24 October 2026)

Branch: `feat/geographic-contributions`. Recovery baseline: `7a2a1d62c619cc2c53fe8252d7056b250e86e0d7`.

Current subtask: integrate the indexed canonical store, bounded real source snapshot, transaction changesets, browser editor and static SDK/API; then verify real browser/offline/routing paths. Work in progress is not a production release.

Verified recovery: 29 Python and 12 JavaScript tests passed again, including native PMTiles integration. New indexed-store suite: 5 tests passed (transactions, conflicts, unsafe metadata, provenance, relationships, deterministic snapshot restoration and checksum corruption). New editor model suite: 3 tests passed across points, lines, polygons, movement, vertices, undo/redo, changesets and drafts. Browser editing acceptance remains pending.

Implemented in this checkpoint: SQLite transactional canonical working store, full-record deterministic compressed snapshots, feature/dataset expected-hash changesets, static API compiler, SDK operations, geometry editor model, and browser panel integrated behind the existing map's Edit button. Canonical mode uses its own full-record tiles and suppresses original edited features. Existing viewer behavior remains the default.

Production physical storage decision: use indexed transactions plus Mazo-owned immutable record shards, not millions of Git files. Keep the Phase 1.5 individual-file pilot and logical administrative export paths. National storage/hosting and export scalability remain unverified; this session imports only bounded original sample records. See the final architecture decision document when available.

Known blockers: GitHub branch-protection read returned HTTP 403 (Resource not accessible by integration); settings and required reviewer enforcement cannot be verified or changed. No OAuth/App backend or privileged browser credentials are configured. Website submissions use a file/fork/PR handoff. Main and production deployment are untouched. Nationwide data import remains deliberately blocked. Complete regional routing, source notice bundles, offline tests, build/publish integration, and security review are still pending.

Next task: build the bounded canonical API/tiles, exercise real editor operations in Chromium under a repository subpath, finish contribution validation CI and document exact acceptance evidence. Do not recreate the existing app or repeat the recovery audit.
