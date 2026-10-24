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
  const viewports=process.env.VERIFY_MOBILE_ONLY==='1'?[true]:[false,true];
  for (const mobile of viewports) {
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?3:1});
    const page=await context.newPage();
    if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750,connectionType:'cellular3g'});} const errors=[]; const failedRequests=[];
    page.on('response',r=>{if(r.status()>=400)console.error('HTTP',r.status(),r.url());});
    page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
    page.on('pageerror', e=>{errors.push(e.message);console.error(e.message);});
    page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
    page.on('crash',()=>console.error('Chromium page crashed')); 
    await page.goto(url);
    await page.waitForFunction(()=>window.__mazoMap?.isStyleLoaded(),null,{timeout:90000});
    await page.waitForFunction(()=>document.querySelector('#destinations')?.options.length>=50,null,{timeout:30000});
    try {await page.waitForFunction(()=>window.__mazoMap.getLayer('destination-names'),null,{timeout:30000});} catch(e) {console.error(await page.evaluate(()=>({error:window.__mazoMapError,timings:window.__mazoMapTimings,status:document.querySelector('#route-status').textContent,layers:window.__mazoMap.getStyle().layers.map(l=>l.id)})));throw e;}
    await page.waitForFunction(()=>window.__mazoMap.queryRenderedFeatures({layers:['destination-names']}).length>0,null,{timeout:30000});
    await page.waitForFunction(()=>window.__mazoMap.areTilesLoaded(),null,{timeout:90000});
    const initialLoad=await page.evaluate(()=>{
      const resources=performance.getEntriesByType('resource');
      return {firstRenderMs:Math.round(window.__mazoMapTimings.firstRender-window.__mazoMapTimings.started),requests:resources.length,transferBytes:resources.reduce((sum,e)=>sum+e.transferSize,0),encodedBytes:resources.reduce((sum,e)=>sum+e.encodedBodySize,0),resources:resources.map(e=>({url:new URL(e.name).pathname,transferBytes:e.transferSize})).filter(e=>e.transferBytes>0).slice(0,40)};
    });
    assert.ok(await page.evaluate(()=>window.__mazoMap.queryRenderedFeatures({layers:['road-lines']}).length>0),'Major roads must render at the initial island zoom');
    console.error('Overview',await page.evaluate(()=>({zoom:window.__mazoMap.getZoom(),classes:[...new Set(window.__mazoMap.querySourceFeatures('transportation',{sourceLayer:'segment'}).map(f=>f.properties.class))],sample:window.__mazoMap.querySourceFeatures('transportation',{sourceLayer:'segment'})[0]?.properties})));
    await page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}-overview.png`});
    assert.equal(await page.evaluate(()=>Math.abs(document.querySelector('#map').getBoundingClientRect().height-innerHeight)<2),true);
    assert.equal(await page.locator('footer, .explorer-heading, .project-section').count(),0);
    await page.fill('#map-search','Kandy');
    await page.waitForTimeout(250);
    if (!(await page.locator('#search-results button').count())) console.error('Search diagnostic', await page.evaluate(()=>({value:document.querySelector('#map-search').value,results:document.querySelector('#search-results').textContent,options:document.querySelector('#destinations').options.length,errors:window.__mazoExplorerError})));
    await page.locator('#search-results button').first().click();
    console.error('Search selected');
    await page.waitForFunction(()=>!window.__mazoMap.isMoving()&&window.__mazoMap.getZoom()>=14);
    console.error('Search zoom complete');
    await page.click('#directions-toggle');
    await page.evaluate(()=>{window.__mazoRouteMetrics=[];window.__mazoRouteTest=metric=>window.__mazoRouteMetrics.push(metric);});
    await page.fill('#route-from','Colombo'); await page.fill('#route-to','Kandy');
    const routeMetrics=[];
    for(const mode of mobile?['car']:['car','bike','foot']) {
      await page.selectOption('#route-mode',mode);
      await page.locator('#directions-form button[type="submit"]').click();
      console.error(`${mobile?'mobile':'desktop'} ${mode} route submitted`);
      await page.waitForFunction(()=>!document.querySelector('#route-status').classList.contains('is-loading')&&!document.querySelector('#directions-form button[type="submit"]').disabled,null,{timeout:90000});
      console.error(`${mobile?'mobile':'desktop'} ${mode} route finished: ${await page.locator('#route-status').textContent()}`);
      const route=await page.evaluate(()=>window.__mazoRouteMetrics.at(-1));
      assert.ok(await page.locator('#route-result').isVisible(),`${mode} route should display a result: ${await page.locator('#route-status').textContent()}`);
      assert.equal(route?.profile,mode,`${mode} route must complete successfully`);
      assert.ok(route.distance>50000 && route.coordinates>2 && route.steps>0,`${mode} route must return real geometry, distance, and instructions`);
      assert.ok(route.responseBytes>1000);
      assert.equal(await page.locator('#route-mode-label').textContent(),({car:'Driving',bike:'Cycling',foot:'Walking'})[mode]);
      assert.ok(await page.locator('#route-steps li').count()>0);
      await page.waitForFunction(()=>window.__mazoMap.queryRenderedFeatures({layers:['mazo-route-line']}).length>0,null,{timeout:30000});
      if(mode==='car'){
        assert.match(await page.locator('#route-distance').textContent(),/\d+(\.\d)? km/);
        await page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}-route.png`});
      }
      routeMetrics.push(route);
    }
    if(!mobile){
      await page.click('#route-clear');
      assert.equal(await page.locator('#route-result').isVisible(),false,'Clear removes the route result');
      await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:false}));
      await page.locator('#directions-form button[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#route-status').textContent.includes('offline'),null,{timeout:15000});
      assert.ok(await page.locator('#route-result').isVisible(),'Cached route must remain available offline');
      await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:true}));
      await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:false}));
      await page.selectOption('#route-mode','car');await page.fill('#route-from','Jaffna');await page.fill('#route-to','Trincomalee');
      await page.locator('#directions-form button[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#route-status').classList.contains('is-error'));
      assert.match(await page.locator('#route-status').textContent(),/offline and this route has not been saved/);
      await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:true}));
    }
    if(mobile){
      const handle=await page.locator('#directions-drag').boundingBox();const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
      await page.mouse.move(x,y);await page.mouse.down();
      await page.mouse.move(x,y-60,{steps:6});await page.mouse.up();
      await page.waitForFunction(()=>document.querySelector('#directions-panel').style.transform.includes('-60px'),null,{timeout:10000});
    }
    await page.click('#directions-close');
    await page.click('#layers-toggle');
    await page.locator('[data-layer="buildings"]').uncheck();
    assert.equal(await page.evaluate(()=>window.__mazoMap.getLayoutProperty('building-fills','visibility')),'none');
    await page.locator('[data-layer="buildings"]').check();
    await page.click('#layers-toggle');
    for (const theme of ['light','dark']) {
      console.error(`Checking ${mobile?'mobile':'desktop'} ${theme}`);
      if (theme==='dark') await page.click('#theme-toggle');
      await page.waitForFunction(t=>window.__mazoMap.isStyleLoaded()&&window.__mazoMap.getStyle().metadata['mazo:theme']===t,theme,{timeout:90000});
      await page.click('#layers-toggle');
      await page.selectOption('#city-select','colombo');
      await page.click('#layers-toggle');
      await page.waitForFunction(()=>window.__mazoMap.getZoom()>13.9,null,{timeout:30000});
      await page.evaluate(()=>window.__mazoMap.jumpTo({center:[79.8612,6.9271],zoom:16}));
      try {await page.waitForFunction(()=>window.__mazoMap.areTilesLoaded()&&window.__mazoMap.queryRenderedFeatures({layers:['place-names']}).length>0&&window.__mazoMap.queryRenderedFeatures({layers:['road-names']}).length>0,null,{timeout:90000});} catch(e) {console.error(await page.evaluate(()=>({error:window.__mazoMapError,center:window.__mazoMap.getCenter(),zoom:window.__mazoMap.getZoom(),tiles:window.__mazoMap.areTilesLoaded(),counts:['road-lines','road-names','place-names'].map(id=>[id,window.__mazoMap.queryRenderedFeatures({layers:[id]}).length])})));await page.screenshot({path:output+'/failure.png'});throw e;}
      await page.waitForTimeout(500);
      await page.click('[data-category="food"]');
      assert.equal(await page.locator('[data-category="food"]').getAttribute('aria-pressed'),'true');
      assert.ok(await page.evaluate(()=>JSON.stringify(window.__mazoMap.getFilter('place-names')).includes('mazo-poi-food')));
      await page.click('[data-category="all"]');
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
      await page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}-${theme}.png`});
      await page.locator('.maplibregl-ctrl-zoom-out').click();
      await page.waitForFunction(()=>window.__mazoMap.getZoom()<15.2);
      await page.locator('.maplibregl-ctrl-zoom-in').click();
      await page.waitForFunction(()=>window.__mazoMap.getZoom()>15.8);
      if (mobile) {
        const frame=await page.locator('#map').boundingBox();
        const cy=frame.y+frame.height*.45; const cx=frame.x+frame.width*.5;
        const cdp=await context.newCDPSession(page);
        for (const fingers of [1,2]) {
        const before=await page.evaluate(()=>window.__mazoMap.getCenter().lng);
        const points=d=>[{x:cx-20+d,y:cy,id:1},...(fingers===2?[{x:cx+20+d,y:cy,id:2}]:[])];
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});
        for(let d=10;d<=60;d+=10) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(d)});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(lng=>Math.abs(window.__mazoMap.getCenter().lng-lng)>.00001,before);
        }
        // Context disposal releases the input session after both theme checks.
      }
      await page.evaluate(()=>window.__mazoMap.jumpTo({zoom:10}));
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>window.__mazoMap.queryRenderedFeatures({layers:['place-names','building-fills']}).length),0);
      results.push({mobile,theme,initialLoad,...detail,routeMetrics:theme==='light'?routeMetrics:undefined,network:await page.evaluate(()=>{const entries=performance.getEntriesByType('resource').filter(e=>e.name.includes('/assets/')||e.name.includes('.pmtiles')||e.name.includes('routing.openstreetmap.de'));return {requests:entries.length,transferBytes:entries.reduce((sum,e)=>sum+e.transferSize,0),encodedBytes:entries.reduce((sum,e)=>sum+e.encodedBodySize,0),fontLoaded:document.fonts.check('14px Inter'),destinationParseMs:window.__mazoMapTimings?.destinationParseMs,destinationIndexMs:window.__mazoMapTimings?.destinationIndexMs};})});
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  await writeFile(`${output}/rendering.json`,JSON.stringify({release:manifest.release,results},null,2)+'\n');
  console.log(JSON.stringify({release:manifest.release,results},null,2));
} finally { await browser.close(); server.close(); }
