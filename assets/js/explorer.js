// Native vector labels and bounded DOM controls; never one DOM marker per place.
export function setupExplorer(map, maplibre, siteRoot) {
  const $ = selector => document.querySelector(selector);
  const search = $('#map-search');
  const results = $('#search-results');
  let catalog = [], overview, popup, category = 'all';
  const hidden = new Set();
  const placeFilter = map.getFilter('place-names');
  const groups = {
    roads: ['road-casing', 'road-lines', 'road-names', 'highway-names', 'rail-lines'],
    buildings: ['building-fills', 'building-parts', 'building-outlines'],
    places: ['place-names'], landmarks: ['destination-names'],
  };
  function apply() {
    if (!map.getLayer('place-names')) return;
    map.setFilter('place-names', category === 'all' ? placeFilter : ['all', placeFilter,
      ['==', map.getLayoutProperty('place-names', 'icon-image'), `mazo-poi-${category}`]]);
    if (map.getLayer('destination-names')) map.setFilter('destination-names', category === 'all' ? ['has','name'] : ['==', ['get','category'], category]);
    for (const [group,layers] of Object.entries(groups)) for (const id of layers)
      if (map.getLayer(id)) map.setLayoutProperty(id,'visibility',hidden.has(group)?'none':'visible');
  }
  function select(feature) {
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
    popup=new maplibre.Popup({offset:12}).setLngLat(coordinates).setDOMContent(content).addTo(map);
    // Include selected real POIs in the directions handoff, without inventing coordinates.
    if (!catalog.some(f=>f.properties.name===name)) catalog.push({type:'Feature',geometry:feature.geometry,properties:{name}});
  }
  const normalize=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().trim();
  function find() {
    const query=normalize(search.value); results.replaceChildren(); results.hidden=!query;
    if (!query) return [];
    const visible = map.getLayer('place-names') ? map.queryRenderedFeatures({layers:['place-names']}).filter(f=>f.geometry.type==='Point').map(f=>({...f,properties:{...f.properties,name:f.properties['@name']}})) : [];
    const matches=[...catalog,...visible].filter(f=>normalize(f.properties.name+' '+(f.properties.aliases||'')).includes(query))
      .sort((a,b)=>Number(normalize(b.properties.name).startsWith(query))-Number(normalize(a.properties.name).startsWith(query)) || (b.properties.population||0)-(a.properties.population||0));
    const unique=[...new Map(matches.map(f=>[f.properties.name,f])).values()].slice(0,8);
    for(const f of unique) {const button=document.createElement('button');button.type='button';button.textContent=f.properties.name;button.addEventListener('click',()=>select(f));results.append(button);}
    if(!unique.length) results.textContent='No matching city or destination. Zoom in to search visible places.';
    return unique;
  }
  search.addEventListener('input',find);
  search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}});
  $('#search-form').addEventListener('submit',event=>{event.preventDefault();const matches=find();if(matches.length)select(matches[0]);});
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
    }
  }
  for(const name of ['layers','directions']) $(`#${name}-toggle`).addEventListener('click',()=>openPanel($(`#${name}-panel`).hidden?name:null));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){openPanel(null);results.hidden=true;popup?.remove();}});
  $('#directions-form').addEventListener('submit',event=>{
    event.preventDefault();
    const from=catalog.find(f=>normalize(f.properties.name)===normalize($('#route-from').value));
    const to=catalog.find(f=>normalize(f.properties.name)===normalize($('#route-to').value));
    const link=$('#route-link'); link.hidden=true;
    if(!from||!to) {$('#route-status').textContent='Choose two known cities or destinations from the suggestions.';return;}
    const route=[from,to].map(f=>[f.geometry.coordinates[1],f.geometry.coordinates[0]].join(',')).join(';');
    link.href=`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`;
    link.hidden=false; $('#route-status').textContent='Your route is ready to open on OpenStreetMap.';
    link.focus();
  });
  function addDestinations() {
    if(!catalog.length || map.getSource('destinations'))return;
    map.addSource('destinations',{type:'geojson',data:overview});
    map.addLayer({id:'destination-names',type:'symbol',source:'destinations',minzoom:5,maxzoom:14,
      layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],5,11,9,14,13,16],
      'text-max-width':9,'text-padding':7,'text-optional':false,'text-allow-overlap':false,
      'symbol-sort-key':['-',0,['get','population']], 'text-anchor':'center'},
      paint:{'text-color':['case',['==',['get','category'],'park'],document.documentElement.dataset.theme==='dark'?'#a7c5a2':'#48744f',document.documentElement.dataset.theme==='dark'?'#e1e7e2':'#3b514b'],
      'text-halo-color':document.documentElement.dataset.theme==='dark'?'#263830':'#f6f8ef','text-halo-width':1.8,
      'text-opacity':['step',['zoom'],0,5,['case',['<=',['get','minzoom'],5],1,0],6,['case',['<=',['get','minzoom'],6],1,0],7,1]}});
    apply();
  }
  map.on('style.load',addDestinations);
  map.on('click',event=>{
    const layers=['place-names','destination-names'].filter(id=>map.getLayer(id));
    const hit=map.queryRenderedFeatures(event.point,{layers}).find(f=>f.geometry.type==='Point');if(hit)select(hit);
  });
  fetch(new URL('./assets/data/destinations.geojson',siteRoot)).then(r=>{if(!r.ok)throw Error('Destinations unavailable');return r.json();}).then(data=>{
    overview=data; catalog=[...data.features];
    const list=$('#destinations');
    for(const f of catalog){const option=document.createElement('option');option.value=f.properties.name;list.append(option);}
    addDestinations();
  }).catch(()=>{search.placeholder='Search visible places';$('#route-status').textContent='City index unavailable. Select places on the map for directions.';});
}
