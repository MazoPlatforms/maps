import { RECORD_TYPES, validateRecord, validateTransition, recordHash, recordPath, recordLabel, parseRecordJson, stableJson } from './record-model.js';
const $=selector=>document.querySelector(selector);
export function proposalUrl(record) {
  const url=new URL(record.revision===1 ? 'https://github.com/MazoPlatforms/maps/new/main' : `https://github.com/MazoPlatforms/maps/edit/main/${recordPath(record)}`);
  if(record.revision===1){url.searchParams.set('filename',recordPath(record));url.searchParams.set('value',JSON.stringify(record,null,2)+'\n');}
  return url.href;
}
export function setupRecordEditor(map, community) {
  const panel=$('#contribution-panel'),form=$('#record-form'),status=$('#record-editor-status');
  let original=null, id=crypto.randomUUID(),vertices=[],drawing=false,downloadUrl,preview=null;
  function drawPreview(geometry) {
    preview=geometry;
    if(!map.getSource('community-draft'))map.addSource('community-draft',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    for(const layer of [
      {id:'community-draft-area',type:'fill',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#f59e0b','fill-opacity':0.25}},
      {id:'community-draft-line',type:'line',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':'#d97706','line-width':4,'line-dasharray':[2,2]}},
      {id:'community-draft-point',type:'circle',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#d97706','circle-radius':8,'circle-stroke-color':'#ffffff','circle-stroke-width':2}},
    ])if(!map.getLayer(layer.id))map.addLayer({...layer,source:'community-draft'});
    map.getSource('community-draft').setData({type:'FeatureCollection',features:geometry?[{type:'Feature',properties:{draft:true},geometry}]:[]});
  }
  map.on('style.load',()=>drawPreview(panel.hidden?null:preview));
  const output=$('#record-output');
  function message(text) { status.textContent=text; }
  function invalidate() { output.hidden=true;$('#record-consent').checked=false; }
  function stopDrawing() { drawing=false;vertices=[];$('#record-draw').setAttribute('aria-pressed','false');map.getCanvas().style.cursor=''; }
  function reset() {
    drawPreview(null);$('#record-current-details').hidden=true;$('#record-current').textContent='';
    form.reset();original=null;id=crypto.randomUUID();stopDrawing();invalidate();$('#record-select').value='';$('#record-delete').disabled=true;$('#record-restore').disabled=true;
    $('#record-geometry').value=JSON.stringify({type:'Point',coordinates:[Number(map.getCenter().lng.toFixed(7)),Number(map.getCenter().lat.toFixed(7))]},null,2);
    $('#record-date').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'});
    $('#record-before').textContent='New feature';message('Draft only. Nothing is published until an admin reviews and merges your pull request.');
  }
  function fill(record) {
    reset();original=structuredClone(record);id=record.id;$('#record-select').value=id;
    $('#record-type').value=record.featureType;$('#record-name').value=record.properties.names.primary;
    for(const lang of ['en','ta','si'])$(`#record-name-${lang}`).value=record.properties.names[lang] || '';
    for(const key of ['category','address','website','phone','description'])$(`#record-${key}`).value=record.properties[key] || '';
    $('#record-geometry').value=JSON.stringify(record.geometry,null,2);$('#record-before').textContent=JSON.stringify(record,null,2);$('#record-current').textContent=JSON.stringify(record,null,2);$('#record-current-details').hidden=false;drawPreview(record.geometry);
    $('#record-delete').disabled=record.status==='deleted';$('#record-restore').disabled=record.status!=='deleted';
    message(`Editing revision ${record.revision}. Existing provenance is retained; add evidence for your change.`);
  }
  function refresh() {
    const select=$('#record-select');const selected=select.value;select.replaceChildren(new Option('New record',''));
    for(const record of community.records)select.append(new Option(`${recordLabel(record)}${record.status==='deleted'?' (deleted)':''}`,record.id));
    select.value=selected;$('#record-count').textContent=String(community.records.length);
  }
  function open() {panel.hidden=false;$('#community-toggle').setAttribute('aria-expanded','true');$('#layers-panel').hidden=true;$('#directions-panel').hidden=true;$('#layers-toggle').setAttribute('aria-expanded','false');$('#directions-toggle').setAttribute('aria-expanded','false');refresh();document.dispatchEvent(new Event('mazo:community-open'));$('#record-name').focus();}
  $('#community-toggle').addEventListener('click',()=>{if(panel.hidden)open();else close();});
  function close(){panel.hidden=true;drawPreview(null);stopDrawing();$('#community-toggle').setAttribute('aria-expanded','false');}
  $('#contribution-close').addEventListener('click',close);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  $('#layers-toggle').addEventListener('click',close);$('#directions-toggle').addEventListener('click',close);
  $('#record-select').addEventListener('change',()=>{const record=community.resolve($('#record-select').value);record?fill(record):reset();});
  $('#record-new').addEventListener('click',reset);
  form.addEventListener('input',event=>{if(event.target.id==='record-consent')output.hidden=true;else invalidate();});
  $('#record-type').addEventListener('change',()=>{stopDrawing();$('#record-geometry').value='';message(`Provide ${RECORD_TYPES[$('#record-type').value]} geometry, or draw on the map.`);});
  $('#record-center').addEventListener('click',()=>{invalidate();const c=map.getCenter();if(RECORD_TYPES[$('#record-type').value]!=='Point'){message('Use Draw to add road/polygon vertices.');return;}$('#record-geometry').value=JSON.stringify({type:'Point',coordinates:[Number(c.lng.toFixed(7)),Number(c.lat.toFixed(7))]},null,2);});
  $('#record-draw').addEventListener('click',()=>{invalidate();if(drawing){stopDrawing();return;}drawing=true;vertices=[];$('#record-draw').setAttribute('aria-pressed','true');map.getCanvas().style.cursor='crosshair';message('Click the map for a point or vertices. Use Finish drawing for a line/polygon.');});
  map.on('click',event=>{
    if(!drawing || panel.hidden)return;
    document.dispatchEvent(new Event('mazo:community-map-pick'));
    vertices.push([Number(event.lngLat.lng.toFixed(7)),Number(event.lngLat.lat.toFixed(7))]);
    drawPreview(vertices.length===1?{type:'Point',coordinates:vertices[0]}:{type:'LineString',coordinates:vertices});
    const type=RECORD_TYPES[$('#record-type').value];
    if(type==='Point'){ $('#record-geometry').value=JSON.stringify({type,coordinates:vertices[0]},null,2);stopDrawing();message('Point selected.'); }
    else message(`${vertices.length} vertices selected. Finish drawing when ready.`);
  });
  $('#record-finish').addEventListener('click',()=>{
    const type=RECORD_TYPES[$('#record-type').value];
    if(!drawing || vertices.length<(type==='Polygon'?3:2)){message('Draw at least 3 polygon vertices or 2 line vertices.');return;}
    $('#record-geometry').value=JSON.stringify({type,coordinates:type==='Polygon'?[[...vertices,vertices[0]]]:vertices},null,2);drawPreview(JSON.parse($('#record-geometry').value));stopDrawing();invalidate();message('Geometry captured. Review the coordinates before proposing.');
  });
  async function build(statusValue='active') {
    if(!community.available)throw Error('Published community records must load before creating a proposal');
    if(!$('#record-consent').checked)throw Error('Confirm you have permission to publish the supplied data under its stated license');
    if(original && original.featureType!==$('#record-type').value)throw Error('Existing feature type cannot change');
    const names={primary:$('#record-name').value.trim()};for(const lang of ['en','ta','si']){const name=$(`#record-name-${lang}`).value.trim();if(name)names[lang]=name;}
    const properties={names,category:$('#record-category').value.trim()};
    for(const key of ['address','website','phone','description']){const value=$(`#record-${key}`).value.trim();if(value)properties[key]=value;}
    const source={name:$('#record-source').value.trim(),license:$('#record-license').value,observedAt:$('#record-date').value,attribution:$('#record-attribution').value.trim()};
    if($('#record-source-url').value.trim())source.url=$('#record-source-url').value.trim();
    const record={schemaVersion:1,id,featureType:$('#record-type').value,revision:original?original.revision+1:1,previous:original?await recordHash(original):null,status:statusValue,geometry:parseRecordJson($('#record-geometry').value),properties,sources:original?.sources.some(existing=>stableJson(existing)===stableJson(source)) ? [...original.sources] : [...(original?.sources || []),source],changeNote:$('#record-note').value.trim()};
    validateRecord(record);await validateTransition(original,record);return record;
  }
  async function propose(statusValue='active') {
    output.hidden=true;
    try {
      const record=await build(statusValue);drawPreview(record.geometry);
      if(downloadUrl)URL.revokeObjectURL(downloadUrl);
      downloadUrl=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json'}));
      $('#record-download').href=downloadUrl;$('#record-download').download=`${record.id}.json`;
      $('#record-path').textContent=recordPath(record);$('#record-after').textContent=JSON.stringify(record,null,2);
      const link=proposalUrl(record);$('#record-github').hidden=link.length>7000;$('#record-github').href=link;$('#record-github').textContent=original?'Edit existing JSON on GitHub':'Open GitHub proposal';
      output.hidden=false;message(original?'Download the proposal, open the GitHub edit page, replace the existing JSON and create a branch/pull request.':link.length>7000?'Proposal validated. Download JSON and upload it to the exact path shown, then open a pull request.':'Proposal validated. Open GitHub, choose a new branch, then create a pull request. For edits, replace the existing file with this JSON.');
    }catch(error){message(error.message);}
  }
  form.addEventListener('submit',event=>{event.preventDefault();propose(original?.status || 'active');});
  $('#record-delete').addEventListener('click',()=>propose('deleted'));
  $('#record-restore').addEventListener('click',()=>propose('active'));
  $('#record-save').addEventListener('click',()=>{try{const values=Object.fromEntries(new FormData(form));localStorage.setItem('mazo-record-draft-v1',JSON.stringify({id,base:original?stableJson(original):null,values}));message('Draft saved on this device.');}catch{message('Draft could not be saved.');}});
  $('#record-load').addEventListener('click',()=>{
    try{
      const draft=JSON.parse(localStorage.getItem('mazo-record-draft-v1') || 'null');if(!draft)throw Error('No saved draft');
      const current=community.resolve(draft.id);if(draft.base && (!current || stableJson(current)!==draft.base))throw Error('Saved draft is stale. Load the latest record and reapply your change.');
      current?fill(current):reset();id=draft.id;
      for(const element of form.elements)if(element.name && Object.hasOwn(draft.values,element.name) && element.type!=='checkbox')element.value=draft.values[element.name];
      invalidate();message('Draft restored. Review and confirm the data license again.');
    }catch(error){message(error.message);}
  });
  $('#record-discard').addEventListener('click',()=>{localStorage.removeItem('mazo-record-draft-v1');reset();});
  document.addEventListener('mazo:edit-community',event=>{const record=community.resolve(event.detail);if(record){open();fill(record);}});
  document.addEventListener('mazo:community-ready',refresh);
  reset();refresh();
}
