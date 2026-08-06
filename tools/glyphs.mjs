#!/usr/bin/env node
/**
 * The glyph set this site actually needs -- plan.md Phase 4.1.
 *
 *   node tools/glyphs.mjs
 *
 * Walks the built `out/**\/*.html` (every page this static export ever
 * serves, including anything only a template/metadata call produces -- og
 * descriptions, JSON-LD, attribute text) plus `content/*.json` (the source
 * of truth, read directly so a codepoint that is authored but not currently
 * reachable through any built page -- a draft synopsis, an unused field --
 * is not silently dropped from the font a future page might need it in).
 * Every file is read as raw UTF-8 text and every character in it counts,
 * not just what a naive tag-stripping pass would call "content" -- an
 * over-inclusive set costs a handful of extra glyphs; an under-inclusive one
 * is a missing letter on a live page.
 *
 * HTML/XML numeric and the small set of named entities this codebase's own
 * content is known to use are decoded first, so `&mdash;` counts as em dash
 * (the character the subset actually needs), not six ASCII letters.
 *
 * The derived set is then unioned with an explicit safety margin (never used
 * to REPLACE the derived set -- see the plan's own instruction): all ASCII,
 * the full Greek-and-Coptic block (covers every monotonic tonos/dialytika
 * combination in use), Greek Extended (polytonic -- not currently used by
 * any content here, kept cheap insurance since the whole block is small),
 * and the specific punctuation marks the type stack reaches for that are
 * easy to miss if a codepoint simply hasn't appeared in content YET.
 *
 * Prints the resulting set as a `pyftsubset --unicodes=` argument and writes
 * it to tools/glyphs.txt for 4.2 to read.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  middot: '·', times: '×',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

const used = new Set();
function collect(text) {
  for (const ch of decodeEntities(text)) used.add(ch.codePointAt(0));
}

let fileCount = 0;
for (const f of walk(join(ROOT, 'out'))) {
  if (!f.endsWith('.html')) continue;
  collect(readFileSync(f, 'utf8'));
  fileCount++;
}
for (const name of ['apospasma.json', 'author.json', 'books.json', 'grounds.json', 'press.json']) {
  collect(readFileSync(join(ROOT, 'content', name), 'utf8'));
  fileCount++;
}

const derivedCount = used.size;

/* The margin. Additive only -- see file header. */
const margin = new Set();
for (let cp = 0x20; cp <= 0x7e; cp++) margin.add(cp); // ASCII
for (let cp = 0x0370; cp <= 0x03ff; cp++) margin.add(cp); // Greek and Coptic
for (let cp = 0x1f00; cp <= 0x1fff; cp++) margin.add(cp); // Greek Extended (polytonic)
for (const ch of ['—', '–', '«', '»', '“', '”', '‘', '’', '…', '·']) {
  margin.add(ch.codePointAt(0));
}

const all = new Set([...used, ...margin]);
const sorted = [...all].sort((a, b) => a - b);

/* pyftsubset --unicodes= wants comma-separated hex codepoints or ranges;
   collapse consecutive runs into ranges to keep the argument short. */
const ranges = [];
let start = sorted[0];
let prev = sorted[0];
for (let i = 1; i <= sorted.length; i++) {
  const cp = sorted[i];
  if (cp === prev + 1) {
    prev = cp;
    continue;
  }
  ranges.push(start === prev ? `U+${start.toString(16).toUpperCase()}` : `U+${start.toString(16).toUpperCase()}-${prev.toString(16).toUpperCase()}`);
  start = prev = cp;
}

const arg = ranges.join(',');
writeFileSync(join(ROOT, 'tools/glyphs.txt'), arg + '\n');

console.log(`scanned ${fileCount} files, ${derivedCount} distinct codepoints derived from content`);
console.log(`${all.size} codepoints total after the safety margin, ${ranges.length} ranges`);
console.log(`written to tools/glyphs.txt`);
