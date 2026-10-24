# Build, preview and release

The canonical dataset and the current public national viewer are separate release modes in the same repository and website. Main has not been merged or redeployed during this work. The new canonical workflow validates proposals, executes the real browser/offline integration suite, checks configured PR approvals, and builds a reviewable **regional** artifact; it deliberately has no deployment permissions/job. Do not upload that incomplete artifact over the production national site.

With Python 3.12, install `requirements-geodata.txt`. Build pinned Tippecanoe 2.79.0 at `68ab8dcc229f95b8b25877697d5e8d66783af503`, then:

```sh
python scripts/validate-changesets.py --output /tmp/review
TIPPECANOE_MAX_THREADS=2 python scripts/build-dataset.py \
  --snapshot /tmp/review/snapshot --output /tmp/build --tippecanoe /path/to/tippecanoe
python scripts/assemble-canonical.py --build /tmp/build --output /tmp/site
node scripts/serve-site.mjs /tmp/site 8000
```

Open `/maps/?dataset=canonical` on the printed local origin. The local preview server supplies real PMTiles range responses and the repository subpath. The artifact's default legacy viewer requires the existing national archives and finalized legacy styles; these are intentionally not re-downloaded into each regional preview. Use the explicit canonical query in this artifact. This avoids silently replacing the national map with a partial source sample.

Canonical source is in `data/canonical`, compiled files in the new build destination, public read resources in `/api/v1/`, and compiled independent styles/PMTiles in `/data/mazo/`. Artifact assembly copies public code/assets/notices, not the raw canonical snapshot or classifier files. Content-addressed API filenames, source shards and tiles reuse unchanged hashes. A build is staged into a new directory and only renamed after success; failed validation/build does not replace a known-good source manifest or deployed site. The current build regenerates this one bounded region; national affected-district scheduling and incremental graph/tile updates remain open.

Before production publication: verify and enable required checks/CODEOWNER reviews, configure a second authorized boundary reviewer, finish the full font bundle and licence/source notice review, perform independent Android/accessibility testing, and select durable national canonical/API hosting. Review the complete acceptance matrix. A source-code push, successful CI artifact, or local browser test does not count as a public deployment.

After those gates, integrate the canonical assembly into the existing Pages workflow, preserve the last known-good artifact/snapshot and enforce the 990,000,000-byte site gate. An approved merge to main must precede production deployment; no force push or unreviewed merge is permitted. Verify the actual public URL, asset checksums, ranges, versions, both themes, API, search and offline package after deployment. The current main Pages workflow still builds/reuses its legacy Overture-derived archives; this recovery has not relabeled it as a complete canonical production pipeline.
