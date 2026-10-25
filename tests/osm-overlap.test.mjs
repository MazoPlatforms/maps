import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../scripts/osm-overlap.mjs';
const fc=features=>({type:'FeatureCollection',features});
const poi=(id,name,coords,category='mosque')=>({type:'Feature',id,properties:{name,category},geometry:{type:'Point',coordinates:coords}});
test('preserves distinct nearby businesses and sends possible duplicates to review',()=>{
  const osm=fc([{...poi('node/12','Central Mosque',[81.72,7.71]),properties:{name:'Central Mosque',category:'mosque',osm_type:'node',osm_id:12}},poi('osm:node:13','Another Mosque',[81.7201,7.71])]);
  const overture=fc([poi('ov1','Central Mosque',[81.72001,7.71])]);
  const {report,overlay}=analyze(osm,overture);
  assert.equal(report.reviewCount,1);
  assert.equal(report.osmOnlyCount,1);
  assert.equal(overlay.features[0].id,'osm:node:13');
});
test('explicit upstream OSM identities match without proximity',()=>{
  const osm=fc([poi('osm:way:5','A',[81.7,7.7])]);
  const overture=fc([{...poi('ov5','B',[81.8,7.8]),properties:{name:'B',sources:[{dataset:'OpenStreetMap',record_id:'osm:way:5'}]}}]);
  assert.equal(analyze(osm,overture).report.matchedCount,1);
});
test('rejects duplicate OSM IDs and out of bounds points',()=>{
  const osm=fc([poi('osm:node:1','A',[81.7,7.7]),poi('osm:node:1','A',[81.7,7.7]),poi('osm:node:2','B',[0,0])]);
  const report=analyze(osm,fc([])).report;
  assert.equal(report.issueCount,2);
  assert.equal(report.osmOnlyCount,1);
});
test('invalid input fails closed',()=>assert.throws(()=>analyze({},fc([]))));
