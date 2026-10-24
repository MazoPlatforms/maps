import { MazoMaps } from '../../sdk/index.js';
import { Router } from './router.js';
export function mountExplore(map, siteRoot) {
  const sdk = new MazoMaps({ baseURL: new URL('api/v1/', siteRoot) });
  let worker,
    request = 0,
    router;
  const input = document.querySelector('#geographic-search'),
    results = document.querySelector('#search-results');
  if (input)
    input.addEventListener('input', () => {
      if (!worker) {
        worker = new Worker(new URL('./search-worker.js', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = ({ data }) => {
          if (data.id !== request) return;
          results.replaceChildren();
          if (data.error) {
            results.textContent = data.error.message;
            return;
          }
          for (const item of data.results) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.names[0];
            button.onclick = () =>
              map.flyTo({ center: item.position, zoom: 15 });
            results.append(button);
          }
          if (!data.results.length)
            results.textContent =
              'No known match in available sample coverage.';
        };
      }
      results.textContent = 'Searching available sample…';
      worker.postMessage({
        id: ++request,
        query: input.value,
        options: { limit: 8 },
      });
    });
  const output = document.querySelector('#route-result');
  document
    .querySelector('#route-submit')
    ?.addEventListener('click', async () => {
      try {
        output.textContent = 'Finding a connected route…';
        if (!router) {
          const m = await sdk.ready();
          router = new Router(await sdk.resource(m.routing));
        }
        const parse = (id) => {
          const p = document
            .querySelector('#' + id)
            .value.split(',')
            .map(Number);
          if (p.length !== 2 || !p.every(Number.isFinite))
            throw new Error('Enter longitude,latitude');
          return p;
        };
        const result = router.route(
          parse('route-origin'),
          parse('route-destination'),
        );
        if (!map.getSource('mazo-route')) {
          map.addSource('mazo-route', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'mazo-route',
            type: 'line',
            source: 'mazo-route',
            paint: { 'line-color': '#c55c2c', 'line-width': 5 },
          });
        }
        map
          .getSource('mazo-route')
          .setData({
            type: 'Feature',
            geometry: result.geometry,
            properties: {},
          });
        map.flyTo({ center: result.snappedOrigin.position, zoom: 15 });
        output.textContent = `${Math.round(result.distance)} m · estimated ${Math.ceil(result.estimatedSeconds / 60)} min. Incomplete sample network; not navigation guidance.`;
      } catch (error) {
        output.textContent = error.message;
      }
    });
}
