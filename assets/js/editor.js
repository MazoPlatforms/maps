import { MazoMaps } from '../../sdk/index.js';
import {
  EditorModel,
  featureTypes,
  vertices,
  replaceVertex,
  changeVertex,
  moveGeometry,
  localizedName,
  withLocalizedNames,
} from './editor-model.js';
import { prepareCanonicalStyle } from './canonical-records.js';

export async function mountEditor(map, siteRoot) {
  const sdk = new MazoMaps({ baseURL: new URL('api/v1/', siteRoot) });
  const manifest = await sdk.initialize();
  const model = new EditorModel(manifest.version);
  const root = document.querySelector('#map-frame');
  const panel = document.createElement('section');
  panel.className = 'editor-panel';
  panel.setAttribute('aria-label', 'Geographic editor');
  panel.innerHTML = `<header><strong>Mazo geographic editor</strong><button data-action="close" aria-label="Close editor">×</button></header>
 <p>Independent Colombo-area sample · incomplete coverage</p>
 <div class="editor-row"><select aria-label="Feature type" id="edit-type">${featureTypes.map((t) => `<option>${t}</option>`).join('')}</select><select id="edit-geometry" aria-label="Drawing geometry"><option>Point</option><option>LineString</option><option>Polygon</option></select><button data-action="draw">Draw</button><button data-action="finish">Finish</button></div>
 <p id="edit-help">Select a feature on the canonical map, or draw a new geometry.</p>
 <label>Permanent Mazo ID<input id="edit-id" placeholder="Paste a Mazo UUID"></label><button data-action="load-feature">Load feature by ID</button><label>Selected feature<select id="edit-selection"><option value="">None</option></select></label>
 <label>English / primary name<input id="edit-en"></label><label>தமிழ்<input id="edit-ta" lang="ta"></label><label>සිංහල<input id="edit-si" lang="si"></label>
 <label>Properties (JSON)<textarea id="edit-properties" rows="4" spellcheck="false"></textarea></label>
 <div class="editor-row"><label>Vertex<input id="edit-vertex" type="number" min="0" value="0"></label><label>Longitude<input id="edit-lon" type="number" step="any"></label><label>Latitude<input id="edit-lat" type="number" step="any"></label></div>
 <div class="editor-row"><button data-action="apply">Apply properties</button><button data-action="vertex">Move vertex</button><button data-action="add-vertex">Add vertex</button><button data-action="remove-vertex">Remove vertex</button><button data-action="move">Move feature here</button><button data-action="delete">Delete</button></div>
 <label>Merge with loaded road<select id="edit-merge-target"><option value="">Choose road</option></select></label><div class="editor-row"><button data-action="split-road">Split at vertex</button><button data-action="merge-road">Merge roads</button></div><div class="editor-row"><button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="save">Save draft</button><button data-action="restore">Restore draft</button><button data-action="discard">Discard all</button><button data-action="compare" aria-pressed="false">Before / after</button></div>
 <label>Your name<input id="edit-author" autocomplete="name"></label><label>Survey/source URL<input id="edit-source" type="url" placeholder="https://…"></label>
 <label>Summary<input id="edit-summary"></label><label><input id="edit-license" type="checkbox"> I own or may contribute my changes under the contributor terms.</label>
 <div class="editor-row"><button data-action="preview">Preview changeset</button><button data-action="submit">Download & submit</button></div>
 <pre id="edit-preview" tabindex="0"></pre><div id="edit-handoff" hidden><a href="https://github.com/MazoPlatforms/maps/fork" target="_blank" rel="noopener noreferrer">1. Fork repository</a><p>2. Include all branches when forking (uncheck “Copy main branch only”). Create your contribution branch from feat/geographic-contributions. 3. Upload the JSON to contributions/ there and open a pull request back to feat/geographic-contributions. Do not base it on main. CI validates the canonical operations; a maintainer reviews and publishes. This page does not create a PR automatically.</p><a href="https://github.com/MazoPlatforms/maps/compare/feat/geographic-contributions..." target="_blank" rel="noopener noreferrer">Open pull request comparison</a></div><output id="edit-status" role="status" aria-live="polite"></output>`;
  root.append(panel);
  const field = (id) => panel.querySelector('#edit-' + id);
  let selected = null,
    mode = 'select',
    points = [],
    before = false,
    active = true,
    marker = null,
    template;
  const { Marker } = await import('../vendor/maplibre-gl.mjs');
  const status = (text) => {
    field('status').textContent = text;
  };
  const entry = () => {
    if (!model.entries[selected])
      throw new Error('Select a canonical feature first');
    return model.entries[selected];
  };
  const theme = () => document.documentElement.dataset.theme;
  async function style(value = theme()) {
    const r = await fetch(
      new URL(
        `data/mazo/${navigator.onLine === false || new URLSearchParams(location.search).has('offline') ? 'offline-' : ''}${value}.json`,
        siteRoot,
      ),
    );
    if (!r.ok) throw new Error('Canonical map has not been built');
    template = prepareCanonicalStyle(
      await r.json(),
      new URL('data/mazo/', siteRoot),
    );
    if (template.glyphs)
      template.glyphs = template.glyphs.replace(
        '__MAZO_SITE_ROOT__',
        siteRoot.replace(/\/$/, ''),
      );
    return template;
  }
  function refresh() {
    if (!active || !map.getStyle()?.sources?.mazo) return;
    if (!map.getSource('editor-drafts')) {
      map.addSource('editor-drafts', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      for (const [type, geometry, paint] of [
        ['fill', 'Polygon', { 'fill-color': '#ecb457', 'fill-opacity': 0.5 }],
        ['line', 'LineString', { 'line-color': '#c55c2c', 'line-width': 4 }],
        ['circle', 'Point', { 'circle-color': '#c55c2c', 'circle-radius': 7 }],
      ])
        map.addLayer({
          id: 'editor-' + type,
          type,
          source: 'editor-drafts',
          filter: ['==', ['geometry-type'], geometry],
          paint,
        });
      map.addSource('editor-drawing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'editor-drawing',
        type: 'line',
        source: 'editor-drawing',
        paint: { 'line-color': '#c55c2c', 'line-width': 3 },
      });
    }
    const dirty = Object.entries(model.entries).filter(([, e]) => e.dirty),
      ids = before ? [] : dirty.map(([id]) => id);
    for (const layer of template?.layers || [])
      if (layer.source === 'mazo' && map.getLayer(layer.id)) {
        const filter = ['!', ['in', ['get', 'id'], ['literal', ids]]];
        map.setFilter(
          layer.id,
          layer.filter ? ['all', layer.filter, filter] : filter,
        );
      }
    map.getSource('editor-drafts').setData({
      type: 'FeatureCollection',
      features: before
        ? []
        : dirty
            .filter(([, e]) => e.after.status !== 'removed')
            .map(([id, e]) => ({
              type: 'Feature',
              id,
              geometry: e.after.geometry,
              properties: {
                ...e.after.properties,
                id,
                _mazoType: e.after.featureType,
              },
            })),
    });
    map.getSource('editor-drawing').setData({
      type: 'FeatureCollection',
      features:
        points.length > 1
          ? [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: points },
                properties: {},
              },
            ]
          : [],
    });
    const select = field('selection');
    select.replaceChildren(new Option('None', ''));
    for (const [id, e] of Object.entries(model.entries))
      select.add(
        new Option(
          `${e.dirty ? '* ' : ''}${e.after.featureType} ${id.slice(0, 8)}${e.after.status === 'removed' ? ' (deleted)' : ''}`,
          id,
        ),
      );
    select.value = selected || '';
    const merge = field('merge-target');
    merge.replaceChildren(new Option('Choose road', ''));
    for (const [id, e] of Object.entries(model.entries))
      if (
        id !== selected &&
        e.after.featureType === 'road' &&
        e.after.status !== 'removed'
      )
        merge.add(new Option(id.slice(0, 8), id));
    marker?.remove();
    marker = null;
    const current = model.entries[selected];
    if (current) field('id').value = selected;
    if (!current) return;
    const r = current.after,
      p = r.properties,
      n = p.names || {};
    field('en').value = n.primary || p.name || '';
    for (const lang of ['ta', 'si']) field(lang).value = localizedName(p, lang);
    field('properties').value = JSON.stringify(p, null, 2);
    const vs = vertices(r.geometry),
      index = Math.min(Number(field('vertex').value) || 0, vs.length - 1),
      v = vs[index];
    field('vertex').max = vs.length - 1;
    field('lon').value = v.position[0];
    field('lat').value = v.position[1];
    if (r.status !== 'removed' && !before) {
      marker = new Marker({ draggable: true, color: '#c55c2c' })
        .setLngLat(v.position)
        .addTo(map);
      marker.on('dragend', () => {
        try {
          const p = marker.getLngLat();
          model.update(selected, {
            geometry: replaceVertex(entry().after.geometry, v.path, [
              p.lng,
              p.lat,
            ]),
          });
          refresh();
        } catch (error) {
          status(error.message);
          refresh();
        }
      });
    }
    status(
      `${dirty.length} changed features · ${before ? 'original' : 'edited'} view. Drafts are not published.`,
    );
  }
  function source() {
    const url = field('source').value;
    if (!/^https:\/\//.test(url) || !field('author').value.trim())
      throw new Error(
        'New features require your name and an HTTPS survey/source URL',
      );
    return [
      {
        provider: field('author').value,
        id: crypto.randomUUID(),
        release: new Date().toISOString().slice(0, 10),
        url,
        license: 'CC0-1.0',
      },
    ];
  }
  function finish() {
    const type = field('type').value,
      geometryType = field('geometry').value;
    let coordinates = points;
    if (geometryType === 'Point') coordinates = points[0];
    if (geometryType === 'Polygon') coordinates = [[...points, points[0]]];
    selected = model.create(
      type,
      { type: geometryType, coordinates },
      source(),
    );
    points = [];
    mode = 'select';
    refresh();
  }
  async function click(event) {
    try {
      if (mode === 'draw') {
        points.push([event.lngLat.lng, event.lngLat.lat]);
        if (field('geometry').value === 'Point') finish();
        else refresh();
        return;
      }
      const candidates = map
        .queryRenderedFeatures(event.point)
        .filter((f) => /^[a-f0-9-]{36}$/.test(f.properties?.id || ''));
      const f =
        candidates.find(
          (f) => f.properties._mazoType === field('type').value,
        ) || candidates[0];
      if (!f) return;
      if (!model.entries[f.properties.id])
        model.select(await sdk.getFeatureSnapshot(f.properties.id));
      selected = f.properties.id;
      refresh();
    } catch (error) {
      status(error.message);
    }
  }
  map.on('click', click);
  map.on('style.load', refresh);
  field('selection').onchange = () => {
    selected = field('selection').value;
    refresh();
  };
  field('vertex').onchange = refresh;
  field('type').onchange = () => {
    const t = field('type').value;
    field('geometry').value = ['place', 'connector'].includes(t)
      ? 'Point'
      : t === 'road'
        ? 'LineString'
        : 'Polygon';
  };
  async function action(name) {
    switch (name) {
      case 'close':
        active = false;
        marker?.remove();
        panel.remove();
        map.off('click', click);
        map.off('style.load', refresh);
        return api.onClose?.();
      case 'load-feature': {
        const snapshot = await sdk.getFeatureSnapshot(field('id').value.trim());
        model.select(snapshot);
        selected = snapshot.record.id;
        refresh();
        let c = snapshot.record.geometry.coordinates;
        while (Array.isArray(c[0])) c = c[0];
        map.flyTo({ center: c, zoom: 16, duration: 0 });
        return;
      }
      case 'draw':
        mode = 'draw';
        points = [];
        field('help').textContent =
          'Tap vertices on the map. Choose Finish to complete the geometry.';
        return;
      case 'finish':
        finish();
        return;
      case 'undo':
        model.undo();
        break;
      case 'redo':
        model.redo();
        break;
      case 'discard':
        model.discard();
        selected = null;
        break;
      case 'save':
        localStorage.setItem('mazo-editor-draft', model.serialize());
        status('Draft saved on this device.');
        return;
      case 'restore':
        model.restore(localStorage.getItem('mazo-editor-draft') || '{}');
        selected = Object.keys(model.entries)[0];
        break;
      case 'compare':
        before = !before;
        panel
          .querySelector('[data-action="compare"]')
          .setAttribute('aria-pressed', String(before));
        break;
      case 'delete':
        model.remove(selected);
        break;
      case 'split-road':
        model.splitRoad(selected, Number(field('vertex').value));
        break;
      case 'merge-road':
        model.mergeRoads(selected, field('merge-target').value);
        break;
      case 'apply': {
        const p = withLocalizedNames(JSON.parse(field('properties').value), {
          en: field('en').value,
          ta: field('ta').value,
          si: field('si').value,
        });
        model.update(selected, { properties: p });
        break;
      }
      case 'vertex':
      case 'add-vertex':
      case 'remove-vertex': {
        const g = entry().after.geometry,
          v = vertices(g)[Number(field('vertex').value) || 0];
        model.update(selected, {
          geometry:
            name === 'vertex'
              ? replaceVertex(g, v.path, [
                  Number(field('lon').value),
                  Number(field('lat').value),
                ])
              : changeVertex(g, v.path, name === 'remove-vertex'),
        });
        break;
      }
      case 'move': {
        const g = entry().after.geometry,
          p = vertices(g)[0].position;
        model.update(selected, {
          geometry: moveGeometry(g, [
            Number(field('lon').value) - p[0],
            Number(field('lat').value) - p[1],
          ]),
        });
        break;
      }
      case 'preview':
      case 'submit': {
        if (!field('license').checked)
          throw new Error('Review and accept the contributor terms first');
        const cs = model.changeset(
          field('summary').value,
          field('author').value,
        );
        field('preview').textContent = JSON.stringify(cs, null, 2);
        if (name === 'submit') {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(cs, null, 2) + '\n'], {
              type: 'application/json',
            }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = cs.id + '.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          field('handoff').hidden = false;
        }
        status(
          'Browser validation passed. CI performs authoritative geometry, classification, provenance and conflict validation.',
        );
        return;
      }
    }
    refresh();
  }
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button)
      Promise.resolve(action(button.dataset.action)).catch((error) =>
        status(error.message),
      );
  });
  const api = {
    model,
    sdk,
    get active() {
      return active;
    },
    style,
    onClose: null,
  };
  map.once('idle', () => {
    document.querySelector('#map-status')?.classList.add('is-hidden');
    root.dataset.state = 'ready';
    document.querySelector('#map')?.setAttribute('aria-busy', 'false');
  });
  map.setStyle(await style());
  map.flyTo({ center: [79.84533, 6.92114], zoom: 14, duration: 0 });
  if (new URLSearchParams(location.search).has('maptest'))
    globalThis.__mazoEditor = { model, sdk, refresh, panel, action };
  return api;
}
