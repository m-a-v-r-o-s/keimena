#!/usr/bin/env node
/**
 * Precompress the static export -- plan.md Phase 5.3.
 *
 *   node tools/precompress.mjs
 *
 * Walks `out/`, and beside every `.html`, `.css`, `.js`, `.json` and `.txt`
 * file writes a `.br` (Brotli, quality 11) and a `.gz` (gzip, level 9)
 * sibling. A static host that serves a precompressed sibling when the
 * request's `Accept-Encoding` allows it (Netlify, Vercel's static output,
 * nginx with `gzip_static`/`brotli_static`, Cloudflare Pages) then skips
 * compressing the response itself on every request -- and Brotli-11 holds a
 * real edge over whatever a server compresses on the fly at request time,
 * which is almost never running at max quality for latency reasons.
 *
 * Only the text-ish extensions above: the image/font formats already on
 * this site (webp, woff2) are compressed formats in their own right and
 * gain nothing from a second pass, just CPU time spent proving that.
 *
 * `zlib.brotliCompressSync`/`gzipSync` are Node built-ins -- no dependency.
 * Wired as this package's own `postbuild` script, so it runs after every
 * `next build` without a separate step to remember.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'out');
const EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.txt']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let count = 0;
let rawTotal = 0;
let brTotal = 0;
let gzTotal = 0;

for (const file of walk(OUT_DIR)) {
  if (!EXTENSIONS.has(extname(file))) continue;
  const buf = readFileSync(file);
  const br = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  const gz = zlib.gzipSync(buf, { level: 9 });
  writeFileSync(`${file}.br`, br);
  writeFileSync(`${file}.gz`, gz);
  count++;
  rawTotal += buf.length;
  brTotal += br.length;
  gzTotal += gz.length;
}

const fmt = (n) => `${(n / 1024).toFixed(1)}K`;
console.log(`precompressed ${count} files`);
console.log(`  raw    ${fmt(rawTotal)}`);
console.log(`  brotli ${fmt(brTotal)}  (${(100 * (1 - brTotal / rawTotal)).toFixed(0)}% smaller)`);
console.log(`  gzip   ${fmt(gzTotal)}  (${(100 * (1 - gzTotal / rawTotal)).toFixed(0)}% smaller)`);
