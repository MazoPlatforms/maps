# Development progress

## Verified recovery checkpoint — 24 October 2026

Branch: `feat/geographic-contributions`. Recovery baseline: `7a2a1d62c619cc2c53fe8252d7056b250e86e0d7`. Main remains untouched. **Phases 2–6 and production deployment are incomplete.** Full statuses, evidence and remediation: [release acceptance](release-acceptance.md).

Current subtask: local glyph coverage now builds reproducibly from the validated proposed snapshot, and canonical CI confirms a same-origin glyph request returns 200 with browser networking disabled. Full multilingual label acceptance remains blocked by MapLibre's documented Tamil shaping limitation. Continue with protection bootstrap, a shaping-capable renderer evaluation, physical-device testing, and affected-partition publishing. Resume this application; do not recreate it or repeat the repository audit.

## Offline font checkpoint — local verification complete, browser CI pending

Generated a locally hosted MapLibre glyph bundle for all active canonical pilot labels, including Tamil and Sinhala codepoint ranges. Inputs are three Noto font families pinned to Google Fonts commit `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`; original TTFs and separate OFL 1.1 notices are retained. A local Node script calls the pinned BSD-3-Clause MapLibre font-maker WASM runtime, derives ranges from active canonical labels, NFKC-normalizes only rendered `@name` text, and emits deterministic checksummed PBFs. Candidate PR builds regenerate ranges from the validated proposed snapshot. The compiler refuses missing or checksum-mismatched glyph files. Offline styles keep text layers, remove sprite-only icons, and request same-site glyphs. Added a disconnected-browser glyph request assertion and recurring CI regeneration check; wait for this branch run before marking acceptance PASS. MapLibre documents Tamil among complex-text scripts it cannot render, so this bundle does not provide correct Tamil labels. A renderer change and disconnected visual test are still required.

Verification: all **42 Python tests passed** (two skipped); **22 JavaScript tests passed** (the standalone static API test skipped; the separate real-data SDK test passed); 12 native tile/canonical tests passed. Font regeneration produced identical SHA-256 for all five manifest/glyph files. Assembly verified licenses and hashes and excluded source TTFs from the offline inventory. `npm audit` found zero vulnerabilities. [Canonical workflow 40071309945](https://github.com/MazoPlatforms/maps/actions/runs/40071309945) passed the compiled regional build, SDK, and real Chromium/MapLibre run. With network disabled, the browser loaded a local glyph (HTTP 200), saw the 4 bundled ranges and 2 text symbol layers, used offline search/routing, recovered an interrupted/corrupt cache, drew all eight feature types, and passed the existing six Axe contexts. The browser confirms local asset delivery; it does not certify correct Tamil shaping. [Contribution CI 40071309948](https://github.com/MazoPlatforms/maps/actions/runs/40071309948) also passed. No nationwide data conversion, deployment, or production release was performed.

## Commits

- `ac473b59154efc28dd05f53975911f8d4d2341d6` — indexed canonical transactions and owned regional snapshot.
- `dc96eefbdd4bfb23293ac8d78a8b2d06155b9b08` — canonical API, multilingual SDK and explicit-connectivity road routing.
- `885eecb55cf6c524200cf9d0515815abb2d8f293` — integrated editor, draft handoff and offline regional tools.
- `eefab5fdd1c5aae3a4a2ee2bb9a8da3cd16487f3` — review/history checks, security fixes, notices, offline updates, real browser verification and release matrix.
- `9ebabcdffb851b49de6ee4a8e7348ff0ee8ccba6` — keyboard feature lookup/drawing and Escape cancellation; browser and CI pass.
- `36972fedd67ac6cb39ea26bda274186240a6ca05` — map contrast/name/control fixes and recurring axe WCAG scans; all remote checks passed.
- `1fd965c4b46d19be678e04ad6fd47e4d6deec908` — reproducible local glyph bundle, license/hash validation and disconnected-browser coverage check; both pushed workflows passed.
- Resolve this document's checkpoint SHA with `git log -1 -- docs/development-progress.md`; it records final delivery evidence without a self-referential hash.

## Completed implementation

Preserved Phase 1.5 and the original viewer/design. Selected indexed SQLite working records plus immutable complete-record/history compressed shards and reviewable transaction JSON, documenting why millions of files are unsuitable. Requested administrative record paths remain an export contract. Permanent IDs, sources/licenses, optimistic hashes, full revision chains, tombstones and cross-boundary memberships survive restoration.

The independent snapshot contains **13,993 real records** (1,995 places, 9,997 buildings, 2,000 roads, one Colombo DS authority boundary); eight originals are quarantined outside classifier coverage. This is not a complete district or national dataset. No upstream archive is required to render/edit/search/route it. All administrative classifier entries remain pinned.

Editor: eight types, canonical selection, properties/localized names, drawing/movement/vertices, guarded road split/merge, deletion, undo/redo, drafts, multi-feature changesets, comparison and download/fork/PR handoff. Canonical layers suppress edited originals. Static API/SDK/multilingual search and conservative explicit-connector routing operate on actual data. Offline checksums, recovery, corruption rejection, removal, versions and changed-file reuse work. Geometry-only rendering and network-disconnected local glyph delivery are verified. Tamil shaping and full multilingual offline labels are not accepted.

Read-only canonical CI builds review artifacts and validates history/proposals. Trusted-base policy requires exact-head non-author approval; boundaries require two eligible maintainers. It neither bypasses protection nor deploys.

## Verification

- **42 Python tests passed**, native Tippecanoe enabled; **22 JavaScript tests passed**, real-data SDK test included. Original suites preserved.
- Actual Chromium/MapLibre under `/maps/` passed real imported building selection/edit/reshape/delete, eight-type drawing, undo/redo/drafts, preview/download, themes, mobile touch layout, interrupted recovery, corrupt-cache rejection/repair, disconnected geometry/search/routing and an update fetching only one changed CSS asset. No page errors. Temporary draft geometry is not committed/published.
- Real-building browser contribution and real-road split validate through Python. Snapshot restoration/history and deterministic PMTiles/core indexes pass. Evidence: [verification](verification/).
- Compile from validated store **12.06 s**, peak parent **649,968 KiB**; SDK initialization **35.68 ms**; real route **531.918 m / ten segments / 48.78 ms**. Browser initial render **3.83 s**, tile median **65.3 ms**, sampled heap **23.90 MB**. Local single runs, not Android/national guarantees.
- Fixed DuckDB 1.4.1 and fflate 0.8.2 advisories. Current DuckDB/extensions 1.4.2, PMTiles 4.5.0/fflate 0.8.3. Requeries found no known issues for checked pins; broader security certification remains open.
- GitHub workflows at `9ebabcd` passed [contribution validation](https://github.com/MazoPlatforms/maps/actions/runs/40068942555) and [canonical validation/build/browser](https://github.com/MazoPlatforms/maps/actions/runs/40068942606), including 42 Python tests, 21 JavaScript tests plus a separate real-data SDK test, native geometry tests and keyboard browser interactions. At `36972fe`, [contribution validation](https://github.com/MazoPlatforms/maps/actions/runs/40069428855) and [canonical validation/build/browser with Axe](https://github.com/MazoPlatforms/maps/actions/runs/40069428837) also passed. The maintainer-review job was skipped on branch pushes; no PR approval is evidenced. Axe reported zero violations in six browser/theme contexts; the full browser run had no page errors.

## Remaining work and blockers

1. Protection API **403 Resource not accessible by integration**: enforcement unverified. Verified administrator `itzmzn` is configured, but boundary policy needs a second eligible reviewer. Administrator must review/bootstrap trusted policy/protections. No authenticated PR→review→merge→publish acceptance performed.
2. Locally generated licensed glyphs cover the active pilot and proposed PR snapshot, and canonical CI verifies offline delivery. Evaluate a MapLibre-compatible shaping solution for Tamil, then add a visual glyph correctness check and test Android/storage/quota failures.
3. Canonical automatic Pages/affected-region publication is unimplemented. Main still builds legacy national archives. No main merge/deployment attempted. Choose durable Mazo-controlled national hosting; preserve Pages size gate and last-good release.
4. Regional compiler capped at 20,000 records. Improve full-record shard/spatial loading, graph memory and national export partitioning before expanding. No uncontrolled national import.
5. Test physical Android, quota/low-memory failures, other engines and keyboard/screen readers. Expand complex road restrictions/topology coverage; add revision-preserving inverse changesets rather than rewriting history.
6. Review every future source separately. Current ODbL/CDLA/Apache/CC BY/IGO notices and Foursquare NOTICE are retained; imported geography is not relabelled wholly original Mazo content.

Next task: after verified repository protection/bootstrap and a second eligible boundary reviewer are available, exercise a nonprivileged reviewed PR; then implement affected-region release integration after national hosting and coverage gates. Do not deploy the partial regional artifact over the national viewer.

## Editor accessibility follow-up

Added keyboard coordinate entry for points, roads and polygons, keyboard loading by permanent feature ID, live instructions/status, Escape cancellation, initial focus in the editor and focus return on close. Real Chromium verifies keyboard-created features and feature lookup against the actual 13,993-record published sample, with temporary drafts removed before completion. Focused 16 JavaScript model/contribution/router tests passed; full JavaScript suite passed 21 with the real static-data test skipped because no build was configured. Full Python tests were not rerun locally because this resumed environment lacks Shapely; the same Python suite passed remotely at `e5bdcb5` and the next canonical workflow reruns it.

Accessibility audit found and fixed light-theme muted text contrast (4.47:1), reset-button accessible-name mismatch, attribution-toggle overlap with map controls, and low-contrast dark map signature text. The editor live instructions and coordinate fields are keyboard accessible. Added recurring Axe WCAG 2.0/2.1/2.2 A/AA scans to the real Playwright workflow for desktop/mobile, viewer/editor and light/dark contexts. Local and GitHub CI scans returned zero violations in all six contexts. Physical Android and screen-reader acceptance remains open.
