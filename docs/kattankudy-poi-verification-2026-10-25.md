# Kattankudy place verification queue — 2026-10-25

This is a **research queue, not approved map data**. Do not copy coordinates, phone numbers, ratings, hours or descriptions from Google Maps into community records. Verify each proposed record independently with appropriately licensed sources or field observations.

| Candidate | Type | Independent reference | Status |
| --- | --- | --- | --- |
| Kattankudy Heritage Museum | museum | https://amazinglanka.com/wp/kattankudy-heritage-museum/ | Exists in public references; basemap match pending |
| Al-Aqsa Grand Jumma Masjid | mosque | https://www.lakpura.com/pages/kattankudy | Exists in public references; basemap match pending |
| Meera Jumma Masjid | mosque | https://mapcarta.com/15270808 | Name/location matching pending |
| Mohideen Meththai Grand Jumma Mosque | mosque | https://mapcarta.com/15270808 | Name/location matching pending |
| Base Hospital Kattankudy | hospital | https://mapcarta.com/15270808 | Exact feature verification pending |
| Markaz Arabic College and Mosque | education/place of worship | local survey needed | Verification pending |
| Seyed Zain Moulana Jummah Masjid | mosque | local survey needed | Verification pending |
| Masjidul Hussainiyah | mosque | local survey needed | Verification pending |

## Existing repository checks

- Inspected `records/place`: currently one tracked JSON record under `records/place/10/`, for Mazo Platforms, Inc.; none of the eight candidate names is a matching community JSON file in that directory.
- **This does not prove absence from the nationwide Overture basemap.** Community records are a supplemental layer, and an Overture duplicate must not be created as a correction.
- The upstream Overture feature IDs and authoritative matching workflow are not currently available in the repository's community record editor.

## Next verification steps

1. Inspect the rendered nationwide basemap at Kattankudy, search each name and aliases, and verify Overture feature IDs where available.
2. Confirm independent coordinates from field GPS, OSM with ODbL compliance, or other appropriately licensed sources; record the observation date.
3. Compare location and name against the basemap and community records. Only create a new record if genuinely absent.
4. For existing Overture places needing correction, file an upstream correction rather than a duplicate overlay until source-ID-based editing/suppression is implemented.
5. Submit individually sourced `records/place/<prefix>/<uuid>.json` changes through the existing PR validation and admin approval workflow.

No production map record was created from unlicensed or unverified coordinates.
