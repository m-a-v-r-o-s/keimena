/**
 * A static file server for `out/`, the real production export -- not `next
 * dev`. Shared by tools/perf-check.mjs and tools/shots.mjs so both measure
 * the same thing the plan's own gate insists on (see plan.md Phase 0.1: "dev
 * mode SSR places things differently and inflates every JS number").
 *
 * Gzips text assets on the fly (html/css/js/json/txt/svg), the way a real
 * static host does, and skips it for anything already compressed (webp,
 * woff2, png) -- gzipping those wastes CPU for zero benefit and can even grow
 * them. The pre-gzip byte count rides along in `X-Raw-Length` so a caller
 * reading response headers over CDP can recover both the "raw" and the
 * "over the wire" number from one request, matching the two columns
 * plan.md's own measurement table reports.
 *
 * No new dependency: node's own `http` and `zlib` are enough for a file
 * server this narrow (GET only, one directory, and Next's own `trailingSlash:
 * true` routing -- a path either names a file directly or a directory whose
 * `index.html` answers for it).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg']);

function resolvePath(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  let p = join(root, clean);
  if (!p.startsWith(root)) return null; // no path traversal out of `out/`
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p) && existsSync(`${p}.html`)) p = `${p}.html`;
  return existsSync(p) && statSync(p).isFile() ? p : null;
}

/**
 * Starts serving `root` and resolves with `{ server, port, close }` once
 * listening. Tries `startPort` and upward, skipping 3000 outright (never
 * ours to bind, per house rule) -- the same "let the framework's own
 * fallback handle a collision" approach used everywhere else in this repo.
 */
export function startServer(root, startPort = 3001) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port === 3000) port = 3001; // never claim 3000
      const server = createServer((req, res) => {
        const file = resolvePath(root, req.url);
        if (!file) {
          res.writeHead(404).end('Not found');
          return;
        }
        const ext = extname(file);
        const mime = MIME[ext] ?? 'application/octet-stream';
        const raw = statSync(file).size;
        const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');

        if (COMPRESSIBLE.has(ext) && acceptsGzip) {
          const chunks = [];
          createReadStream(file)
            .on('data', (c) => chunks.push(c))
            .on('end', () => {
              const gz = gzipSync(Buffer.concat(chunks), { level: 9 });
              res.writeHead(200, {
                'Content-Type': mime,
                'Content-Encoding': 'gzip',
                'Content-Length': gz.length,
                'X-Raw-Length': raw,
              });
              res.end(gz);
            });
        } else {
          res.writeHead(200, { 'Content-Type': mime, 'Content-Length': raw, 'X-Raw-Length': raw });
          createReadStream(file).pipe(res);
        }
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') tryPort(port + 1);
        else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        resolve({ server, port, close: () => new Promise((r) => server.close(r)) });
      });
    };
    tryPort(startPort);
  });
}
