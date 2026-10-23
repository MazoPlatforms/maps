import { open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PMTiles } from '../assets/vendor/pmtiles.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Archive directory required');
const manifestPath = join(directory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
function fields(bytes) {
  let offset = 0;
  function number() {
    let value = 0,
      shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
      if (shift > 63) throw new Error('Invalid protobuf integer');
    }
    throw new Error('Truncated protobuf integer');
  }
  const result = [];
  while (offset < bytes.length) {
    const tag = number(),
      wire = tag & 7;
    let value;
    if (wire === 0) value = number();
    else if (wire === 2) {
      const size = number();
      value = bytes.subarray(offset, offset + size);
      offset += size;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
    } else throw new Error('Unsupported protobuf wire type');
    if (offset > bytes.length) throw new Error('Truncated protobuf field');
    result.push([tag >>> 3, value]);
  }
  return result;
}
function tagIndices(bytes) {
  const result = [];
  let value = 0,
    shift = 0;
  for (const byte of bytes) {
    value += (byte & 127) * 2 ** shift;
    if (byte & 128) shift += 7;
    else {
      result.push(value);
      value = 0;
      shift = 0;
    }
  }
  if (shift) throw new Error('Truncated feature tags');
  return result;
}
const decoder = new TextDecoder();
const evidence = {};
for (const [theme, archive] of Object.entries(manifest.archives)) {
  const file = await open(join(directory, archive.file), 'r');
  try {
    const source = {
      getKey: () => archive.file,
      async getBytes(offset, length) {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, offset);
        return { data: Uint8Array.from(buffer.subarray(0, bytesRead)).buffer };
      },
    };
    const pmtiles = new PMTiles(source);
    const counts = {};
    for (const zoom of [
      ...new Set([archive.minZoom, 4, 8, 12, archive.maxZoom]),
    ].filter((z) => z >= archive.minZoom && z <= archive.maxZoom)) {
      let count = 0;
      const visited = new Set();
      for (const [lon, lat] of [
        [79.8612, 6.9271],
        [80.0255, 9.6615],
        [81.2152, 8.5874],
        [81.695, 7.71],
        [80.6337, 7.2906],
        [80.217, 6.0329],
      ]) {
        const x = Math.floor(((lon + 180) / 360) * 2 ** zoom);
        const y = Math.floor(
          ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) *
            2 ** zoom,
        );
        if (visited.has(`${x}/${y}`)) continue;
        visited.add(`${x}/${y}`);
        const tile = await pmtiles.getZxy(zoom, x, y);
        if (!tile) continue;
        for (const [, layerBytes] of fields(new Uint8Array(tile.data)).filter(
          ([key]) => key === 3,
        )) {
          const layer = fields(layerBytes);
          const keys = layer
            .filter(([key]) => key === 3)
            .map(([, value]) => decoder.decode(value));
          const values = layer
            .filter(([key]) => key === 4)
            .map(([, value]) => fields(value).find(([key]) => key === 1)?.[1]);
          for (const [, feature] of layer.filter(([key]) => key === 2)) {
            const tags = tagIndices(
              fields(feature).find(([key]) => key === 2)?.[1] ?? [],
            );
            let id;
            for (let i = 0; i < tags.length; i += 2)
              if (keys[tags[i]] === 'id') id = values[tags[i + 1]];
            if (!(id instanceof Uint8Array) || !decoder.decode(id))
              throw new Error(`Missing string source ID: ${theme} z${zoom}`);
            count++;
          }
        }
      }
      counts[zoom] = count;
    }
    if (!Object.values(counts).some(Boolean))
      throw new Error(`No source identity evidence for ${theme}`);
    evidence[theme] = counts;
  } finally {
    await file.close();
  }
}
manifest.sourceIdentity = {
  property: 'id',
  allZooms: true,
  profile: 'mazo-id-v1',
  sampledFeatures: evidence,
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(evidence));
