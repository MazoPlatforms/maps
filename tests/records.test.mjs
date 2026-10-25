import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { validateRecord, validateTransition, recordHash, recordPath, parseRecordJson } from '../assets/js/record-model.js';
import { loadRecords, compareRecords, buildRecords } from '../scripts/records.mjs';
import { fetchCommunity, communityLayers } from '../assets/js/community.js';
import { adminDecision } from '../scripts/record-review.mjs';
function fixture(overrides={}) { return {schemaVersion:1,id:'12345678-1234-4234-8234-123456789abc',featureType:'place',revision:1,previous:null,status:'active',geometry:{type:'Point',coordinates:[81.695,7.71]},properties:{names:{primary:'Test-only survey',ta:'சோதனை'},category:'pharmacy'},sources:[{name:'Test fixture, never published',license:'CC0-1.0',observedAt:'2026-10-25',attribution:'Test suite'}],changeNote:'Test fixture',...overrides}; }
test('strict record input rejects duplicate keys, unsafe keys, trailing data and nonfinite values',()=>{
  for(const input of ['{"id":1,"id":2}','{"nested":{"x":1,"x":2}}','{"__proto__":{}}','{"x":NaN}','{} {}','{"x":1,}'])assert.throws(()=>parseRecordJson(input));
  assert.equal(parseRecordJson('{"name":"தமிழ்","a":[1,true,null]}').name,'தமிழ்');
});
test('records reject invalid geometry, unsafe sources, missing evidence and unknown properties',()=>{
  validateRecord(fixture());
  for(const changed of [fixture({geometry:{type:'Point',coordinates:[7.71,81.695]}}),fixture({sources:[]}),fixture({upstream:{id:'unverified'}}),fixture({properties:{names:{primary:'Test'},category:'place',html:'<script>'}}),fixture({sources:[{name:'Bad source',license:'CC0-1.0',observedAt:'2026-02-30',attribution:'Test'}]})])assert.throws(()=>validateRecord(changed));
  const source=fixture();source.sources[0].url='javascript:alert(1)';assert.throws(()=>validateRecord(source));
  const polygon=fixture({featureType:'building',geometry:{type:'Polygon',coordinates:[[[81,7],[81.1,7],[81.1,7.1],[81,7.1],[81,7]]]}});validateRecord(polygon);
  polygon.geometry.coordinates=[[[81,7],[81.1,7.1],[81,7.1],[81.1,7],[81,7]]];assert.throws(()=>validateRecord(polygon));
});
test('parent hashes, monotonic revisions and provenance prevent stale or destructive edits',async()=>{
  const before=fixture();const after=fixture({revision:2,previous:await recordHash(before),changeNote:'Corrected survey',status:'deleted'});
  await validateTransition(before,after);
  await assert.rejects(validateTransition(before,{...after,previous:'0'.repeat(64)}),/Stale/);
  await assert.rejects(validateTransition(before,{...after,sources:[{...before.sources[0],attribution:'Changed original'}]}),/provenance/);
  await assert.rejects(validateTransition(null,after),/revision 1/);
  const restored={...after,status:'active',revision:3,previous:await recordHash(after)};await validateTransition(after,restored);
  await assert.rejects(compareRecords(new Map([[before.id,before]]),new Map()),/tombstone/);
});
test('filesystem records use immutable paths and reject symlinks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mazo-records-'));
  try {
    const r=fixture();const path=join(root,recordPath(r));await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(r));
    assert.equal((await loadRecords(root)).size,1);
    await writeFile(join(dirname(path),'wrong.json'),JSON.stringify(r));await assert.rejects(loadRecords(root),/Noncanonical/);await rm(join(dirname(path),'wrong.json'));
    await symlink(path,join(dirname(path),'link.json'));await assert.rejects(loadRecords(root),/symlink/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('add → publication → edit → deletion → restore produces deterministic checksummed bundles',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mazo-publish-'));
  try {
    const first=fixture();let records=new Map([[first.id,first]]);
    assert.equal((await compareRecords(new Map(),records))[0].action,'add');
    const manifest=await buildRecords(records,join(root,'first'));
    assert.deepEqual(manifest,await buildRecords(records,join(root,'second')));
    const fetcher=async url=>{try{return new Response(await readFile(join(root,'first',new URL(url).pathname.split('/').at(-1))))}catch{return new Response('',{status:404})}};
    const published=await fetchCommunity('https://test.invalid/maps/',fetcher);assert.equal(published[0].properties.names.ta,'சோதனை');
    const edited={...first,revision:2,previous:await recordHash(first),properties:{...first.properties,names:{primary:'Corrected'}}};
    assert.equal((await compareRecords(records,new Map([[first.id,edited]])))[0].action,'update');records=new Map([[first.id,edited]]);
    const deleted={...edited,status:'deleted',revision:3,previous:await recordHash(edited)};
    assert.equal((await compareRecords(records,new Map([[first.id,deleted]])))[0].action,'delete');
    const d=await buildRecords(new Map([[first.id,deleted]]),join(root,'deleted'));assert.equal(d.activeCount,0);assert.equal(d.recordCount,1);
    await writeFile(join(root,'first',manifest.records.file),'[]\n');await assert.rejects(fetchCommunity('https://test.invalid/',fetcher),/checksum/);
    assert.deepEqual(communityLayers().map(l=>l.id),communityLayers(true).map(l=>l.id));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('admin approval is bound to current head, trusted maintainers and outstanding change requests',()=>{
  const head='a'.repeat(40);const base={head,author:'contributor',maintainers:['admin'],reviews:[],comments:[]};
  assert.equal(adminDecision(base).approved,false);
  assert.equal(adminDecision({...base,reviews:[{user:{login:'stranger'},commit_id:head,state:'APPROVED'}]}).approved,false);
  assert.equal(adminDecision({...base,reviews:[{user:{login:'admin'},commit_id:'b'.repeat(40),state:'APPROVED'}]}).approved,false);
  assert.equal(adminDecision({...base,reviews:[{user:{login:'admin'},commit_id:head,state:'APPROVED'}]}).approved,true);
  assert.equal(adminDecision({...base,author:'admin',comments:[{user:{login:'admin'},body:`/approve-records ${head}`}]}).approved,true);
  assert.equal(adminDecision({...base,author:'admin',comments:[{user:{login:'admin'},body:`/approve-records ${head}`}],reviews:[{user:{login:'admin'},commit_id:head,state:'CHANGES_REQUESTED'}]}).approved,false);
});
