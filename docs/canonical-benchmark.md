# Canonical file-store scalability evidence

The requested administrative JSON layout is implemented as a bounded pilot. **Do not expand the national dataset into this repository.** National conversion remains gated; an indexed Mazo-controlled store is proposed below rather than silently substituted.

## Data and method

The benchmark uses original, full-resolution Overture `2026-10-21.0` data from a Colombo-area bbox `[79.8, 6.8, 80.0, 7.1]`: 10,000 buildings, 2,000 places and 2,000 transportation segments. These are distinct source features, not copies of a fixture or decoded/rendered tiles. It also includes one median-serialized-size official province, district and DS boundary from the committed Survey Department/OCHA snapshot. Boundary input manifests preserve all original file counts; `selectedIds` records the three features actually measured.

This is a bounded spatial sample, not a statistically representative national census. Buildings dominate the observed national row counts; the sample additionally exercises point, line, polygon, nested-property and large-boundary costs. Connectors, land, land use, water and other types still require national distribution measurements. Features outside the pinned DS coverage are listed in `unclassified` and excluded from the file-store trial; source samples retain them. No geography is invented, moved or silently dropped.

[Sample source files and hashes](benchmarks/sample-inputs.json) record the exact selected Parquet partitions. Sample acquisition used verified STAC partition bounds to avoid globally scanning building partitions. On this environment the bounded source queries took 18.40s for places, 17.12s for buildings and 29.34s for transportation; these network/import times are separate from offline storage/build times. An initial global-glob building scan was stopped after roughly eight minutes in favor of partition selection; this is an import-cost observation, not an offline editing dependency.

The scratch benchmark creates new Git repositories for increasing subsets, writes real canonical files, validates/reclassifies them, adds/commits, measures clean and changed status/diff, edits one boundary record, compacts Git, and clones locally without hardlinks. It then builds all APIs, indexes and PMTiles, and compares storage and indexed lookup with a single SQLite table holding the **same complete JSON records**. The SQLite comparison is a storage/access experiment, not a replacement implementation; its timings exclude geographic validation, revision-log maintenance and concurrent writers.

The measured implementation is the initial canonical pilot at `5640297`. The follow-up provenance fix retains original nested source references through edits and adds their dataset/license notices to generated manifests/tiles. It does not change the measured canonical record shape. Output size/build measurements below predate those additional notices; they must not be read as exact byte counts for a current production release. Both source versions have dedicated tests.

## Measured results

| Operation / size | 1,000 | 5,000 | 13,995 |
| --- | ---: | ---: | ---: |
| Validated file write (s) | 5.9878 | 14.4772 | 34.6614 |
| Full validation/classification (s) | 5.7820 | 14.5792 | 35.0820 |
| Git add (s) | 0.2451 | 1.0854 | 2.5669 |
| Git initial commit (s) | 0.0195 | 0.0654 | 0.1268 |
| Git status, clean (s) | 0.0111 | 0.0300 | 0.0892 |
| Full scan + one boundary edit (s) | 9.5753 | 18.5526 | 42.1660 |
| Git status, edited (s) | 0.0075 | 0.0233 | 0.0525 |
| Git diff one (s) | 0.0185 | 0.0298 | 0.0478 |
| Git gc (s) | 0.2338 | 0.1852 | 0.2531 |
| Local clone without hardlinks (s) | 0.0816 | 0.2955 | 0.7756 |
| JSON logical MB | 3.93 | 11.32 | 26.03 |
| Record filesystem allocation MB | 6.24 | 22.65 | 59.51 |
| Git directory after gc MB | 1.37 | 4.00 | 9.24 |

The largest sample contains 13,995 classified records: 3 administrative_boundary, 9,997 building, 1,995 place, 2,000 road. **8 source features were quarantined** outside DS coverage (5 places and 3 buildings); their IDs and reasons are in the [raw measurements](benchmarks/canonical-files.json).

On this 2-CPU environment, the parent Python process peaked at **977.0 MiB RSS**; physical memory was approximately 7.8 GiB. Initial import classification/validation took 41.49s, excluding source acquisition.

The full offline API/index/PMTiles build took **9.19s**, producing 14,007 output files totaling **42.96 MB**. PMTiles alone occupied **2.88 MB**. This is a regional pilot build, not a national tile-build estimate.

The indexed SQLite comparison occupied **35.32 MB**: larger than the 26.03 MB of raw JSON, but below its 59.51 MB of allocated file blocks and without thousands of files. Insert/serialization took 0.5978s, indexed ID lookup 0.0009s, and ordered full export 0.0338s. Gzipping complete canonical records produced 3.28 MB; that stream is a compact export, not a random-write database.


Measurements are single local runs with normal filesystem caching, not medians or cloud service-level guarantees. Local clone times do not include GitHub transfer, authentication, browser tree rendering or a cold checkout. Git was healthy at these sizes; **a 14,000-record trial does not establish Git behavior at ten million files**. GitHub remote push/clone at national scale, many editing generations, merge costs, and nationwide peak memory were not benchmarked.

The selected edit is a real administrative boundary and includes the pilot's full scan plus geometry/schema validation. This is deliberately reported separately from Git status/diff. The pilot's scan-based lookups and per-file Git-history reads must be replaced by indexed/batched access before national editing. Parent-process peak RSS excludes the child tile compiler and does not measure total system peak; the reported workspace resources are observations of this Codespace, not minimum supported specifications.

## National capacity and hosting constraints

The [independently fetched published manifest](benchmarks/published-manifest-2026-10-23.json) reports **10,402,264 bbox-selected source rows**, including **8,908,623 buildings**, and **933,811,934 bytes of PMTiles**. These are source-row counts, not verified canonical national counts or rendered-feature totals. Clipping, boundary exclusions, conflation and tombstones may change the final canonical count.

On a filesystem allocating a 4 KiB block per nonempty small JSON file, 10,402,264 files require at least **42,607,673,344 bytes (42.61 GB)** for record blocks alone. This excludes directories, inodes, Git's object store/index/history, raw imports, build staging, APIs and archives. Even buildings alone would occupy about **36.49 GB** of minimum blocks. The Codespaces workspace filesystem is approximately 32 GiB total, with about 17–18 GiB free during this work; the separate `/tmp` filesystem is larger. The benchmark was deliberately placed in `/tmp`. Larger Codespaces disks could remove that immediate blocker but do not remove Git file-count/history costs.

The small-file estimate is conditional on allocation behavior, not a claim that all storage backends charge 4 KiB per object. Actual sample logical bytes, allocated bytes and packed Git bytes are reported independently above. Linear national timing or packed-size extrapolations would be unreliable because geometry complexity, cache behavior and revision depth differ; no million-file benchmark was run.

GitHub's [current Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) specify a 1 GB published site, recommend a 1 GB source repository, list a 100 GB/month soft bandwidth limit, and time out Pages deployments after ten minutes. The build-rate soft limit does not apply to a custom Actions publication workflow. The deployment timeout is not a ten-minute limit on the separate tile-build job. Those documented limits were checked on 23 October 2026.

Existing national archives leave only about **56.2 MB before the repository's 990,000,000-byte safety gate**, before other site files. Adding full nationwide canonical APIs to that Pages payload is not a viable plan. A new canonical tile profile may have different sizes; it has not been built nationally. Canonical source records must be stored durably separately from the public site, and generated APIs/tiles need independent hosting or measured partitioning once they exceed Pages capacity. The existing size gate remains intact.

## Proposed national alternative and explicit trade-offs

Use a Mazo-controlled indexed canonical database, starting with SQLite/GeoPackage for an offline single-writer snapshot or PostgreSQL/PostGIS for collaborative writes. Every imported feature is a complete Mazo record with its own permanent ID, geometry, properties, original-source identities/licenses, status and revision. These records are **not overrides over a required upstream basemap**. All rendering, indexes and APIs are derived from this database without consulting Overture.

Store features by permanent UUID; store the canonical province/district/DS tuple plus all memberships in indexed tables. Keep one geometry for crossing features. Use an append-only revision/event table with prior hashes, immutable import provenance and retained tombstones. Preserve complete record snapshots or replayable events for durable history; regularly verify backups and restoration. Keep immutable export snapshots and checksums in Mazo-controlled object storage, not expiring Actions artifacts.

Expose the requested administrative path as an export/addressing contract and support checked-out individual JSON records for review. Git should contain code, schemas, source manifests and reviewed change packages; a national initial import and all features live in durable Mazo storage. An edit package resolves its UUID and expected revision against that canonical store. This preserves independent feature-level editing and history while avoiding millions of physical Git files. The path is logical in this alternative, so it is a real physical-layout trade-off requiring an explicit decision before conversion.

For static exports, use bounded ID-sharded JSON/GeoParquet packs plus an ID-to-shard/offset index, DS lookup indexes and PMTiles on Mazo-controlled storage/CDN. A record can be fetched/edited by UUID and exported at its administrative path without duplicating cross-boundary records. API shards and database snapshots are generated or canonical Mazo artifacts as specified by the selected backend, never unowned provider archives that must stay available. Publication must carry applicable source notices and license texts; independent maintenance does not erase ODbL or other source requirements.

The costs are a storage/index migration, an explicit revision/import API, backup/recovery operations, a durable hosting budget, and additional work to integrate Git review. SQLite remains single-writer; PostGIS adds a server. Compressed shards favor bulk reads and need a transactional edit/index strategy. Neither alternative is already implemented by the small SQLite benchmark. The next implementation decision should select and validate one of these stores and hosting arrangements; **the requested JSON pilot remains unchanged until that decision**.

## Reproduce

Use the existing pinned Python 3.12 geographic requirements. Build Tippecanoe from verified tag `2.79.0` / commit `68ab8dcc229f95b8b25877697d5e8d66783af503`. Use new scratch paths; the scripts refuse existing destinations and the file store caps conversion at 20,000 records.

```sh
python scripts/sample-geodata.py --release 2026-10-21.0 --output /tmp/mazo-samples
TIPPECANOE_MAX_THREADS=2 python scripts/benchmark-canonical.py \
  --samples /tmp/mazo-samples/places.json /tmp/mazo-samples/buildings.json /tmp/mazo-samples/transportation.json \
  --work /tmp/mazo-benchmark \
  --output /tmp/mazo-benchmark.json \
  --tippecanoe /path/to/tippecanoe
```

The sampler verifies STAC partition candidates against their item bounds and fails if the current positional collection layout changes. `LIMIT` with parallel source reads may select a different subset on another run; recorded input hashes identify this run exactly. To reproduce exact byte outputs, retain the original sample files as well as the pinned releases. The raw samples and generated scratch repositories are not committed as a new production dataset. Benchmark results and source references are committed for review.
