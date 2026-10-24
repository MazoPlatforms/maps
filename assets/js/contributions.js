const types = {
  place: ['places', 'place'],
  building: ['buildings', 'building'],
  building_part: ['buildings', 'building_part'],
  road: ['transportation', 'segment'],
  connector: ['transportation', 'connector'],
  ...Object.fromEntries(
    [
      'land',
      'land_cover',
      'land_use',
      'water',
      'infrastructure',
      'bathymetry',
    ].map((type) => [type, ['base', type]]),
  ),
};

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ],
  );
}

export async function fetchContributions(siteRoot, fetcher = fetch) {
  const response = await fetcher(
    new URL('data/contributions/manifest.json', siteRoot),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Contribution manifest unavailable');
  const manifest = await response.json();
  if (manifest.schemaVersion !== 1)
    throw new Error('Unsupported contribution schema');
  const baseResponse = await fetcher(
    new URL('data/sri-lanka/manifest.json', siteRoot),
  );
  if (!baseResponse.ok) throw new Error('Basemap manifest unavailable');
  const basemap = await baseResponse.json();
  if (
    manifest.release !== basemap.release ||
    Object.entries(basemap.archives).some(
      ([theme, archive]) => manifest.basemap[theme] !== archive.sha256,
    )
  ) {
    throw new Error('Contributions belong to another basemap');
  }
  if (
    Object.keys(manifest.suppressions).length &&
    (basemap.sourceIdentity?.property !== 'id' ||
      basemap.sourceIdentity?.allZooms !== true)
  ) {
    throw new Error('Basemap source identity unavailable');
  }
  if (
    !/^features\.[a-f0-9]{64}\.geojson$/.test(manifest.layer.file) ||
    manifest.layer.file !== `features.${manifest.layer.sha256}.geojson` ||
    manifest.layer.bytes > 16 * 1024 * 1024
  )
    throw new Error('Invalid contribution layer');
  const layerResponse = await fetcher(
    new URL(`data/contributions/${manifest.layer.file}`, siteRoot),
  );
  if (!layerResponse.ok) throw new Error('Contribution layer unavailable');
  const body = await layerResponse.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (
    hash !== manifest.layer.sha256 ||
    body.byteLength !== manifest.layer.bytes
  ) {
    throw new Error('Contribution checksum mismatch');
  }
  const data = JSON.parse(new TextDecoder().decode(body));
  if (
    data.type !== 'FeatureCollection' ||
    data.features.length !== manifest.features
  ) {
    throw new Error('Invalid contribution collection');
  }
  return { manifest, data };
}

export function prepareContributions(style, bundle) {
  if (!bundle) return style;
  const { manifest, data } = bundle;
  const result = structuredClone(style);
  const active = new Set(
    data.features.map((feature) => feature.properties._mazoType),
  );
  if (!active.size && !Object.keys(manifest.suppressions).length) return result;
  result.sources.contributions = {
    type: 'geojson',
    data,
    maxzoom: 16,
    attribution: manifest.attribution.map(escapeHtml).join(' · '),
  };
  const layers = [];
  const covered = new Set();
  for (const original of result.layers) {
    const layer = structuredClone(original);
    const suppressed =
      manifest.suppressions[layer.source]?.[layer['source-layer']];
    if (suppressed?.length) {
      const filter = ['!', ['in', ['get', 'id'], ['literal', suppressed]]];
      layer.filter = original.filter
        ? ['all', original.filter, filter]
        : filter;
    }
    layers.push(layer);
    for (const type of active) {
      const source = types[type];
      if (
        !source ||
        original.source !== source[0] ||
        original['source-layer'] !== source[1]
      )
        continue;
      const copy = structuredClone(original);
      copy.id = `contribution-${type}-${original.id}`;
      copy.source = 'contributions';
      delete copy['source-layer'];
      const filter = ['==', ['get', '_mazoType'], type];
      copy.filter = original.filter ? ['all', filter, original.filter] : filter;
      layers.push(copy);
      covered.add(`${type}:${original.type}`);
    }
  }
  const dark = result.metadata?.['mazo:theme'] === 'dark';
  for (const type of active) {
    for (const [kind, geometry, paint] of [
      [
        'fill',
        'Polygon',
        { 'fill-color': dark ? '#547768' : '#9dbdae', 'fill-opacity': 0.45 },
      ],
      [
        'line',
        'LineString',
        { 'line-color': dark ? '#b3cabd' : '#426b58', 'line-width': 2 },
      ],
      [
        'circle',
        'Point',
        { 'circle-color': dark ? '#f0c96a' : '#26423f', 'circle-radius': 4 },
      ],
    ]) {
      if (covered.has(`${type}:${kind}`)) continue;
      layers.push({
        id: `contribution-${type}-${kind}`,
        type: kind,
        source: 'contributions',
        filter: [
          'all',
          ['==', ['get', '_mazoType'], type],
          ['==', ['geometry-type'], geometry],
        ],
        paint,
      });
    }
    if (type === 'administrative_boundary') {
      layers.push({
        id: 'contribution-administrative-boundary-outline',
        type: 'line',
        source: 'contributions',
        filter: ['==', ['get', '_mazoType'], type],
        paint: {
          'line-color': dark ? '#b3cabd' : '#426b58',
          'line-width': 2,
          'line-dasharray': [3, 2],
        },
      });
    }
  }
  result.layers = layers;
  return result;
}
