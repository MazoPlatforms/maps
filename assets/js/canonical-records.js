// Canonical editor boundary. Persistence remains the reviewed offline CLI/Git path.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export async function fetchCanonicalRecord(datasetRoot, id, fetcher = fetch) {
  if (!uuid.test(id)) throw new Error('Invalid permanent Mazo ID');
  const indexResponse = await fetcher(new URL('index.json', datasetRoot));
  if (!indexResponse.ok) throw new Error('Canonical index unavailable');
  const entry = (await indexResponse.json())[id];
  if (!entry || entry.file !== `api/features/${id.slice(0, 2)}/${id}.json`)
    throw new Error('Canonical feature unavailable');
  const response = await fetcher(new URL(entry.file, datasetRoot));
  if (!response.ok) throw new Error('Canonical record unavailable');
  const bytes = await response.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== entry.sha256) throw new Error('Canonical checksum mismatch');
  const record = JSON.parse(new TextDecoder().decode(bytes));
  if (record.schemaVersion !== 2 || record.id !== id || record.revision !== entry.revision ||
      record.status !== entry.status) throw new Error('Canonical identity mismatch');
  return { record, sha256 };
}

export function prepareCanonicalEdit(snapshot, patch) {
  if (snapshot.record.status === 'removed') throw new Error('Tombstones are immutable');
  if (!patch || Array.isArray(patch) || typeof patch !== 'object' ||
      Object.keys(patch).some((key) => !['geometry', 'properties'].includes(key)))
    throw new Error('Only geometry and properties can be edited');
  // Export patch JSON and pass expected to canonical.py update; server validates geometry,
  // membership, provenance, and revision. This helper does not claim a successful save.
  return { id: snapshot.record.id, expected: snapshot.sha256, patch: structuredClone(patch) };
}

export function prepareCanonicalDeletion(snapshot) {
  if (snapshot.record.status === 'removed') throw new Error('Tombstones are immutable');
  return { id: snapshot.record.id, expected: snapshot.sha256, command: 'delete' };
}

export function prepareCanonicalStyle(style, datasetRoot) {
  if (Object.keys(style.sources).join(',') !== 'mazo' ||
      !/^pmtiles:\/\/mazo\.[a-f0-9]{64}\.pmtiles$/.test(style.sources.mazo.url))
    throw new Error('Expected a canonical Mazo tile source');
  const result = structuredClone(style);
  result.sources.mazo.url = 'pmtiles://' + new URL(style.sources.mazo.url.slice(10), datasetRoot).href;
  return result;
}
