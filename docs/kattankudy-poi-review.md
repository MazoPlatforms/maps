# Kattankudy POI review queue

Research date: 2026-10-25. This is a **review queue**, not a published community layer. Public directories are discovery references only; their descriptions, coordinates, ratings and other protected data must not be copied into CC0/ODbL records without appropriate permission. Confirm each place independently and check for existing Overture/OSM/community duplicates before submitting an individual JSON record.

| Candidate | Type | Independent verification task | Discovery reference |
| --- | --- | --- | --- |
| Al-Aqsa Grand Jumma Masjid | place / mosque | Confirm entrance point, official name and any existing Overture feature | https://www.srilanka-places.com/places/al-aqsa-grand-jumma-masjith-kattankudy |
| Kattankudy Heritage Museum | place / museum | Confirm museum entrance, multilingual names and existing baseline record | https://amazinglanka.com/wp/kattankudy-heritage-museum/ |
| Base Hospital Kattankudy | place / hospital | Confirm publicly accessible entrance, authoritative name and current status | Local survey / official health authority |
| Meera Jumma Masjid | place / mosque | Confirm name and exact position from authorized field survey | Local survey |
| Mohideen Meththai Grand Jumma Mosque | place / mosque | Confirm aliases and whether mapped under Meera Meththai Grand Mosque | https://mapcarta.com/15270808 |
| Markaz Arabic College and Mosque | place / education / mosque | Confirm whether institution and mosque need separate POIs | Local survey |
| Kattankudy Food Court | place / food court | Confirm public entrance and current name | https://eshrilanka.com/food/kattankudy-food-court-batticaloa |

## Acceptance checklist

- [ ] Check the current Overture release and community records for duplicate names and nearby coordinates.
- [ ] Obtain a permitted source (own on-site observations under CC0, or compatible openly licensed authoritative data).
- [ ] Confirm coordinates in GeoJSON order `[longitude, latitude]`; do not infer an entrance from a business centroid.
- [ ] Verify Tamil and English names with signage or other authorized evidence.
- [ ] Use the map's contribution editor to generate `records/place/<prefix>/<uuid>.json` with the true source license and observation date.
- [ ] Run `node scripts/records.mjs --output data/community` and `node --test tests/*.test.mjs`.
- [ ] Request administrator review and merge only verified, nonduplicate records; check GitHub Pages deployment.

No Overture baseline modification or Google-derived record is included in this research change.
