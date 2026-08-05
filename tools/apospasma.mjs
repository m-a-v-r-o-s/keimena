#!/usr/bin/env node
// Build one book's "Απόσπασμα από <title>" button asset from a generated
// border and a book-specific font. See plan.md for the full feature spec,
// the approved o-fonos-einai-chrima sample, and what's left to do.
//
//   node tools/apospasma.mjs <book-id>
//
// Reads tools/apospasma-src/<book-id>-border-raw.webp (a Z-Image-Turbo
// render -- white/light linework on a black ground, portrait, generated
// separately since this script has no model access of its own) and
// content/apospasma.json (label/title/font per book), and writes
// public/apospasma/<book-id>.webp.
//
// Two things this deliberately does NOT do, both load-bearing:
//   - No colour is baked in. The output is white artwork with a real alpha
//     channel; the site recolours it live via CSS `mask-image` +
//     `background-color: var(--book-text)`, exactly how .head__imprint
//     recolours public/imprint.webp (D15). Baking a colour would mean
//     regenerating per book per palette change instead of never.
//   - No text is asked of the image model. "Απόσπασμα από <title>" is set
//     as real vector glyph outlines via opentype.js and composited onto the
//     SAME white/alpha layer as the border, the same way tools/covers.mjs
//     sets cover titles -- diffusion-rendered Greek is gibberish (D8).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const opentype = require('opentype.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...parts) => join(ROOT, ...parts);

const MANIFEST_PATH = P('content/apospasma.json');
const SRC_DIR = P('tools/apospasma-src');
// Base is tools/fonts/, not tools/fonts/apospasma/: the manifest's
// font_file is relative to this and points into the apospasma/ subfolder
// for the 10 newly-sourced fonts, or a bare filename for GFS Didot/Literata/
// JetBrains Mono, which already live directly in tools/fonts/ (D1).
const FONT_DIR = P('tools/fonts');
const OUT_DIR = P('public/apospasma');

// The safe interior box measured off the border art directly (see the
// borderSafeBox() comment) -- computed per-image, not hardcoded, because
// each generated border has its own frame thickness.
function borderSafeBox(data, width, height) {
  const THRESH = 40;
  function darkRun(getVal, length) {
    const mid = Math.floor(length / 2);
    let lo = mid, hi = mid;
    while (lo > 0 && getVal(lo - 1) < THRESH) lo--;
    while (hi < length - 1 && getVal(hi + 1) < THRESH) hi++;
    return [lo, hi];
  }
  const midY = Math.floor(height / 2);
  const [x0, x1] = darkRun((x) => data[midY * width + x], width);
  const midX = Math.floor(width / 2);
  const [y0, y1] = darkRun((y) => data[y * width + midX], height);
  return { x0, x1, y0, y1 };
}

/** Luminance -> alpha, RGB replaced with white. Same technique as
 * imprintMark() in tools/covers.mjs (D15): keeps every anti-aliased edge
 * the raw render has, rather than a hard threshold that would chew up the
 * linework at this size. */
async function borderAlpha(path) {
  const { data, info } = await sharp(path).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  const LO = 40, HI = 200;
  for (let i = 0; i < data.length; i++) {
    const a = Math.max(0, Math.min(1, (data[i] - LO) / (HI - LO)));
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return { rgba, data, width: info.width, height: info.height };
}

function measure(font, text, size, tracking = 0) {
  return font.getAdvanceWidth(text, size) + tracking * size * Math.max(text.length - 1, 0);
}
function textPath(font, text, size, x, y, { tracking = 0, anchor = 'start' } = {}) {
  const w = measure(font, text, size, tracking);
  let cx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const paths = [];
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    paths.push(glyph.getPath(cx, y, size).toPathData(2));
    cx += (glyph.advanceWidth / font.unitsPerEm) * size + tracking * size;
  }
  return paths.join(' ');
}
function wrap(font, text, size, maxWidth, tracking = 0) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(font, next, size, tracking) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function diamond(cx, cy, r) {
  return `M ${cx} ${cy - r} L ${cx + r * 0.62} ${cy} L ${cx} ${cy + r} L ${cx - r * 0.62} ${cy} Z`;
}
function hairline(x0, x1, y) {
  return `M ${x0} ${y} L ${x1} ${y}`;
}
/** Rule - diamond - rule. The frame's own corner flourishes get echoed here,
 * not reinvented -- keep this a plain hairline (no diamond, or a much
 * smaller one) for the minimalist borders; see plan.md's design note. */
function rule(paths, cx, y, halfSpan, gap, weight, withDiamond = true) {
  paths.push(`<path d="${hairline(cx - halfSpan, cx - gap, y)}" stroke="#fff" stroke-width="${weight}" fill="none"/>`);
  paths.push(`<path d="${hairline(cx + gap, cx + halfSpan, y)}" stroke="#fff" stroke-width="${weight}" fill="none"/>`);
  if (withDiamond) paths.push(`<path d="${diamond(cx, y, gap * 0.85)}" fill="#fff"/>`);
}

/**
 * Composition, approved on o-fonos-einai-chrima: label small and
 * wide-tracked near the top, title large and dominant lower down (a
 * hierarchy choice -- the title is the one thing this button exists to
 * say, so it carries the weight, not sized up just to fill space), the
 * whole thing book-ended top/mid/bottom by a rule-diamond-rule rhythm that
 * is what actually fills the frame's height, not point size.
 */
function composeSvg(font, w, h, box, label, title, opts = {}) {
  const {
    labelSize = 28,
    labelTracking = 0.24,
    titleStartSize = 76,
    titleMinSize = 40,
    titleMaxLines = 3,
    ornaments = true,
    bottomRule = true,
  } = opts;

  const innerPad = (box.x1 - box.x0) * 0.05;
  const maxWidth = box.x1 - box.x0 - innerPad * 2;
  const cx = (box.x0 + box.x1) / 2;
  const uY0 = box.y0 + (box.y1 - box.y0) * 0.09;
  const uY1 = box.y1 - (box.y1 - box.y0) * 0.09;
  const uH = uY1 - uY0;
  const at = (f) => uY0 + uH * f;

  let titleSize = titleStartSize;
  let titleLines = wrap(font, title, titleSize, maxWidth, 0);
  while (
    (titleLines.length > titleMaxLines || titleLines.some((l) => measure(font, l, titleSize, 0) > maxWidth)) &&
    titleSize > titleMinSize
  ) {
    titleSize -= 2;
    titleLines = wrap(font, title, titleSize, maxWidth, 0);
  }
  const titleLeading = titleSize * 1.22;

  const paths = [];
  rule(paths, cx, at(0.0), maxWidth * 0.3, 11, 2.5, ornaments);
  paths.push(`<path d="${textPath(font, label, labelSize, cx, at(0.135), { tracking: labelTracking, anchor: 'middle' })}" fill="#fff"/>`);
  rule(paths, cx, at(0.235), maxWidth * 0.22, 6.5, 1.5, ornaments);

  const titleZoneY0 = at(0.32);
  const titleZoneY1 = at(0.92);
  const titleBlockH = (titleLines.length - 1) * titleLeading;
  let ty = titleZoneY0 + Math.max(0, (titleZoneY1 - titleZoneY0 - titleBlockH) / 2) + titleSize * 0.36;
  for (const line of titleLines) {
    paths.push(`<path d="${textPath(font, line, titleSize, cx, ty, { anchor: 'middle' })}" fill="#fff"/>`);
    ty += titleLeading;
  }

  if (bottomRule) rule(paths, cx, at(1.0), maxWidth * 0.3, 11, 2.5, ornaments);

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${paths.join('')}</svg>`, titleSize, titleLines };
}

async function build(id) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const entry = manifest.byBook[id];
  if (!entry) throw new Error(`${id}: no entry in content/apospasma.json`);

  const rawPath = join(SRC_DIR, `${id}-border-raw.webp`);
  if (!existsSync(rawPath)) throw new Error(`${id}: missing ${rawPath} -- generate the border art first`);

  const fontPath = join(FONT_DIR, entry.font_file);
  if (!existsSync(fontPath)) throw new Error(`${id}: font file not found: ${fontPath}`);

  const { rgba, data, width, height } = await borderAlpha(rawPath);
  const box = borderSafeBox(data, width, height);
  const font = opentype.loadSync(fontPath);

  const { svg, titleSize, titleLines } = composeSvg(font, width, height, box, entry.label_el, entry.title_el, entry.compose || {});

  const base = sharp(rgba, { raw: { width, height, channels: 4 } });
  const out = await base.composite([{ input: Buffer.from(svg) }]).webp({ lossless: true }).toBuffer();
  writeFileSync(join(OUT_DIR, `${id}.webp`), out);
  console.log(`${id}: wrote public/apospasma/${id}.webp (font ${entry.font_family}, title ${titleSize}px, ${titleLines.length} line(s))`);
}

async function main() {
  const ids = process.argv.slice(2);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const targets = ids.length ? ids : Object.keys(manifest.byBook);
  for (const id of targets) {
    await build(id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
