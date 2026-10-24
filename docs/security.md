# Security review and release gates

This is a bounded regional engineering checkpoint, not a declaration of vulnerability-free software or production approval.

## Trust boundaries

Browser code contains no OAuth client secret, private key, privileged GitHub token or automatic PR-creation claim. GitHub authentication happens on GitHub through a manual fork/upload/PR handoff. Inputs use `textContent`/form values; the editor's fixed HTML template interpolates only a constant feature-type list. Arbitrary geographic metadata is never inserted as raw HTML. Changesets reject reserved prototype keys, script/iframe/image markup, JavaScript URL markup, invalid JSON/schema/geometry, stale hashes, identity changes, missing source references and invalid tombstone mutations. New sources must use reviewed license identifiers and permitted provenance URL schemes; that syntax/policy check is not proof of legal permission. Individual UI controls do not confer authorization.

Canonical snapshot paths are validated, symlinks rejected, compressed size/hash verified, and decompression bounded. Feature/type/history identities and full prior revision hashes are checked. A comparison against a trusted Git base rejects rewriting or deleting committed snapshot history. SQLite uses parameterized statements and transactions. Source geometry is validated using GEOS; supported graph references and surviving-component connectivity regressions are checked. Complex unsupported routing semantics remain excluded/review-gated rather than certified safe.

The new Actions workflow runs PR builds with read-only repository permissions, no privileged secrets, no `pull_request_target`, and no deployment job. Review policy uses a configured maintainer allowlist and exact-head reviews, evaluated with the script/policy from the trusted base commit. `itzmzn` was verified as an administrator through the collaborator API and is the initial CODEOWNER. Boundary policy requires two eligible maintainers; only one currently exists in the configured policy. A second verified reviewer must be configured before a boundary correction can pass that gate.

The branch-protection endpoint returned HTTP 403 even though the repository permission summary reports admin capability. Therefore required checks/reviews, CODEOWNER enforcement and dismissal of stale approvals are **not verified as enabled**. The initial policy bootstrap must be reviewed/configured by an administrator. Repository files and CI checks alone cannot stop an authorized merge that bypasses unconfigured protections. No main merge or production deployment was attempted.

New workflow Actions and Tippecanoe are immutable-commit pinned (tag identities verified against primary Git repositories). Existing legacy workflows still contain version-tag-pinned Actions and third-party extension wheels; retain supply-chain review as a release requirement. Python packages are version pinned, not fully hash-locked. New vendor rebuild tooling pins PMTiles/fflate/esbuild versions but npm transitive installation is not a complete artifact-provenance system.

## Dependency audit on 24 October 2026

`pip-audit --no-deps --disable-pip -r requirements-geodata.txt` found **PYSEC-2025-112 / CVE-2025-64429** affecting DuckDB 1.4.1 encryption internals. DuckDB and matching signed httpfs/spatial extension transports were upgraded together to 1.4.2; native GeoParquet/spatial and existing suites are rerun after the upgrade. The application did not use encrypted DuckDB databases, but the known vulnerable version was removed. See [DuckDB's advisory](https://github.com/advisories/GHSA-vmp8-hg63-v2hp).

OSV's npm batch query found **GHSA-px8p-9vwx-vf98 / CVE-2026-45820** in fflate 0.8.2's malformed ZIP64 `unzipSync` parser. The old PMTiles bundle exposed only gzip/inflate functionality (no ZIP API), but it was rebuilt from the same PMTiles 4.5.0 with patched fflate 0.8.3 to remove the dependency-level alert. The bundled license notice was updated, and real PMTiles/browser/range tests are rerun. [Primary advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98). A version query returning no known findings is not a proof of absence of vulnerabilities.

A targeted source scan for common GitHub/AWS secret/private-key patterns returned no matches; this is not a comprehensive secret-history scan. No environment variables or credential contents were dumped. Credentials stay outside public assets and API outputs. Public geographic source properties are intentionally available through the API; review new contributions for confidential/personal information before approval.

## Remaining work

Verify/enforce branch protections and reviewer configuration; independently review source-specific redistribution notices; complete Android low-memory and accessibility testing; harden huge-geometry/changeset resource limits and namespace/reference policies; review complex road topology and restriction edits; perform a full independent security review before public release. Offline glyph assets are now generated locally and checksummed; disconnected-browser verification is pending, and the current MapLibre renderer does not shape Tamil complex text.
