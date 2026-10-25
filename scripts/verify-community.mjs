// Isolated browser acceptance. Synthetic test records/land are never published.
// Existing verify-rendering.mjs separately tests real nationwide PMTiles ranges.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRecords, compareRecords } from './records.mjs';
import { validateRecord, parseRecordJson, recordHash, stableJson } from '../assets/js/record-model.js';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve('.'),stage=await mkdtemp(join(tmpdir(),'mazo-community-browser-'));
let records=new Map();await buildRecords(records,stage);
const style={version:8,name:'Community test harness',metadata:{'mazo:theme':'light'},glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{land:{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[79.3,5.8],[82.1,5.8],[82.1,10.1],[79.3,10.1],[79.3,5.8]]]}}]}},empty:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[{id:'land',type:'fill',source:'land',paint:{'fill-color':'#edf3ee'}},{id:'water-fill',type:'fill',source:'empty'},{id:'road-lines',type:'line',source:'empty'},{id:'place-names',type:'circle',source:'empty',filter:['has','name']}]};
const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.includes('/data/community/')) { const file=path.split('/').at(-1);if(!/^(manifest\.json|records\.[a-f0-9]{64}\.json)$/.test(file))throw Error('Invalid bundle');res.setHeader('Content-Type','application/json');res.end(await readFile(join(stage,file)));return; }
    if(/sri-lanka-(?:light|dark)\.json$/.test(path)) { const candidate=structuredClone(style);candidate.metadata['mazo:theme']=path.includes('dark')?'dark':'light';res.setHeader('Content-Type','application/json');res.end(JSON.stringify(candidate));return; }
    if(path.endsWith('/data/sri-lanka/manifest.json')) {res.setHeader('Content-Type','application/json');res.end('{"release":"browser-fixture"}');return;}
    const file=resolve(root,path.replace(/^\/maps\//,'') || 'index.html');if(!file.startsWith(root+'/'))throw Error('Invalid path');
    res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.geojson':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)] || 'application/octet-stream');res.end(await readFile(file));
  }catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const mobile of [false,true]) {
    records=new Map();await buildRecords(records,stage);
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/maps/?maptest=1`);
    await page.waitForFunction(()=>document.querySelector('#community-status').textContent.includes('0 published'));
    await page.click('#community-toggle');
    async function fillEvidence() {
      await page.fill('#record-source','Browser test observation');await page.fill('#record-attribution','Isolated browser suite');
      await page.selectOption('#record-license','CC0-1.0');await page.fill('#record-date','2026-10-25');await page.fill('#record-note','Test only — do not publish');
      await page.check('#record-consent');
    }
    async function proposal(button='button[type=submit]') {
      await page.locator(`#record-form ${button}`).click();await page.waitForSelector('#record-output:not([hidden])');
      return validateRecord(parseRecordJson(await page.locator('#record-after').textContent()));
    }
    await page.fill('#record-name','Browser fixture — not published');await page.locator('#record-form details summary').click();await page.fill('#record-name-ta','சோதனை');await page.fill('#record-category','pharmacy');
    await page.fill('#record-geometry','{"type":"Point","coordinates":[81.695,7.71]}');await fillEvidence();
    const created=await proposal();assert.equal(created.revision,1);assert.equal(created.properties.names.ta,'சோதனை');
    const github=new URL(await page.locator('#record-github').getAttribute('href'));assert.equal(github.hostname,'github.com');assert.equal(JSON.parse(github.searchParams.get('value')).id,created.id);
    const downloadEvent=page.waitForEvent('download');await page.click('#record-download');const download=await downloadEvent;assert.equal(download.suggestedFilename(),`${created.id}.json`);
    assert.equal(stableJson(JSON.parse(await readFile(await download.path(),'utf8'))),stableJson(created));
    await compareRecords(records,new Map([[created.id,created]]));records=new Map([[created.id,created]]);await buildRecords(records,stage);
    // Accept the proposal into an isolated publication and verify map/search reads it.
    await page.reload();await page.waitForFunction(()=>document.querySelector('#community-status').textContent.includes('1 published'));
    await page.evaluate(()=>window.__mazoMap.jumpTo({center:[81.695,7.71],zoom:16}));
    await page.waitForFunction(()=>window.__mazoMap.queryRenderedFeatures({layers:['community-points']}).length>0);
    await page.fill('#map-search','Browser fixture');await page.waitForSelector('#search-results button');assert.match(await page.locator('#search-results').textContent(),/Browser fixture/);
    await page.fill('#map-search','சோதனை');await page.waitForSelector('#search-results button');
    await page.click('#community-toggle');await page.selectOption('#record-select',created.id);await page.fill('#record-name','Corrected browser fixture');await fillEvidence();
    const edited=await proposal();assert.equal(edited.id,created.id);assert.equal(edited.revision,2);assert.equal(edited.previous,await recordHash(created));
    await compareRecords(records,new Map([[edited.id,edited]]));records=new Map([[edited.id,edited]]);await buildRecords(records,stage);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#community-status').textContent.includes('1 published'));
    await page.click('#community-toggle');await page.selectOption('#record-select',edited.id);await fillEvidence();const deleted=await proposal('#record-delete');
    assert.equal(deleted.status,'deleted');await compareRecords(records,new Map([[deleted.id,deleted]]));records=new Map([[deleted.id,deleted]]);await buildRecords(records,stage);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#community-status').textContent.includes('0 published'));
    assert.equal(await page.evaluate(()=>window.__mazoMap.getSource('community')._data.features.length),0);
    await page.click('#community-toggle');await page.selectOption('#record-select',deleted.id);await fillEvidence();const restored=await proposal('#record-restore');assert.equal(restored.status,'active');assert.equal(restored.revision,4);
    await compareRecords(records,new Map([[restored.id,restored]]));
    await page.click('#record-save');await page.click('#record-new');await page.click('#record-load');assert.equal(await page.inputValue('#record-name'),restored.properties.names.primary);assert.equal(await page.isChecked('#record-consent'),false);
    await page.click('#contribution-close');await page.click('#theme-toggle');await page.waitForFunction(()=>window.__mazoMap.getLayer('community-points'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.click('#community-toggle');await mkdir('verification',{recursive:true});await page.screenshot({path:`verification/community-${mobile?'mobile':'desktop'}.png`});
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Desktop/mobile community proposal → review validation → publish → search/map → edit → tombstone → restore passed. No production records changed.');
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(stage,{recursive:true,force:true});}
