# Development progress

## Verified recovery checkpoint — 24 October 2026

Branch: `feat/geographic-contributions`. Recovery baseline: `7a2a1d62c619cc2c53fe8252d7056b250e86e0d7`. Main remains untouched. **Phases 2–6 and production deployment are incomplete.** Full statuses, evidence and remediation: [release acceptance](release-acceptance.md).

Current subtask: regional implementation and local acceptance complete. This follow-up adds keyboard coordinate drawing and feature-ID loading, with a real-browser check. The last checkpoint CI passed; current follow-up is awaiting the same remote CI before its push. Next address protection bootstrap, physical-device testing, full offline fonts and affected-partition publication. Resume this application; do not recreate it or repeat the repository audit.

## Commits

- `ac473b59154efc28dd05f53975911f8d4d2341d6` — indexed canonical transactions and owned regional snapshot.
- `dc96eefbdd4bfb23293ac8d78a8b2d06155b9b08` — canonical API, multilingual SDK and explicit-connectivity road routing.
- `885eecb55cf6c524200cf9d0515815abb2d8f293` — integrated editor, draft handoff and offline regional tools.
- `eefab5fdd1c5aae3a4a2ee2bb9a8da3cd16487f3` — review/history checks, security fixes, notices, offline updates, real browser verification and release matrix.
- Resolve this document's checkpoint SHA with `git log -1 -- docs/development-progress.md`; it records final delivery evidence without a self-referential hash.

## Completed implementation

Preserved Phase 1.5 and the original viewer/design. Selected indexed SQLite working records plus immutable complete-record/history compressed shards and reviewable transaction JSON, documenting why millions of files are unsuitable. Requested administrative record paths remain an export contract. Permanent IDs, sources/licenses, optimistic hashes, full revision chains, tombstones and cross-boundary memberships survive restoration.

The independent snapshot contains **13,993 real records** (1,995 places, 9,997 buildings, 2,000 roads, one Colombo DS authority boundary); eight originals are quarantined outside classifier coverage. This is not a complete district or national dataset. No upstream archive is required to render/edit/search/route it. All administrative classifier entries remain pinned.

Editor: eight types, canonical selection, properties/localized names, drawing/movement/vertices, guarded road split/merge, deletion, undo/redo, drafts, multi-feature changesets, comparison and download/fork/PR handoff. Canonical layers suppress edited originals. Static API/SDK/multilingual search and conservative explicit-connector routing operate on actual data. Offline checksums, recovery, corruption rejection, removal, versions and changed-file reuse work. Geometry-only disconnected rendering works; complete labelled offline rendering does not.

Read-only canonical CI builds review artifacts and validates history/proposals. Trusted-base policy requires exact-head non-author approval; boundaries require two eligible maintainers. It neither bypasses protection nor deploys.

## Verification

- **42 Python tests passed**, native Tippecanoe enabled; **22 JavaScript tests passed**, real-data SDK test included. Original suites preserved.
- Actual Chromium/MapLibre under `/maps/` passed real imported building selection/edit/reshape/delete, eight-type drawing, undo/redo/drafts, preview/download, themes, mobile touch layout, interrupted recovery, corrupt-cache rejection/repair, disconnected geometry/search/routing and an update fetching only one changed CSS asset. No page errors. Temporary draft geometry is not committed/published.
- Real-building browser contribution and real-road split validate through Python. Snapshot restoration/history and deterministic PMTiles/core indexes pass. Evidence: [verification](verification/).
- Compile from validated store **12.06 s**, peak parent **649,968 KiB**; SDK initialization **35.68 ms**; real route **531.918 m / ten segments / 48.78 ms**. Browser initial render **3.83 s**, tile median **65.3 ms**, sampled heap **23.90 MB**. Local single runs, not Android/national guarantees.
- Fixed DuckDB 1.4.1 and fflate 0.8.2 advisories. Current DuckDB/extensions 1.4.2, PMTiles 4.5.0/fflate 0.8.3. Requeries found no known issues for checked pins; broader security certification remains open.
- GitHub contribution validation run [40052517332](https://github.com/MazoPlatforms/maps/actions/runs/40052517332) succeeded at `eefab5f`, including native pilot output and legacy browser contributions. New canonical run [40052517401](https://github.com/MazoPlatforms/maps/actions/runs/40052517401) passed snapshot-history/full-data validation and is building its artifact at this documentation checkpoint; consult its final status and the delivery report. Local success is not remote success.

## Remaining work and blockers

1. Protection API **403 Resource not accessible by integration**: enforcement unverified. Verified administrator `itzmzn` is configured, but boundary policy needs a second eligible reviewer. Administrator must review/bootstrap trusted policy/protections. No authenticated PR→review→merge→publish acceptance performed.
2. Glyph capture returned **HTTP 403**. Supply a complete licensed local font bundle and retest labelled offline rendering.
3. Canonical automatic Pages/affected-region publication is unimplemented. Main still builds legacy national archives. No main merge/deployment attempted. Choose durable Mazo-controlled national hosting; preserve Pages size gate and last-good release.
4. Regional compiler capped at 20,000 records. Improve full-record shard/spatial loading, graph memory and national export partitioning before expanding. No uncontrolled national import.
5. Test physical Android, quota/low-memory failures, other engines and keyboard/screen readers. Expand complex road restrictions/topology coverage; add revision-preserving inverse changesets rather than rewriting history.
6. Review every future source separately. Current ODbL/CDLA/Apache/CC BY/IGO notices and Foursquare NOTICE are retained; imported geography is not relabelled wholly original Mazo content.

Next task: inspect remote canonical workflow logs, fix actual failures, then exercise a nonprivileged reviewed PR after trusted policy/protection configuration. Do not deploy the partial regional artifact over the national viewer.

## Editor accessibility follow-up

Added keyboard coordinate entry for points, roads and polygons, keyboard loading by permanent feature ID, live instructions/status, Escape cancellation, initial focus in the editor and focus return on close. Real Chromium verifies keyboard-created features and feature lookup against the actual 13,993-record published sample, with temporary drafts removed before completion. Focused 16 JavaScript model/contribution/router tests passed; full JavaScript suite passed 21 with the real static-data test skipped because no build was configured. Full Python tests were not rerun locally because this resumed environment lacks Shapely; the same Python suite passed remotely at `e5bdcb5`. Overall accessibility remains blocked pending screen-reader and physical Android checks.
