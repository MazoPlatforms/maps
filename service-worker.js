const root = new URL(self.registration.scope),
  prefix = 'mazo-offline:' + root.pathname;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.headers.get('X-Mazo-Download') === '1') return;
  if (
    event.request.method !== 'GET' ||
    url.origin !== root.origin ||
    !url.pathname.startsWith(root.pathname)
  )
    return;
  event.respondWith(
    (async () => {
      const stateResponse = await (
        await caches.open(prefix + ':state')
      ).match(new URL('offline-active.json', root));
      const state = stateResponse ? await stateResponse.json() : null;
      if (state) {
        const cache = await caches.open(state.cacheName);
        const navigation = event.request.mode === 'navigate';
        const cached = await cache.match(
          navigation
            ? new URL('index.html', root)
            : new URL(url.pathname, root.origin),
        );
        if (cached) {
          // Cache is populated only after checksum verification. A later corrupt cache is
          // rejected rather than used silently, including range requests.
          const bytes = await cached.arrayBuffer();
          const expected = cached.headers.get('X-Mazo-SHA256');
          const actual = [
            ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          ]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          if (!expected || actual !== expected) {
            await cache.delete(url);
            return new Response(
              'Offline cache is corrupt; reconnect and repair region',
              { status: 503 },
            );
          }
          const range = event.request.headers.get('Range');
          if (range) {
            const m = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (!m) return new Response(null, { status: 416 });
            const start = Number(m[1]),
              end = Math.min(
                m[2] ? Number(m[2]) : bytes.byteLength - 1,
                bytes.byteLength - 1,
              );
            if (start > end || start >= bytes.byteLength)
              return new Response(null, { status: 416 });
            return new Response(bytes.slice(start, end + 1), {
              status: 206,
              headers: {
                'Content-Type': cached.headers.get('Content-Type'),
                'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
                'Accept-Ranges': 'bytes',
              },
            });
          }
          return new Response(bytes, { headers: cached.headers });
        }
      }
      return fetch(event.request);
    })(),
  );
});
