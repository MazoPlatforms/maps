import { validateRecord, recordFeature, recordLabel, MAX_RECORDS } from './record-model.js';
export function communityLayers(dark = false) {
  return [
    {id:'community-polygons',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':dark?'#6c9d85':'#709e85','fill-opacity':0.4}},
    {id:'community-lines',type:'line',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':dark?'#b1d8bc':'#2b6a49','line-width':3}},
    {id:'community-points',type:'circle',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':6,'circle-color':dark?'#9de0b7':'#237a4b','circle-stroke-color':dark?'#10291a':'#ffffff','circle-stroke-width':2}},
    {id:'community-labels',type:'symbol',layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':13,'text-offset':[0,1.2],'text-anchor':'top'},paint:{'text-color':dark?'#dcfce7':'#17472c','text-halo-color':dark?'#14251a':'#ffffff','text-halo-width':1.5}},
  ].map(layer=>({...layer,source:'community'}));
}
export async function fetchCommunity(siteRoot, fetcher = fetch) {
  const response=await fetcher(new URL('data/community/manifest.json',siteRoot),{cache:'no-cache'});
  if(!response.ok) throw Error('Community publication is unavailable');
  const manifest=await response.json(); const part=manifest.records;
  if(manifest.schemaVersion!==1 || !Number.isInteger(manifest.recordCount) || manifest.recordCount<0 || manifest.recordCount>MAX_RECORDS || !part || !/^[a-f0-9]{64}$/.test(part.sha256) || part.file!==`records.${part.sha256}.json` || !Number.isInteger(part.bytes) || part.bytes<0 || part.bytes>8*1024*1024) throw Error('Invalid community manifest');
  const file=await fetcher(new URL(`data/community/${part.file}`,siteRoot));
  if(!file.ok) throw Error('Community records unavailable');
  // Published descriptors and actual streams are both bounded.
  const reader=file.body.getReader(); const chunks=[];let size=0;
  while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw Error('Community data exceeds limit');}chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(size!==part.bytes || digest!==part.sha256) throw Error('Community data checksum mismatch');
  const records=JSON.parse(new TextDecoder().decode(bytes));
  if(!Array.isArray(records)||records.length!==manifest.recordCount) throw Error('Invalid community record count');
  const ids=new Set();for(const record of records){validateRecord(record);if(ids.has(record.id))throw Error('Duplicate community ID');ids.add(record.id);}
  return records;
}
export async function setupCommunity(map, siteRoot) {
  let records=[];let available=false;
  const status=document.querySelector('#community-status');
  function install() {
    if(!available)return;
    if(!map.getSource('community')) map.addSource('community',{type:'geojson',data:{type:'FeatureCollection',features:records.filter(r=>r.status==='active').map(recordFeature)},attribution:'Mazo community · source-specific licenses; see community records'});
    for(const layer of communityLayers(document.documentElement.dataset.theme==='dark')) if(!map.getLayer(layer.id))map.addLayer(layer);
    document.dispatchEvent(new CustomEvent('mazo:community-ready'));
  }
  map.on('style.load',install);
  try {
    records=await fetchCommunity(siteRoot);available=true;install();
    status.textContent=`${records.filter(r=>r.status==='active').length} published community records`;
  } catch(error) { status.textContent=`${error.message}. Contributions cannot be edited until publication loads.`; }
  return {
    get records(){return records;}, get available(){return available;},
    features:()=>records.filter(r=>r.status==='active').map(record=>({...recordFeature(record),properties:{...recordFeature(record).properties,name:recordLabel(record),displayName:record.properties.names.primary,aliases:Object.values(record.properties.names).join(' ')}})),
    resolve:id=>records.find(record=>record.id===id),
  };
}
