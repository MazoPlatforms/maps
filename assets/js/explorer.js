import { setupRouting } from './routing.js';
import { setupCommunity } from './community.js';
import { setupRecordEditor } from './record-editor.js';

// Native vector labels and bounded DOM controls; never one DOM marker per place.
export async function setupExplorer(map, maplibre, siteRoot) {
  const community = await setupCommunity(map, siteRoot);
  setupRecordEditor(map, community);
  const $ = selector => document.querySelector(selector);
  const search = $('#map-search');
  const results = $('#search-results');
  let catalog = [], catalogIndex = [], overview, popup, category = 'all';
  const hidden = new Set();
  const placeFilter = map.getFilter('place-names');
  const destinationFilter = ['>=',['zoom'],['get','minzoom']];
  const directionsElements = {
    form: $('#directions-form'), from: $('#route-from'), to: $('#route-to'),
    mode: $('#route-mode'), status: $('#route-status'), result: $('#route-result'),
    distance: $('#route-distance'), duration: $('#route-duration'),
    modeLabel: $('#route-mode-label'), steps: $('#route-steps'),
    submit: $('#directions-form button[type="submit"]'),
    panel: $('#directions-panel'), drag: $('#directions-drag'),
    toggle: $('#directions-toggle'), close: $('#directions-close'),
    swap: $('#route-swap'), clear: $('#route-clear'),
  };
  setupRouting(map, directionsElements, name => catalog.find(f =>
    normalize(f.properties.name || f.properties['@name']) === normalize(name)));
  const groups = {
    roads: ['road-casing', 'road-lines', 'road-names', 'highway-names', 'rail-lines'],
    buildings: ['building-fills', 'building-parts', 'building-outlines'],
    places: ['place-names'], landmarks: ['destination-names'], community: ['community-polygons','community-lines','community-points','community-labels'],
  };
  function apply() {
    if (!map.getLayer('place-names')) return;
    map.setFilter('place-names', category === 'all' ? placeFilter : ['all', placeFilter,
      ['==', map.getLayoutProperty('place-names', 'icon-image'), `mazo-poi-${category}`]]);
    if (map.getLayer('destination-names')) map.setFilter('destination-names', ['all',destinationFilter,category === 'all' ? ['has','name'] : ['==', ['get','category'], category]]);
    for (const [group,layers] of Object.entries(groups)) for (const id of layers)
      if (map.getLayer(id)) map.setLayoutProperty(id,'visibility',hidden.has(group)?'none':'visible');
  }
  function select(feature) {
    if (feature.geometry.type !== 'Point') {
      const points = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
      const bounds = points.reduce((b,p)=>[[Math.min(b[0][0],p[0]),Math.min(b[0][1],p[1])],[Math.max(b[1][0],p[0]),Math.max(b[1][1],p[1])]],[[Infinity,Infinity],[-Infinity,-Infinity]]);
      map.fitBounds(bounds,{padding:70,maxZoom:16});
      results.hidden=true;
      if(feature.properties.id)document.dispatchEvent(new CustomEvent('mazo:edit-community',{detail:feature.properties.id}));
      return;
    }
    const coordinates = feature.geometry.coordinates;
    const name = feature.properties.name || feature.properties['@name'];
    map.flyTo({center:coordinates,zoom:feature.properties.category==='park'?11:14,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:700});
    results.hidden = true;
    popup?.remove();
    const content = document.createElement('div');
    const title = document.createElement('h2'); title.textContent = name;
    const button = document.createElement('button'); button.textContent='Directions';
    button.addEventListener('click',()=>{ openPanel('directions'); $('#route-to').value=name; });
    content.append(title,button);
    if (community.resolve(feature.properties.id)) {
      const edit=document.createElement('button');edit.textContent='Propose an edit';
      edit.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('mazo:edit-community',{detail:feature.properties.id})));
      content.append(edit);
    }
    popup=new maplibre.Popup({offset:12}).setLngLat(coordinates).setDOMContent(content).addTo(map);
    // Include selected real POIs in the directions handoff, without inventing coordinates.
    if (!catalog.some(f=>f.properties.name===name)) addCatalog({type:'Feature',geometry:feature.geometry,properties:{name}});
  }
  const normalize=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().trim();
  function indexFeature(feature) {
    return { feature, key: normalize(
      `${feature.properties.name || feature.properties['@name']} ${feature.properties.aliases || ''}`,
    ) };
  }
  function addCatalog(feature) {
    catalog.push(feature);
    catalogIndex.push(indexFeature(feature));
  }
  let searchTimer;
  function find() {
    const query=normalize(search.value); results.replaceChildren(); results.hidden=!query;
    if (!query) return [];
    const visible = map.getLayer('place-names') ? map.queryRenderedFeatures({layers:['place-names']}).filter(f=>f.geometry.type==='Point').map(f=>({...f,properties:{...f.properties,name:f.properties['@name']}})) : [];
    const matches = [
      ...community.features().filter(feature => normalize(`${feature.properties.name} ${feature.properties.aliases}`).includes(query)),
      ...catalogIndex.filter(item => item.key.includes(query)).map(item => item.feature),
      ...visible.filter(feature => normalize(feature.properties.name || '').includes(query)),
    ].sort((a, b) => Number(normalize(b.properties.name).startsWith(query)) - Number(normalize(a.properties.name).startsWith(query)) || (b.properties.population || 0) - (a.properties.population || 0));
    const unique=[...new Map(matches.map(f=>[f.properties.name,f])).values()].slice(0,8);
    for(const f of unique) {const button=document.createElement('button');button.type='button';button.textContent=f.properties.name;button.addEventListener('click',()=>select(f));results.append(button);}
    if(!unique.length) results.textContent='No matching city or destination. Zoom in to search visible places.';
    return unique;
  }
  search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(find,120);});
  search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}});
  $('#search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimer);const matches=find();if(matches.length)select(matches[0]);});
  for(const button of document.querySelectorAll('[data-category]')) button.addEventListener('click',()=>{
    category=button.dataset.category;
    for(const item of document.querySelectorAll('[data-category]'))item.setAttribute('aria-pressed',String(item===button));
    apply();
  });
  for(const input of document.querySelectorAll('[data-layer]'))input.addEventListener('change',()=>{input.checked?hidden.delete(input.dataset.layer):hidden.add(input.dataset.layer);apply();});
  function openPanel(name) {
    for(const panel of ['layers','directions']) {
      const open=panel===name;
      $(`#${panel}-panel`).hidden=!open;
      $(`#${panel}-toggle`).setAttribute('aria-expanded',String(open));
      if(open){$('#contribution-panel').hidden=true;$('#community-toggle').setAttribute('aria-expanded','false');}
    }
  }
  for(const name of ['layers','directions']) $(`#${name}-toggle`).addEventListener('click',()=>openPanel($(`#${name}-panel`).hidden?name:null));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){openPanel(null);results.hidden=true;popup?.remove();}});
  function addDestinations() {
    if(!overview || map.getSource('destinations'))return;
    map.addSource('destinations',{type:'geojson',data:overview});
    map.addLayer({id:'destination-names',type:'symbol',source:'destinations',minzoom:5,maxzoom:14,
      filter:destinationFilter,layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],5,11,9,14,13,16],
      'text-max-width':9,'text-padding':7,'text-optional':false,'text-allow-overlap':false,
      'symbol-sort-key':['-',0,['case',['==',['get','category'],'park'],50000,['get','population']]], 'text-anchor':'center'},
      paint:{'text-color':['case',['==',['get','category'],'park'],document.documentElement.dataset.theme==='dark'?'#a7c5a2':'#48744f',document.documentElement.dataset.theme==='dark'?'#e1e7e2':'#3b514b'],
      'text-halo-color':document.documentElement.dataset.theme==='dark'?'#263830':'#f6f8ef','text-halo-width':1.8}});
    apply();
  }
  map.on('style.load',addDestinations);
  map.on('click',event=>{
    if (!$('#contribution-panel').hidden) return;
    const layers=['community-points','community-polygons','community-lines','place-names','destination-names'].filter(id=>map.getLayer(id));
    results.hidden=true;
    const hit=map.queryRenderedFeatures(event.point,{layers})[0];if(hit) {
      const published=community.features().find(f=>f.properties.id===hit.properties.id);
      select(published || hit);
    }
  });
  for (const feature of community.features().filter(f=>f.geometry.type==='Point')) {
    addCatalog(feature); const option=document.createElement('option');option.value=feature.properties.name;$('#destinations').append(option);
  }
  const destinationUrl = new URL('./assets/data/destinations.geojson',siteRoot);
  destinationUrl.search = new URL(import.meta.url).search;
  fetch(destinationUrl).then(async r=>{
    if(!r.ok)throw Error('Destinations unavailable');
    const text=await r.text();
    const parseStarted=performance.now();
    const data=JSON.parse(text);
    const parseMs=performance.now()-parseStarted;
    const indexStarted=performance.now();
    overview=data; catalog=[...data.features,...community.features().filter(f=>f.geometry.type==='Point')]; catalogIndex=catalog.map(indexFeature);
    if (globalThis.__mazoMapTimings) {
      globalThis.__mazoMapTimings.destinationParseMs=Math.round(parseMs*100)/100;
      globalThis.__mazoMapTimings.destinationIndexMs=Math.round((performance.now()-indexStarted)*100)/100;
    }
    const list=$('#destinations');
    list.replaceChildren();
    for(const f of catalog){const option=document.createElement('option');option.value=f.properties.name;list.append(option);}
    addDestinations();
  }).catch(()=>{search.placeholder='Search visible places';$('#route-status').textContent='City index unavailable. Select places on the map for directions.';});
}
