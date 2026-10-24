import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.resolve(process.argv[2] ?? path.join(root, 'data/canonical'));
const fontDir = path.join(root, 'assets/fonts/source');
const output = path.join(root, 'assets/fonts/Noto Sans Regular');
const sourceCommit = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const makerRuntime = path.join(root, 'scripts/vendor/maplibre-font-maker');
const makerCommit = 'c56771948c59a01b89d0498d47dc4abf56c25338';
const makerHashes = {
  'sdfglyph.js': '2d5cce9e20511e3e1798a696b496cfb4fb9c55cd9cceaa73fd77849e1c3d7a64',
  'sdfglyph.wasm': 'de2986e66201499de76f21bb3a649e1f27d7d68af21cb2616dc3a7b25bade691',
};
const faceSpecs = [
  ['Noto Sans Regular', 'NotoSans.ttf', 'notosans', 'NotoSans%5Bwdth%2Cwght%5D.ttf'],
  ['Noto Sans Tamil Regular', 'NotoSansTamil.ttf', 'notosanstamil', 'NotoSansTamil%5Bwdth%2Cwght%5D.ttf'],
  ['Noto Sans Sinhala Regular', 'NotoSansSinhala.ttf', 'notosanssinhala', 'NotoSansSinhala%5Bwdth%2Cwght%5D.ttf'],
];
const chars = new Set(Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)));
const shards = (await readdir(snapshot)).filter((name) => /^records-.*\.jsonl\.gz$/.test(name)).sort();
if (!shards.length) throw new Error(`No canonical record shards in ${snapshot}`);
let labels = 0;
for (const shard of shards) {
  const content = gunzipSync(await readFile(path.join(snapshot, shard))).toString('utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    const record = JSON.parse(line);
    if (record.status !== 'active') continue;
    const properties = record.properties ?? {};
    const label = properties['@name'] ?? properties.names?.primary;
    if (typeof label !== 'string' || !label) continue;
    labels += 1;
    for (const char of label.normalize('NFKC')) chars.add(char);
  }
}
if (!labels) throw new Error('Canonical snapshot has no active labels');
const starts = [...new Set([...chars].map((char) => (char.codePointAt(0) <= 0xffff ? Math.floor(char.codePointAt(0) / 256) * 256 : null)).filter((n) => n !== null))].sort((a, b) => a - b);
const ranges = starts.map((start) => ({ start, end: start + 255 }));
const makeFonts = await loadFontMaker();
let stackPointer;
const fontPointers = [];
const files = [];
try {
  stackPointer = makeFonts.ccall('create_fontstack', 'number', ['string'], ['Noto Sans Regular']);
  if (!stackPointer) throw new Error('font-maker could not allocate a font stack');
  for (const [, file] of faceSpecs) {
    const fontBytes = await readFile(path.join(fontDir, file));
    const pointer = makeFonts._malloc(fontBytes.length);
    if (!pointer) throw new Error(`font-maker could not allocate ${file}`);
    fontPointers.push(pointer);
    new Uint8Array(makeFonts.HEAPU8.buffer, pointer, fontBytes.length).set(fontBytes);
    makeFonts.ccall('fontstack_add_face', null, ['number', 'number', 'number'], [stackPointer, pointer, fontBytes.length]);
  }
  for (const { start, end } of ranges) {
    const glyphPointer = makeFonts.ccall('generate_glyph_buffer', 'number', ['number', 'number'], [stackPointer, start]);
    if (!glyphPointer) throw new Error(`font-maker failed glyph range ${start}-${end}`);
    try {
      const dataPointer = makeFonts.ccall('glyph_buffer_data', 'number', ['number'], [glyphPointer]);
      const length = makeFonts.ccall('glyph_buffer_size', 'number', ['number'], [glyphPointer]);
      if (!dataPointer || length <= 0) throw new Error(`font-maker returned an empty glyph range ${start}-${end}`);
      files.push({ filename: `Noto Sans Regular/${start}-${end}.pbf`, bytes: new Uint8Array(makeFonts.HEAPU8.subarray(dataPointer, dataPointer + length)) });
    } finally {
      makeFonts.ccall('free_glyph_buffer', null, ['number'], [glyphPointer]);
    }
  }
} finally {
  if (stackPointer) makeFonts.ccall('free_fontstack', null, ['number'], [stackPointer]);
  for (const pointer of fontPointers) makeFonts._free(pointer);
}
await mkdir(output, { recursive: true });
const fileManifest = [];
for (const file of files) {
  const target = path.join(output, path.basename(file.filename));
  await writeFile(target, file.bytes);
  fileManifest.push({ file: path.relative(root, target).replaceAll(path.sep, '/'), bytes: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') });
}
const sources = await Promise.all(faceSpecs.map(async ([name, file, directory, upstreamFile]) => {
  const bytes = await readFile(path.join(fontDir, file));
  const license = `${directory}-OFL.txt`;
  return { name, file: `assets/fonts/source/${file}`, url: `https://github.com/google/fonts/blob/${sourceCommit}/ofl/${directory}/${upstreamFile}`, sha256: createHash('sha256').update(bytes).digest('hex'), license: `assets/fonts/source/${license}` };
}));
await writeFile(path.join(root, 'assets/fonts/manifest.json'), JSON.stringify({ schemaVersion: 1, fontstack: 'Noto Sans Regular', generatedBy: 'MapLibre font-maker WASM', generatorRepository: 'https://github.com/maplibre/font-maker', generatorCommit: makerCommit, generatorLicense: 'scripts/vendor/maplibre-font-maker/LICENSE.txt', generatorHashes: makerHashes, sourceRepository: 'https://github.com/google/fonts', sourceCommit, labelCount: labels, ranges: ranges.map(({ start, end }) => `${start}-${end}`), normalization: 'NFKC for rendered labels; source record names remain unchanged', sources, files: fileManifest }, null, 2) + '\n');
console.log(`Generated ${files.length} glyph ranges for ${labels} active canonical labels (${fileManifest.reduce((sum, file) => sum + file.bytes, 0)} bytes)`);

async function loadFontMaker() {
  const [glue, wasmBinary] = await Promise.all([
    readFile(path.join(makerRuntime, 'sdfglyph.js'), 'utf8'),
    readFile(path.join(makerRuntime, 'sdfglyph.wasm')),
  ]);
  for (const [file, bytes] of [['sdfglyph.js', Buffer.from(glue)], ['sdfglyph.wasm', wasmBinary]]) {
    if (createHash('sha256').update(bytes).digest('hex') !== makerHashes[file]) throw new Error(`Unverified MapLibre font-maker input: ${file}`);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const config = {
      wasmBinary,
      print: () => undefined,
      printErr: () => undefined,
      onAbort: (reason) => finish(() => reject(new Error(`font-maker WASM aborted: ${reason}`))),
      onRuntimeInitialized: () => {
        if (typeof context.UTF8ToString === 'function') config.UTF8ToString = context.UTF8ToString;
        finish(() => resolve(config));
      },
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const context = vm.createContext({ Module: config, console, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, TextDecoder, TextEncoder, WebAssembly });
    try {
      new vm.Script(glue, { filename: path.join(makerRuntime, 'sdfglyph.js') }).runInContext(context);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
