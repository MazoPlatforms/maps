// Dependency-free local preview with PMTiles byte ranges and repository subpaths.
import { createServer } from 'node:http';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const root = await realpath(resolve(process.argv[2] || '')),
  port = Number(process.argv[3] || 8000),
  base = '/maps/';
if (!process.argv[2] || !Number.isInteger(port))
  throw new Error('Usage: node scripts/serve-site.mjs /path/to/site [port]');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf',
};
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    );
    if (path === '/') {
      res.writeHead(302, { Location: base + '?dataset=canonical' });
      res.end();
      return;
    }
    if (!path.startsWith(base)) throw new Error('outside preview');
    const filename = resolve(
      root,
      path.slice(base.length) + (path.endsWith('/') ? 'index.html' : ''),
    );
    const canonical = await realpath(filename);
    if (!canonical.startsWith(root + sep)) throw new Error('outside preview');
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error('not a file');
    res.setHeader(
      'Content-Type',
      types[extname(filename)] || 'application/octet-stream',
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let start = 0,
      end = info.size - 1;
    const header = req.headers.range;
    if (header) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(header);
      if (!m) {
        res.writeHead(416);
        res.end();
        return;
      }
      start = Number(m[1]);
      end = Math.min(m[2] ? Number(m[2]) : end, end);
      if (start > end) {
        res.writeHead(416);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') res.end();
    else createReadStream(canonical, { start, end }).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(port, '127.0.0.1', () =>
  console.log(
    `Canonical preview: http://127.0.0.1:${port}${base}?dataset=canonical`,
  ),
);
