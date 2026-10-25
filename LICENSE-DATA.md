# Geographic data licenses

The MIT software license does not relicense geographic data.

- National basemap: source-specific Overture/OSM licenses and notices in
  [ATTRIBUTION.md](ATTRIBUTION.md) remain applicable.
- Overview destination index: GeoNames CC BY 4.0, as documented in ATTRIBUTION.md.
- Community records: read each record's `sources` array. The accepted identifiers
  are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), and
  [CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/).
  This allowlist is not a determination that every combination of sources is
  compatible. Admins must review the actual terms, source permission, attribution
  and derived-data obligations before accepting a proposal. A contributor cannot
  assign a new license to data they do not have permission to redistribute.
- Historical canonical sample: original source IDs/licenses remain in its records
  and `data/canonical/licenses/`. The sample is not published by the current Pages
  workflow and is not converted by the community publisher.
- Historical boundary classifier: provenance/license remain in
  `data/boundaries/sri-lanka/manifest.json`; community boundary proposals do not
  rewrite it automatically.

The complete published community record bundle includes tombstones and all retained
source attributions. Do not strip these when redistributing/exporting the data.
