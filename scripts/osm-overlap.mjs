#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const bounds=[79.3,5.8,82.1,10.1];
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu,' ').trim();
const hash=s=>createHash('sha256').update(s).digest('hex');
function id(f,origin){
  const p=f.properties??{};
  if(origin==='osm'){
    const type=p.osm_type??p['@type']; const num=p.osm_id??p['@id'];
    if(['node','way','relation'].includes(String(type)) && /^\\d+$/.test(String(num))) return `osm:${type}:${num}`;
    if(typeof f.id==='string' && /^((node|way|relation)\\/\\d+|osm:(node|way|relation):\\d+)$/.test(f.id)) return f.id.replace(/^([^:]+)\\/(\\d+)$/,'osm:$1:$2');
  }
  return String(p.id??f.id??'');
}
function point(f){
  if(f.geometry?.type==='Point')return f.geometry.coordinates;
  return null;
}
function validPoint(p){return Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3]}
function distance(a,b){
  const rad=Math.PI/180,lat=(a[1]+b[1])/2*rad;
  return Math.hypot((a[0]-b[0])*111320*Math.cos(lat),(a[1]-b[1])*111320);
}
function category(f){const p=f.properties??{};return normalize(p.category??p.primary_category??p.amenity??p.shop??p.tourism??p.highway??'')}
function name(f){const p=f.properties??{};return normalize(p.name??p.names?.primary??'')}
export function analyze(osm,overture,{radius=30}={}){
  if(!Number.isFinite(radius)||radius<=0||radius>100)throw Error('radius must be in (0,100] metres');
  for(const [label,data] of [['OSM',osm],['Overture',overture]])if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error(label+' must be a GeoJSON FeatureCollection');
  const known=new Map(),issues=[],matched=[],candidates=[],osmOnly=[],sourceIds=new Set();
  for(const f of overture.features){
    const p=f.properties??{},ref=p.sources?.find?.(s=>s.dataset==='OpenStreetMap')?.record_id??p.osm_id;
    if(ref)known.set(String(ref),f);
  }
  for(const f of osm.features){
    const key=id(f,'osm'),pos=point(f);
    if(!key){issues.push({kind:'missing_osm_identity'});continue}
    if(sourceIds.has(key)){issues.push({kind:'duplicate_osm_identity',id:key});continue}
    sourceIds.add(key);
    if(pos&&!validPoint(pos)){issues.push({kind:'out_of_bounds',id:key});continue}
    const explicit=known.get(key)||known.get(key.replace(/^osm:/,'').replace(':','/'));
    if(explicit){matched.push({osm:key,overture:id(explicit,'overture'),method:'source_identity'});continue}
    if(pos&&name(f)){
      const nearby=overture.features.filter(g=>point(g)&&validPoint(point(g))&&name(g)===name(f)&&category(g)===category(f)&&distance(pos,point(g))<=radius);
      if(nearby.length){candidates.push({osm:key,overture:nearby.map(g=>id(g,'overture')),method:'review_required'});continue}
    }
    osmOnly.push(f);
  }
  const sort=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
  matched.sort(sort);candidates.sort(sort);issues.sort(sort);osmOnly.sort((a,b)=>id(a,'osm').localeCompare(id(b,'osm')));
  return {report:{schemaVersion:1,osmInputCount:osm.features.length,overtureInputCount:overture.features.length,matchedCount:matched.length,reviewCount:candidates.length,osmOnlyCount:osmOnly.length,issueCount:issues.length,matched,candidates,issues},overlay:{type:'FeatureCollection',features:osmOnly}};
}
async function main(){
  const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
  if(args.length!==8||!['--osm','--overture','--report','--overlay'].every(k=>args.includes(k)))throw Error('Usage: node scripts/osm-overlap.mjs --osm osm.geojson --overture overture.geojson --report report.json --overlay osm-only.geojson');
  const osmBytes=await readFile(get('--osm')),overtureBytes=await readFile(get('--overture'));
  const result=analyze(JSON.parse(osmBytes),JSON.parse(overtureBytes));
  result.report.inputs={osmSha256:hash(osmBytes),overtureSha256:hash(overtureBytes)};
  for(const [path,value] of [[get('--report'),result.report],[get('--overlay'),result.overlay]]){
    await mkdir(dirname(resolve(path)),{recursive:true});
    await writeFile(path,JSON.stringify(value,null,2)+'\\n');
  }
  console.log(JSON.stringify({matched:result.report.matchedCount,review:result.report.reviewCount,osmOnly:result.report.osmOnlyCount,issues:result.report.issueCount}));
}
if(process.argv[1]?.endsWith('osm-overlap.mjs'))main().catch(e=>{console.error(e.message);process.exitCode=1});
