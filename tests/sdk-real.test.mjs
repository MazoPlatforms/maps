import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MazoMaps } from '../sdk/index.js';
import { Router } from '../assets/js/router.js';
const root = process.env.MAZO_API_BUILD;
test(
  'real static API, multilingual search, geocoding, nearby, feature lookup, and routing under /maps/',
  { skip: !root },
  async () => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/maps/')) throw new Error();
        const file = resolve(root, '.' + url.pathname.slice(5));
        if (!file.startsWith(resolve(root) + '/')) throw new Error();
        res.setHeader('Content-Type', 'application/json');
        res.end(await readFile(file));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const sdk = new MazoMaps({
        baseURL: `http://127.0.0.1:${server.address().port}/maps/api/v1/`,
      });
      const start = performance.now();
      const m = await sdk.initialize();
      const init = performance.now() - start;
      const searchTimes = [];
      const languages = { en: 0, ta: 0, si: 0 };
      for (const lang of Object.keys(languages)) {
        const regex =
          lang === 'ta'
            ? /[\u0b80-\u0bff]/
            : lang === 'si'
              ? /[\u0d80-\u0dff]/
              : /[A-Za-z]/;
        let example;
        for (const entry of Object.values(m.search)) {
          const rows = await sdk.resource(entry);
          example = rows.flatMap((r) => r.names).find((n) => regex.test(n));
          if (example) break;
        }
        if (!example) {
          console.log('COVERAGE BLOCKED: no real ' + lang + ' name in sample');
          continue;
        }
        const t = performance.now();
        const results = await sdk.search(example, { limit: 10 });
        searchTimes.push(performance.now() - t);
        assert.ok(results.length, example);
        languages[lang] = results.length;
        assert.ok((await sdk.autocomplete(example.slice(0, 2))).length);
        assert.ok((await sdk.geocode(example)).length);
        const record = await sdk.getFeature(results[0].id);
        assert.equal(record.schemaVersion, 2);
        const reverse = await sdk.reverseGeocode(results[0].position, {
          radius: 5000,
        });
        assert.equal(reverse.address, null);
      }
      assert.ok(languages.en);
      assert.ok(languages.ta);
      assert.ok(languages.si);
      assert.equal((await sdk.getRegion('colombo-sample')).complete, false);
      assert.equal((await sdk.getRegion('LK1')).level, 'province');
      assert.equal((await sdk.getRegion('LK11')).level, 'district');
      assert.equal((await sdk.getRegion('LK1103')).level, 'dsDivision');
      await assert.rejects(
        sdk.getRegion('not-published'),
        (e) => e.code === 'NOT_FOUND',
      );
      const graph = await sdk.resource(m.routing),
        router = new Router(graph);
      const outgoing = new Map();
      for (const edge of graph.edges) {
        if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
        outgoing.get(edge.from).push(edge.to);
      }
      const edge = graph.edges.find((e) => e.from !== e.to);
      let target = edge.to;
      const seen = new Set([edge.from]);
      let frontier = [[edge.from, 0]];
      while (frontier.length) {
        const [node, depth] = frontier.shift();
        target = node;
        if (depth >= 10) break;
        for (const next of outgoing.get(node) || [])
          if (!seen.has(next)) {
            seen.add(next);
            frontier.push([next, depth + 1]);
          }
      }
      const routeStart = performance.now();
      const route = router.route(graph.nodes[edge.from], graph.nodes[target], {
        maxSnapDistance: 1,
      });
      const routeMs = performance.now() - routeStart;
      assert.ok(route.distance > 0);
      assert.ok(route.roads.length);
      console.log(
        JSON.stringify({
          realRecords: m.records,
          initializationMs: init,
          searchMs: searchTimes,
          languages,
          cacheBytes: sdk.cachedBytes,
          routingNodes: Object.keys(graph.nodes).length,
          routingEdges: graph.edges.length,
          routeMeters: route.distance,
          routeSegments: route.roads.length,
          routeMs,
        }),
      );
    } finally {
      await new Promise((r) => server.close(r));
    }
  },
);
