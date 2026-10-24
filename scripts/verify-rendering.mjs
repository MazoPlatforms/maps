// Browser verification uses the actual published Sri Lanka archives; no synthetic map data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.');
const publicRoot = 'https://mazoplatforms.github.io/maps/';
const response = await fetch(publicRoot + 'data/sri-lanka/manifest.json', { signal: AbortSignal.timeout(30000) });
assert.ok(response.ok, 'Published data manifest unavailable');
const manifest = await response.json();
const archiveNames = new Set(Object.values(manifest.archives).map(a=>a.file));
const ranges = new Map();
async function publishedRange(file, range) {
  const key=file+':'+range;
  if (!ranges.has(key)) ranges.set(key,(async()=>{
    let last;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const upstream=await fetch(publicRoot+'data/sri-lanka/'+file,{headers:{Range:range},signal:AbortSignal.timeout(30000)});
        if(upstream.status!==206) throw new Error(`Published range returned ${upstream.status}`);
        const body=Buffer.from(await upstream.arrayBuffer());
        return {body,range:upstream.headers.get('content-range')};
      } catch(error) { last=error; }
    }
    throw last;
  })());
  return ranges.get(key);
}
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/maps/data/sri-lanka/manifest.json') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); return;
    }
    if (path.startsWith('/maps/data/sri-lanka/')) {
      const name=path.split('/').at(-1); const range=req.headers.range;
      if(!archiveNames.has(name)||!/^bytes=\d+-\d+$/.test(range||'')) {res.writeHead(400);res.end();return;}
      const data=await publishedRange(name,range);
      res.writeHead(206,{'Content-Type':'application/octet-stream','Accept-Ranges':'bytes','Content-Range':data.range,'Content-Length':data.body.length});
      res.end(data.body);return;
    }
    const file = resolve(root, path.replace(/^\/maps\//, '') || 'index.html');
    if (!file.startsWith(root + '/')) throw new Error('Invalid path');
    let content = await readFile(file);
    if (/sri-lanka-(light|dark)\.json$/.test(file)) {
      const style = JSON.parse(content);
      style.layers = style.layers.filter(layer => !layer.source || manifest.archives[layer.source].layers.includes(layer["source-layer"]));
      // Use existing content-addressed public data, with local candidate cartography.
      for (const [name, source] of Object.entries(style.sources))
        source.url = `pmtiles://http://${req.headers.host}/maps/data/sri-lanka/${manifest.archives[name].file}`;
      content = Buffer.from(JSON.stringify(style));
    }
    res.setHeader('Content-Type', ({'.json':'application/json','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/maps/?maptest`;
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
const output=process.env.RENDER_EVIDENCE_DIR || '/tmp/mazo-render-evidence';
await mkdir(output,{recursive:true});
try {
  for (const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?3:1});
    const page=await context.newPage(); const errors=[]; const failedRequests=[];
    page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
    page.on('pageerror', e=>errors.push(e.message));
    page.on('crash',()=>console.error('Chromium page crashed')); 
    await page.goto(url);
    await page.waitForFunction(()=>window.__mazoMap?.isStyleLoaded(),null,{timeout:90000});
    for (const theme of ['light','dark']) {
      console.error(`Checking ${mobile?'mobile':'desktop'} ${theme}`);
      if (theme==='dark') await page.click('#theme-toggle');
      await page.waitForFunction(t=>window.__mazoMap.isStyleLoaded()&&window.__mazoMap.getStyle().metadata['mazo:theme']===t,theme,{timeout:90000});
      await page.selectOption('#city-select','colombo');
      await page.waitForFunction(()=>window.__mazoMap.getZoom()>13.9,null,{timeout:30000});
      await page.evaluate(()=>window.__mazoMap.jumpTo({center:[79.8612,6.9271],zoom:16}));
      await page.waitForFunction(()=>window.__mazoMap.areTilesLoaded()&&window.__mazoMap.queryRenderedFeatures({layers:['place-names']}).length>0&&window.__mazoMap.queryRenderedFeatures({layers:['road-names']}).length>0,null,{timeout:90000});
      await page.waitForTimeout(500);
      const detail=await page.evaluate(()=>{
        const m=window.__mazoMap;
        const places=m.queryRenderedFeatures({layers:['place-names']});
        return {roadLabels:m.queryRenderedFeatures({layers:['road-names']}).map(f=>f.properties['@name']),roads:m.queryRenderedFeatures({layers:['road-lines']}).length,buildings:m.queryRenderedFeatures({layers:['building-fills']}).length,places:places.length,categories:[...new Set(places.map(f=>f.properties.basic_category))],icons:m.listImages(),connectorVisibility:m.getLayoutProperty('connectors','visibility'),roadPlacement:m.getLayoutProperty('road-names','symbol-placement'),pixelRatio:m.getPixelRatio(),overflow:document.documentElement.scrollWidth>innerWidth+1,mapError:window.__mazoMapError};
      });
      assert.ok(detail.roadLabels.length>0, 'Actual road names must render along road geometry');
      assert.ok(detail.roads>0); assert.ok(detail.buildings>0); assert.ok(detail.places>0);
      assert.equal(detail.connectorVisibility,'none'); assert.equal(detail.roadPlacement,'line');
      assert.ok(detail.icons.some(n=>n.startsWith('mazo-poi-'))); assert.ok(detail.pixelRatio<=2);
      assert.equal(detail.overflow,false);
      if(detail.mapError) console.error(JSON.stringify(failedRequests));
      assert.equal(detail.mapError,undefined);
      await page.evaluate(()=>{const m=window.__mazoMap;const center=m.getCenter();m.easeTo({center:[center.lng+.0002,center.lat],bearing:20,duration:400});});
      await page.waitForFunction(()=>!window.__mazoMap.isMoving()&&window.__mazoMap.getBearing()>19);
      detail.firstRenderMs=await page.evaluate(()=>Math.round(window.__mazoMapTimings.firstRender-window.__mazoMapTimings.started));
      detail.sampledHeapBytes=await page.evaluate(()=>performance.memory?.usedJSHeapSize);
      await page.locator('#map-frame').screenshot({path:`${output}/${mobile?'mobile':'desktop'}-${theme}.png`});
      await page.locator('.maplibregl-ctrl-zoom-out').click();
      await page.waitForFunction(()=>window.__mazoMap.getZoom()<15.2);
      await page.locator('.maplibregl-ctrl-zoom-in').click();
      await page.waitForFunction(()=>window.__mazoMap.getZoom()>15.8);
      if (mobile) {
        const frame=await page.locator('#map').boundingBox();
        const cy=frame.y+frame.height*.45; const cx=frame.x+frame.width*.5;
        const before=await page.evaluate(()=>window.__mazoMap.getCenter().lng);
        const cdp=await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-20,y:cy,id:1},{x:cx+20,y:cy,id:2}]});
        for(let d=10;d<=60;d+=10) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-20+d,y:cy,id:1},{x:cx+20+d,y:cy,id:2}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(lng=>Math.abs(window.__mazoMap.getCenter().lng-lng)>.00001,before);
        // Context disposal releases the input session after both theme checks.
      }
      await page.evaluate(()=>window.__mazoMap.jumpTo({zoom:10}));
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>window.__mazoMap.queryRenderedFeatures({layers:['place-names','building-fills']}).length),0);
      results.push({mobile,theme,...detail});
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  await writeFile(`${output}/rendering.json`,JSON.stringify({release:manifest.release,results},null,2)+'\n');
  console.log(JSON.stringify({release:manifest.release,results},null,2));
} finally { await browser.close(); server.close(); }
