import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseRecordJson, validateRecord, validateTransition, recordPath, stableJson, recordFeature, MAX_RECORD_BYTES, MAX_RECORDS, RECORD_TYPES } from '../assets/js/record-model.js';
export async function loadRecords(root) {
  const records = new Map(); const directory = join(root,'records');
  let visited=0;
  async function walk(path) {
    try { if((await lstat(path)).isSymbolicLink()) throw Error('Record symlinks are forbidden'); } catch(error) { if(error.code==='ENOENT' && path===directory)return;throw error; }
    let entries; try { entries = await readdir(path,{withFileTypes:true}); } catch(error) { if(error.code === 'ENOENT' && path === directory) return; throw error; }
    for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      if(++visited>25000)throw Error('Record tree exceeds entry limit');
      const file=join(path,entry.name); const info=await lstat(file);
      if (info.isSymbolicLink()) throw Error('Record symlinks are forbidden');
      if (entry.isDirectory()) { const parts=relative(directory,file).split('/'); if(parts.length>2 || !Object.hasOwn(RECORD_TYPES,parts[0]) || (parts.length===2 && !/^[a-f0-9]{2}$/.test(parts[1]))) throw Error('Unexpected record directory'); await walk(file); }
      else if (entry.name.endsWith('.json')) {
        if(info.size>MAX_RECORD_BYTES) throw Error('Record exceeds 128 KiB');
        const record=validateRecord(parseRecordJson(await readFile(file,'utf8')));
        if(relative(root,file)!==recordPath(record)) throw Error(`Noncanonical record path: ${relative(root,file)}`);
        if(records.has(record.id)) throw Error('Duplicate permanent ID'); records.set(record.id,record);
        if(records.size>MAX_RECORDS) throw Error(`Community release exceeds ${MAX_RECORDS} records; partition the publisher before expanding`);
      } else if (file !== join(directory,'README.md')) throw Error(`Unexpected record file: ${file}`);
    }
  }
  await walk(directory); return records;
}
export async function compareRecords(before, after) {
  const changes=[];
  for(const [id,old] of before) if(!after.has(id)) throw Error(`Record ${id} was removed; retain a deleted tombstone`);
  for(const [id,record] of after) {
    const old=before.get(id); if(old && stableJson(old)===stableJson(record)) continue;
    await validateTransition(old,record);
    changes.push({id,path:recordPath(record),action:!old?'add':record.status==='deleted'?'delete':old.status==='deleted'?'restore':'update',before:old || null,after:record});
  }
  return changes;
}
export async function buildRecords(records, output) {
  const ordered=[...records.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const collection={type:'FeatureCollection',features:ordered.filter(r=>r.status==='active').map(recordFeature)};
  await mkdir(output,{recursive:true}); const descriptors={};
  for(const [kind,value,extension] of [['records',ordered,'json'],['features',collection,'geojson']]) {
    const bytes=Buffer.from(stableJson(value)+'\n');
    if(bytes.length>8*1024*1024) throw Error('Community bundle exceeds 8 MiB; partition publication first');
    const sha256=createHash('sha256').update(bytes).digest('hex'); const file=`${kind}.${sha256}.${extension}`;
    await writeFile(join(output,file),bytes); descriptors[kind]={file,sha256,bytes:bytes.length};
  }
  const manifest={schemaVersion:1,recordCount:ordered.length,activeCount:collection.features.length,...descriptors};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n'); return manifest;
}
export async function main(args) {
  const options={}; for(let i=0;i<args.length;i+=2) options[args[i]]=args[i+1];
  const root=resolve(options['--root'] || '.'); const records=await loadRecords(root);
  let changes;
  if(options['--base']) changes=await compareRecords(await loadRecords(resolve(options['--base'])),records);
  if(options['--report']) {
    if(!changes) throw Error('--report requires --base');
    await mkdir(options['--report'],{recursive:true});
    await writeFile(join(options['--report'],'changes.json'),JSON.stringify(changes,null,2)+'\n');
    for(const [name,key] of [['before','before'],['after','after']]) await writeFile(join(options['--report'],`${name}.geojson`),JSON.stringify({type:'FeatureCollection',features:changes.filter(c=>c[key]).map(c=>recordFeature(c[key]))},null,2)+'\n');
  }
  if(options['--output']) await buildRecords(records,resolve(options['--output']));
  console.log(`${records.size} records validated${changes?`; ${changes.length} changes`:''}`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
