// Resumable whole-file downloads, never binary-delta PMTiles updates.
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export class OfflineManager {
  constructor(root) {
    this.root = new URL(root, location.href);
    this.prefix = 'mazo-offline:' + this.root.pathname;
  }
  async register() {
    if (!('serviceWorker' in navigator))
      throw new Error('Service workers unavailable');
    await navigator.serviceWorker.register(
      new URL('service-worker.js', this.root),
      { scope: this.root.pathname },
    );
    return navigator.serviceWorker.ready;
  }
  async inventory() {
    const r = await fetch(new URL('offline-manifest.json', this.root), {
      cache: 'no-cache',
      headers: { 'X-Mazo-Download': '1' },
    });
    if (!r.ok) throw new Error('Offline release unavailable');
    const m = await r.json();
    if (m.schemaVersion !== 1 || !m.files?.length)
      throw new Error('Invalid offline inventory');
    return m;
  }
  async installed() {
    const cache = await caches.open(this.prefix + ':state');
    const r = await cache.match(new URL('offline-active.json', this.root));
    return r ? await r.json() : null;
  }
  async download({ signal, region, onProgress = () => {} } = {}) {
    await this.register();
    const manifest = await this.inventory();
    if (region && !(manifest.regions || []).some((r) => r.id === region))
      throw new Error('Offline region unavailable');
    const total = manifest.files.reduce((sum, e) => sum + e.bytes, 0);
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.quota - estimate.usage < total * 1.15)
      throw new Error('Not enough browser storage for this region');
    const cacheName = this.prefix + ':release:' + manifest.version,
      cache = await caches.open(cacheName);
    let done = 0;
    for (const file of manifest.files) {
      if (signal?.aborted)
        throw new DOMException(
          'Download interrupted; retry to resume',
          'AbortError',
        );
      const url = new URL(file.file, this.root);
      if (
        url.origin !== this.root.origin ||
        !url.pathname.startsWith(this.root.pathname) ||
        file.file.includes('..')
      )
        throw new Error('Unsafe offline asset path');
      let cached = await cache.match(url);
      let valid = false;
      if (!cached) {
        for (const name of await caches.keys())
          if (
            name !== cacheName &&
            name.startsWith(this.prefix + ':release:')
          ) {
            const old = await (await caches.open(name)).match(url);
            if (old?.headers.get('X-Mazo-SHA256') === file.sha256) {
              cached = old;
              break;
            }
          }
      }
      if (cached) {
        const bytes = await cached.arrayBuffer();
        valid =
          bytes.byteLength === file.bytes &&
          (await sha256(bytes)) === file.sha256;
        if (!valid) await cache.delete(url);
        else
          await cache.put(
            url,
            new Response(bytes, { headers: cached.headers }),
          );
      }
      if (!valid) {
        const r = await fetch(url, {
          signal,
          cache: 'no-cache',
          headers: { 'X-Mazo-Download': '1' },
        });
        if (!r.ok) throw new Error('Offline asset unavailable: ' + file.file);
        const bytes = await r.arrayBuffer();
        if (
          bytes.byteLength !== file.bytes ||
          (await sha256(bytes)) !== file.sha256
        )
          throw new Error('Offline checksum mismatch: ' + file.file);
        await cache.put(
          url,
          new Response(bytes, {
            headers: {
              'Content-Type':
                r.headers.get('Content-Type') || 'application/octet-stream',
              'X-Mazo-SHA256': file.sha256,
            },
          }),
        );
      }
      done += file.bytes;
      onProgress({ done, total, file: file.file });
    }
    const state = {
      version: manifest.version,
      datasetVersion: manifest.datasetVersion,
      cacheName,
      coverage: manifest.coverage,
      mode: manifest.mode,
    };
    await (
      await caches.open(this.prefix + ':state')
    ).put(
      new URL('offline-active.json', this.root),
      new Response(JSON.stringify(state), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    return state;
  }
  async remove() {
    for (const key of await caches.keys())
      if (key.startsWith(this.prefix + ':')) await caches.delete(key);
  }
  async hasUpdate() {
    const [current, available] = await Promise.all([
      this.installed(),
      this.inventory(),
    ]);
    return !current || current.version !== available.version;
  }
}
