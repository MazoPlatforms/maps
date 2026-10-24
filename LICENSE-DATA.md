# Geographic data licensing and contribution terms

Mazo Maps independently maintains canonical geographic records and permanent IDs. Imported data are not wholly original Mazo work and are not covered by the software MIT license. This bounded snapshot is not complete Sri Lanka coverage.

The initial owned sample comes from Overture `2026-10-21.0` regional source Parquet, not rendered tiles. Record `origin` and `sources`, including nested `properties.sources`, retain source identifiers, release/version, license declarations, original provider references and import fingerprints. Original source hashes and query scope are in `docs/benchmarks/sample-inputs.json`.

- Buildings and transportation: Overture's ODbL theme terms apply. Attribution: **© OpenStreetMap contributors, Overture Maps Foundation**. Underlying sample sources include OpenStreetMap, Microsoft ML Buildings, Google Open Buildings and TomTom. Preserve those notices. Google Open Buildings is a permitted open dataset; no Google Maps content was imported. Review the source-specific terms in [Overture's official attribution table](https://docs.overturemaps.org/attribution/) before redistributing a new source/release.
- Places: source records include CDLA-Permissive-2.0 declarations from Overture, Meta, Microsoft and Uberall and Apache-2.0 declarations from Foursquare. Do not label all places as having one exclusive license. The exact original references remain with each record.
- The original Survey Department of Sri Lanka / OCHA classifier remains under CC BY 3.0 IGO, with attribution and snapshot dates in `ATTRIBUTION.md`. It is not silently rewritten by a proposed boundary correction.
- Noto fonts, if bundled, retain the SIL Open Font License in `assets/fonts/OFL.txt`. A font license file alone is not a complete offline glyph bundle. Current font capture failed with HTTP 403; the geometry-only offline style does not require glyphs.

License texts captured for this snapshot are in `data/canonical/licenses/`; they are copied into assembled canonical site artifacts. The captured CDLA page contains the agreement in its published HTML, including site navigation. The ODbL and Apache license texts are plain text. Existing boundary notices remain in `ATTRIBUTION.md`. Full source-specific notice/copyright review (including source-specific building notices) remains a release gate; these files are not a claim of completed legal review or a relicensing of upstream data.

## New contributions

By submitting a changeset and accepting `contributor.licenseAgreement`, you confirm that you may contribute the submitted information, that the source and attribution are accurate, and that you have not copied restricted map content. You dedicate your own new factual survey contributions under CC0-1.0 to the extent permitted, while acknowledging that edits to this derived database retain all applicable source obligations, including ODbL share-alike where applicable. You do not acquire rights to erase imported attribution. Code contributions remain MIT licensed.

The editor requires an explicit survey/source URL for new features. Maintainers must review contributor licensing and source suitability; passing a schema validator does not establish legal permission. Imported provider IDs and licensing references cannot be removed through ordinary property edits.
