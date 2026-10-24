# Static API, SDK and search

Build using Python 3.12, pinned requirements and Tippecanoe 2.79.0:

```
python scripts/build-dataset.py --output /tmp/build --tippecanoe /path/to/tippecanoe
python scripts/assemble-canonical.py --build /tmp/build --output /tmp/site
```

Serve it with `node scripts/serve-site.mjs /tmp/site 8000`, which supports PMTiles ranges and `/maps/` paths. The checked-in source tree is not a prebuilt API; generated outputs are deliberately separate. To preserve the current public national viewer, this artifact's independent map is selected with `?dataset=canonical`. A complete national cutover has not occurred.

`api/v1/manifest.json` describes dataset version, honest sample coverage, feature schema, exact byte lengths/SHA-256 hashes, ID-prefix feature shards, feature-type lists, administrative region metadata/memberships/spatial grid, multilingual search shards, routing graph and license metadata. `versions.json` reports the current version; it is not a fabricated list of historical releases. `checksums.json` covers immutable API resources. Features, tombstones and expected record hashes share ID-prefix shards; resource filenames include content hashes. Region indexes expose all pinned authoritative administrative names/codes; canonical geometry coverage is limited to the actual imported sample and Colombo DS boundary. All supported types have indexes, including empty lists when data are unavailable.

```js
import {MazoMaps} from './sdk/index.js';
const maps = new MazoMaps({baseURL: new URL('./api/v1/', location.href)});
await maps.initialize();
await maps.search('කොළඹ');
await maps.autocomplete('கொழு');
await maps.geocode('Colombo');
await maps.reverseGeocode([79.85, 6.92]);
await maps.nearby([79.85, 6.92], {radius:1000, type:'place'});
await maps.getFeature('PERMANENT-MAZO-UUID');
await maps.getRegion('colombo-sample');
await maps.getDatasetVersion();
// Editor/internal helper: authoritative expected record hash, no JS float reserialization.
const {record, sha256} = await maps.getFeatureSnapshot('PERMANENT-MAZO-UUID');
```

Use real IDs from search/type indexes. Type declarations are in `sdk/index.d.ts`. `getFeature` returns full canonical data including removed status. `getRegion` distinguishes available sample regions and DS membership indexes; unknown/unavailable regions throw `NOT_FOUND`. Network failures, schema incompatibility, path violations, invalid queries and corrupt resource hashes raise typed `MazoError` errors. No credential or API key is required.

Names come from actual canonical properties. English, Tamil, Sinhala and alternate names use Unicode NFKC normalization. Prefix/token buckets are loaded lazily; relevance favors exact and full-prefix matches, then substring matches within the selected bucket; distance breaks ties when `near` is supplied. Options include `type`, `category`, `bbox`, `region`, `near`, `radius`, and bounded `limit`. Search is not an all-token nationwide full-text engine. The web UI performs searches in a Web Worker. Parsed resource caching is bounded to 16 MiB by default; IndexedDB is not required because the offline system caches verified immutable HTTP resources.

Nearby search uses grid-indexed representative points; it does not measure exact distance to large polygon boundaries. Reverse geocoding explicitly returns `kind: approximate-nearby-place`, `address: null`, known place records and a notice. It never invents an address. Geocoding returns known named features and does not interpolate street addresses.

The regional API and SDK are verified under a repository `/maps/` subpath. Current real-data tests use actual English, Tamil and Sinhala names from the imported Colombo DS authority record. This does not imply broad Tamil POI coverage. Local initialization/warm query timings are recorded in acceptance evidence; cold-network, nationwide and Android search performance remain unverified.

## Foursquare OS Places NOTICE

The following notice applies to the Foursquare-derived subset of the sample and is reproduced from the linked publisher notice. The complete captured notice and Apache license accompany the data.

© 2026 Foursquare Labs, Inc. All rights reserved.




The Foursquare OS Places dataset (the “Data”) is licensed under the Apache License, Version 2.0 (the “License”). You may not use, modify, or distribute the Data except in compliance with the License.




As set forth more fully in the License, if you use, modify, or distribute the Data, you must:
– provide recipients with a copy of the License.
– if applicable, include prominent notices to the extent you’ve changed the Data.
– preserve attribution to Foursquare, including preserving the full content of this NOTICE.txt file.




To ensure appropriate attribution to Foursquare, we recommend the following:
– if using/distributing the Data in flat file form as-is or after making changes/modifications: include this NOTICE.txt file, which may be modified to include an additional notice of your changes/modifications, if any.
– if using/distributing the Data in API form as-is or after making changes/modifications: include a copy of the content from this NOTICE.txt file prominently in your developer documentation for such API, which may be modified to include an additional notice of your changes/modifications, if any.




You may obtain a copy of the License at: http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, the Data distributed under the License is distributed on an “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.




See the License for the specific language governing permissions and limitations under the License.




We also encourage you to join our Placemaker community where you can contribute and provide suggestions to improve the accuracy of the Data for future releases for yourself and others.

Mazo transformation: licensed Overture data were reorganized into permanent Mazo records and derived APIs/tiles. Original source attributes and identifiers remain; further changes are recorded in revision history.
