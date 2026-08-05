#!/usr/bin/env node
// Derive each book's accent from its licensed cover.
//
//   node tools/accents.mjs
//
// Re-run this whenever a cover is added to tools/covers-src/. It rewrites the
// `accent` of every book that has one, then run tools/contrast.py to gate the
// result and tools/covers.mjs to rebuild the textures.
//
// With real covers, a hand-authored accent is a guess about a thing we can now
// just look at: the spine, boards and page block should be the colour the real
// book actually is. Sampled from the cover, then pushed into the range the
// contrast gate requires (OKLCH L >= 38%) at its own hue.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const toLin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const enc = (c) => { c = Math.max(0, Math.min(1, c)); c = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(c * 255); };

function rgbToOklch([r, g, b]) {
  const R_ = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708*R_ + 0.5363325363*G + 0.0514459929*B);
  const m = Math.cbrt(0.2119034982*R_ + 0.6806995451*G + 0.1073969566*B);
  const s = Math.cbrt(0.0883024619*R_ + 0.2817188376*G + 0.6299787005*B);
  const L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
  const A = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s;
  const Bb = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s;
  return [L * 100, Math.hypot(A, Bb), (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360];
}
function oklchToHex(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l_ = L / 100 + 0.3963377774*a + 0.2158037573*b;
  const m_ = L / 100 - 0.1055613458*a - 0.0638541728*b;
  const s_ = L / 100 - 0.0894841775*a - 1.2914855480*b;
  const l = l_**3, m = m_**3, s = s_**3;
  const r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s;
  return '#' + [r, g, bb].map((v) => enc(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* A cover, FULLY DECODED.
 *
 * Not plain `sharp(file)`. Both libjpeg and libwebp can decode straight to a
 * reduced size, and sharp takes that path when a resize follows -- and the two
 * codecs do not reduce alike. Sampling a 523x800 master down to 90x135 through
 * shrink-on-load therefore reads a slightly different image depending on what
 * the master happens to be stored as, which would have quietly moved eight of
 * the seventeen accents the day these sources stopped being JPEG.
 *
 * Decoding to raw first puts the resize back on full-resolution pixels, so the
 * accent is a fact about the cover rather than about its container. Same
 * reasoning, and same fix, as textureImage() in tools/covers.mjs. */
async function coverImage(file) {
  const img = sharp(file);
  const { width, height, channels } = await img.metadata();
  const raw = await img.raw().toBuffer();
  return sharp(raw, { raw: { width, height, channels } });
}

/**
 * The colour a reader would call "the colour of that book".
 *
 * NOT the most common colour. These are photographic covers, and the most
 * common pixel on one is sky, concrete or paper -- averaging or counting gives
 * grey every time, which says nothing about which book it is. What identifies a
 * cover is its most saturated colour that still occupies a real share of it:
 * the crimson field, the green rule, the blue dusk. Neutral covers still land
 * on a neutral, honestly, because nothing more saturated clears the threshold.
 */
async function accentFor(file) {
  const W = 90, H = 135;
  const { data, info } = await (await coverImage(file)).resize(W, H, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const total = W * H;
  const buckets = new Map();

  for (let i = 0; i < data.length; i += info.channels) {
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [L] = rgbToOklch(rgb);
    if (L < 14 || L > 94) continue; // near-black and near-white carry no hue
    const key = (rgb[0] >> 4) + ',' + (rgb[1] >> 4) + ',' + (rgb[2] >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += rgb[0]; e.g += rgb[1]; e.b += rgb[2];
    buckets.set(key, e);
  }

  const MIN_SHARE = 0.012; // a colour has to actually be part of the cover
  let best = null, bestChroma = -1;
  for (const e of buckets.values()) {
    if (e.n / total < MIN_SHARE) continue;
    const rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
    const [, C] = rgbToOklch(rgb);
    if (C > bestChroma) { bestChroma = C; best = rgb; }
  }
  if (!best) return null;

  let [L, C, Hh] = rgbToOklch(best.map(Math.round));
  L = Math.max(38.5, Math.min(62, L)); // gate floor, and never washed out
  C = Math.min(C, 0.17);
  return oklchToHex(L, C, Hh);
}

/**
 * How light the cover actually is, as WCAG relative luminance.
 *
 * The reading ground is derived from this, not just from the accent. A book's
 * accent is a colour we choose; its cover is a photograph we were given, and
 * most of these are far darker than their accent. Sitting a dark cover on a
 * dark ground makes the book disappear -- so the ground has to know how dark
 * the cover is before it decides how dark to be.
 */
async function coverLuma(file) {
  const { data, info } = await (await coverImage(file)).resize(64, 96, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    sum += 0.2126 * toLin(data[i]) + 0.7152 * toLin(data[i + 1]) + 0.0722 * toLin(data[i + 2]);
    n++;
  }
  return Number((sum / n).toFixed(4));
}

const books = JSON.parse(readFileSync(R + 'content/books.json', 'utf8'));
/* Keyed to the file that is actually there, never to an assumed extension.
   covers.mjs accepts jpg/jpeg/png/webp for a licensed cover and this has to
   agree with it, or a cover it happily builds is one this cannot sample. */
const have = new Map(
  readdirSync(R + 'tools/covers-src')
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => [f.replace(/\.[^.]+$/, ''), R + 'tools/covers-src/' + f])
);
const rows = [];

for (const b of books.books) {
  const src = have.get(b.id);
  if (!src) continue;
  const accent = await accentFor(src);
  rows.push([b.id, b.accent, accent]);
  b.accent = accent;
  b.cover_luma = await coverLuma(src);
  b.cover_licensed = true;
}
writeFileSync(R + 'content/books.json', JSON.stringify(books, null, 2) + '\n');
console.log('id'.padEnd(34), 'was'.padEnd(9), 'now');
for (const [id, was, now] of rows) console.log(id.padEnd(34), was.padEnd(9), now);
console.log('\nupdated', rows.length, 'accents from licensed covers');
