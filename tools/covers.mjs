#!/usr/bin/env node
/**
 * Build the book textures.
 *
 *   node tools/covers.mjs            build every book
 *   node tools/covers.mjs <id> ...   build only these
 *
 * Emits, per book, into public/covers/<id>/:
 *
 *   front.webp  the cover                      (683 x 1024)
 *   spine.webp  author | title | imprint       (1024 x 128, landscape)
 *   og.png      social card                    (1200 x 630)
 *
 * There are two kinds of front, and the difference matters:
 *
 * 1. A LICENSED COVER (tools/covers-src/<id>.webp) is the publisher's own
 *    artwork, licensed to this project. It is resized and nothing else: no
 *    grading, no scrim, no type composited over it. It is someone else's
 *    finished design and this pipeline has no business editing it -- which
 *    also means its internal contrast is theirs, not ours, and is not gated
 *    here.
 *
 * 2. A TYPOGRAPHIC COVER, for titles with no licensed artwork. Set in this
 *    system's own voice on the book's accent, with title and author drawn from
 *    the OFL faces in tools/fonts/ and outlined with opentype so nothing
 *    depends on a font being installed wherever this runs. These ARE gated:
 *    the title has to clear 4.5:1 on its own field.
 *
 * The spine is always ours. A licensed jacket gives us a front, not a spine, so
 * that face is composited from real type on the book's accent.
 *
 * The two faces that become GPU textures ship as WebP -- as PNG the set came to
 * 14MB, a real cost against the mobile budget in DESIGN.md section 6. The og
 * card stays PNG because social scrapers are less consistent about WebP.
 *
 * Greek typography (DESIGN.md 3.1) applies exactly as it does in CSS: never
 * uppercase Greek, extra leading for the tonos, and the longest title in the
 * catalogue is the layout test.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const opentype = require('opentype.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => join(ROOT, ...a);

/* Where a surface master lives.
 *
 * The masters are LOSSLESS webp -- byte-for-byte the same pixels as the PNGs
 * they replaced, and a third the size. Lossless matters here and lossy would
 * have been a mistake: these are re-encoded on every run, and a lossy master
 * would lose a little more each time it was published. PNG is still accepted
 * so a freshly exported sheet can be dropped in without converting it first. */
const textureSrc = (name) => {
  for (const ext of ['.webp', '.png']) {
    const f = P('tools/textures', `${name}${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
};

/* A master, FULLY DECODED.
 *
 * Not plain `sharp(file)`. libwebp can decode straight to a reduced size, and
 * sharp takes that path when a resize follows -- which is faster, and slightly
 * softer, and would have silently resampled every published texture the day
 * these masters stopped being PNG. Measured, it moved every sheet: a mean of
 * 1.3 to 5.8 levels per channel, and the drawn columns on the background sheet
 * are exactly the sort of fine line that loses.
 *
 * Decoding to raw first puts the resize back on full-resolution pixels. With
 * this, every file the pipeline publishes is byte-for-byte what it published
 * when the masters were PNG -- which is the only way a format change to the
 * SOURCES is allowed to be invisible in the OUTPUT. */
async function textureImage(name) {
  const src = textureSrc(name);
  if (!src) return null;
  const img = sharp(src);
  const { width, height, channels } = await img.metadata();
  const raw = await img.raw().toBuffer();
  return sharp(raw, { raw: { width, height, channels } });
}

const FONT = {
  display: opentype.loadSync(P('tools/fonts/GFSDidot-Regular.ttf')),
  body: opentype.loadSync(P('tools/fonts/Literata[opsz,wght].ttf')),
  mono: opentype.loadSync(P('tools/fonts/JetBrainsMono[wght].ttf')),
};

const FRONT = { w: 683, h: 1024 };
/* The stacked pose's own front, separate from the reading-size one above.
 *
 * `POSE.stacked.rake` is 0.05 radians (book-model.js) -- lying almost flat,
 * the cover is a sliver a few pixels deep, not the subject. A 683x1024
 * photograph decoded and uploaded to the GPU to paint that sliver was most of
 * the shelf's own weight (plan.md's own measurement: ~1.5MB of the
 * homepage's ~2.8MB). 320x480 was checked against the numbers that actually
 * matter here, not assumed: `--slot-h` tops out at 216px (tokens.css), so
 * even at DPR 2 the cover's longest ON-SCREEN dimension never exceeds
 * ~200 CSS px before the rake collapses it further, and mipmapping (see
 * textures.js) only ever needs to sample DOWN from a source, never up. */
const FRONT_SM = { w: 320, h: 480 };
const SPINE = { len: 1024 };

/* Thickness varies per book, and the spine sheet has to vary with it.
 *
 * A fixed-height sheet stretched onto a face whose height IS the book's
 * thickness squashes the type on thin books and pulls it on fat ones. So the
 * sheet is cut to the same aspect as the face it lands on, and the type is
 * sized against that -- which leaves every spine's lettering at its natural
 * proportions regardless of how thick the book is.
 *
 * MUST match components/three/book-model.js. Both derive the spread from the
 * id, and if they disagree the sheet is cut for a book that is not there. */
const WIDTH_RATIO = 140 / 210;
const THICKNESS_RATIO = 24 / 210;

function hashUnit(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

const spreadFor = (id) => 0.62 + hashUnit(id) * 0.76;

/* Eight of the seventeen are bound in cloth; the rest are smooth board.
 *
 * Chosen by hash rather than at random, so the same books are cloth on every
 * build and in every screenshot -- and spread across the shelf rather than
 * clustered, because the point is that a reader scrolling the stack keeps
 * meeting a spine that is not like the last one. The weave is composited into
 * the sheet here rather than layered at runtime: it costs nothing to draw, and
 * the type ends up sitting ON the cloth the way foil does on a real binding.
 */
const CLOTH_COUNT = 8;
let clothIds = null;
function isCloth(id) {
  if (!clothIds) {
    clothIds = new Set(
      books.books
        .filter((b) => b.cover_licensed)
        .map((b) => [b.id, hashUnit(b.id + 'cloth')])
        .sort((a, b) => a[1] - b[1])
        .slice(0, CLOTH_COUNT)
        .map(([bid]) => bid)
    );
  }
  return clothIds.has(id);
}
const OG = { w: 1200, h: 630 };

const TEXT = '#F2EDE4';
const INK = '#1B1714';

/* ---- The imprint's mark ------------------------------------------------- */
/**
 * The publisher's logo, keyed off its background.
 *
 * The file ships as white artwork on a black plate, which is the wrong thing to
 * composite onto a spine: the plate would land as a black rectangle over the
 * book's accent. What is wanted is the artwork alone.
 *
 * So the plate is not cropped away, it is turned into transparency -- the
 * image's own luminance becomes the alpha channel and the colour is replaced
 * wholesale with the type colour. That keeps every anti-aliased edge of the
 * mark intact, which a threshold or a flood fill would chew up at this size,
 * and it means the mark is the same ink as the lettering it sits beside rather
 * than a slightly different white.
 *
 * The levels are pulled in at both ends first: below LO is plate (and the file
 * has compression noise down there), above HI is solid mark.
 */
const MARK_SRC = P('tools/covers-src/keimena.png');
const MARK_LO = 22;
const MARK_HI = 218;
let markMaster = null;

async function imprintMark() {
  if (markMaster) return markMaster;
  if (!existsSync(MARK_SRC)) return null;

  const { data, info } = await sharp(MARK_SRC)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ink = hexToRgb(TEXT);
  const rgba = Buffer.alloc(info.width * info.height * 4);
  /* Trimmed to the artwork's own bounds, so the file's padding does not decide
     the mark's size on the spine. */
  let x0 = info.width;
  let y0 = info.height;
  let x1 = -1;
  let y1 = -1;

  for (let i = 0; i < data.length; i++) {
    const a = Math.max(0, Math.min(1, (data[i] - MARK_LO) / (MARK_HI - MARK_LO)));
    rgba[i * 4] = ink[0];
    rgba[i * 4 + 1] = ink[1];
    rgba[i * 4 + 2] = ink[2];
    rgba[i * 4 + 3] = Math.round(a * 255);
    if (a > 0.12) {
      const x = i % info.width;
      const y = (i / info.width) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;

  markMaster = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png()
    .toBuffer();
  return markMaster;
}

/* ---- Colour ------------------------------------------------------------- */
const hexToRgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const toLin = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const relLum = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
const contrast = (a, b) => {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/* ---- Type --------------------------------------------------------------- */

/**
 * Tracking is size-specific, mirroring tokens.css. A high-contrast Didone falls
 * apart tracked loose at display sizes and clots tracked tight at caption
 * sizes, so this follows whatever size the fitter lands on.
 */
function trackingFor(size) {
  if (size >= 44) return -0.022;
  if (size >= 30) return -0.015;
  if (size >= 24) return -0.008;
  return 0.006;
}

function measure(font, text, size, tracking = 0) {
  return font.getAdvanceWidth(text, size) + tracking * size * Math.max(text.length - 1, 0);
}

/** Text as SVG path data -- outlined, so no fontconfig, and Greek shapes right. */
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

/** Greedy wrap on the measured advance, never on character count. */
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

/**
 * Step the size down until the title wraps to at most `maxLines`. Greek runs
 * 10-15% longer than English, so this is sized against the string actually
 * being set, never against a Latin assumption.
 */
function fitTitle(font, text, { maxWidth, maxLines, start, min, tracking }) {
  let size = start;
  let lines = wrap(font, text, size, maxWidth, tracking);
  while (
    (lines.length > maxLines || lines.some((l) => measure(font, l, size, tracking) > maxWidth)) &&
    size > min
  ) {
    size -= 2;
    lines = wrap(font, text, size, maxWidth, tracking);
  }
  return { size, lines };
}

/* ---- Fronts ------------------------------------------------------------- */

/* The masters are LOSSLESS webp, for the reason given above the surface
 * textures: a licensed cover is re-encoded on every run, and a lossy master
 * would shed a little more each time it was published. It is also artwork this
 * pipeline is not allowed to edit, and a lossy re-encode IS an edit. The other
 * formats stay accepted so a cover as the publisher sent it can be dropped in
 * and built without converting it first -- webp is probed first so a converted
 * master wins over any original left beside it. */
const COVER_EXT = ['.webp', '.jpg', '.jpeg', '.png'];
function licensedCover(id) {
  for (const ext of COVER_EXT) {
    const f = P('tools/covers-src', id + ext);
    if (existsSync(f)) return f;
  }
  return null;
}

/** The publisher's cover, resized and otherwise untouched. */
/* quality: 78, effort: 6 -- plan.md Phase 1.3. The un-pinned quality: 90 this
 * replaced produced a 32-216KB range for identically-sized output (quality
 * was never pinned, only ever inherited from whatever the source happened to
 * compress to), for a surface whose colour is load-bearing (D10) but whose
 * detail is seen raked to a sliver on the shelf and only flat-on, full-size,
 * on a book's own page. 78/6 is sharp's own recommended ceiling for "visually
 * lossless" webp; verified per-book against tools/render-check.mjs (D10's
 * cover-against-ground floor), not assumed. */
async function buildLicensedFront(file) {
  return sharp(file)
    .resize(FRONT.w, FRONT.h, { fit: 'cover', position: 'centre' })
    .webp({ quality: 78, effort: 6 })
    .toBuffer();
}

/** The same crop, shelf-sized -- see FRONT_SM above for why 320x480 is
 * already generous for what the stacked pose actually shows on screen. */
async function buildLicensedFrontSmall(file) {
  return sharp(file)
    .resize(FRONT_SM.w, FRONT_SM.h, { fit: 'cover', position: 'centre' })
    .webp({ quality: 72 })
    .toBuffer();
}

/**
 * The spine: author at the head, title centred, imprint at the foot. Emitted
 * LANDSCAPE, which is the orientation the stack needs; the upright pose turns
 * the texture rather than shipping a second file.
 */
async function buildSpine(book, title, author, imprint) {
  const w = SPINE.len;
  /* The face this lands on is (book height x book thickness), so the sheet is
     cut to exactly that ratio. Thin book, short sheet -- and the type inside it
     scales down with the sheet instead of being crushed by it. */
  const h = Math.max(56, Math.round(w * THICKNESS_RATIO * spreadFor(book.id)));
  const k = h / 128; // everything below was drawn for a 128px sheet

  const bg = mix(hexToRgb(book.accent), [0, 0, 0], 0.14);
  const metaSize = Math.max(11, Math.round(21 * k));
  const cloth = isCloth(book.id);

  let fitted = Math.round(44 * k);
  const ceiling = h * 0.46; // the type must never crowd the sheet's edges
  while (
    (measure(FONT.display, title, fitted, trackingFor(fitted)) > w * 0.46 || fitted > ceiling) &&
    fitted > 14
  ) {
    fitted -= 1;
  }

  const authorTxt = author.split(' ').slice(-1)[0];
  /* The imprint is the publisher's MARK where we have it, and set type only as
     a fallback. A logo is not a word the pipeline is free to re-set. */
  const mark = await imprintMark();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <path d="${textPath(FONT.body, authorTxt, metaSize, w * 0.06, h / 2 + metaSize * 0.35, { tracking: 0.04 })}" fill="${TEXT}" fill-opacity="0.9"/>
    <path d="${textPath(FONT.display, title, fitted, w / 2, h / 2 + fitted * 0.34, { tracking: trackingFor(fitted), anchor: 'middle' })}" fill="${TEXT}"/>
    ${
      mark
        ? ''
        : `<path d="${textPath(FONT.mono, imprint, metaSize * 0.82, w * 0.94, h / 2 + metaSize * 0.3, { tracking: 0.12, anchor: 'end' })}" fill="${TEXT}" fill-opacity="0.66"/>`
    }
  </svg>`;

  /* Overlay, not multiply: the weave has to modulate the accent, not darken
     it. A multiply would take every cloth-bound book several stops down and
     break its contrast against its own ground. */
  const base = sharp({
    create: { width: w, height: h, channels: 3, background: { r: bg[0], g: bg[1], b: bg[2] } },
  });

  const layers = [];
  if (cloth && textureSrc('cloth')) {
    /* TILED, not stretched to fit.
     *
     * Scaling one copy of the sheet across the whole spine put a single weave
     * repeat on a strip a hundred pixels tall, so the threads came out as wide
     * as the lettering and read as upholstery. Real bookcloth is fine at this
     * size. Tiling a small square gives roughly six repeats across the spine,
     * which is about right for a 210mm book seen at this distance. */
    /* Never taller than the strip it tiles across -- sharp refuses to
       composite an input larger than its base, and the thinnest spines are
       only ~77px tall. Capping at the height also means thin books get a
       proportionally finer weave, which is what a thin book actually looks
       like. */
    const TILE = Math.min(168, h);
    layers.push({
      input: await (await textureImage('cloth'))
        /* Tile a CROP of the sheet, not the whole thing. The tile can never be
           taller than the spine, so the only way to make the weave coarser is
           to magnify it -- take a third of the source and blow it up to the
           tile. Tiling the full sheet made the threads far too fine to read. */
        .extract({ left: 380, top: 380, width: 460, height: 460 })
        .resize(TILE, TILE, { fit: 'cover' })
        .greyscale()
        /* Pulled into a narrow band around mid-grey so the overlay reads as
           tooth rather than as a photograph of fabric. */
        .linear(0.42, 128 * 0.58)
        /* Explicit, because the master is decoded to raw before it gets here
           and a raw-backed pipeline has no input format to infer on the way
           out. PNG, so the tile reaches the composite lossless. */
        .png()
        .toBuffer(),
      blend: 'overlay',
      tile: true,
    });
  }
  layers.push({ input: Buffer.from(svg) });

  if (mark) {
    /* Sized off the SHEET, not off the type. The mark is a stacked lockup --
       rule, two lines -- so matching it to the cap height of the word it
       replaces would shrink its lettering to nothing. It gets the height a
       logo is normally given instead, inside the same margin the title keeps.
       Composited after the weave, so the cloth's tooth runs under it. */
    const meta = await sharp(mark).metadata();
    const mh = Math.max(14, Math.round(h * 0.42));
    const mw = Math.max(14, Math.round((mh * meta.width) / meta.height));
    layers.push({
      input: await sharp(mark)
        .resize(mw, mh, { fit: 'fill' })
        /* Held a little back, exactly as the set imprint was: the mark is a
           credit at the foot of the spine, not a second title. */
        .composite([
          {
            input: Buffer.from([255, 255, 255, Math.round(0.72 * 255)]),
            raw: { width: 1, height: 1, channels: 4 },
            tile: true,
            blend: 'dest-in',
          },
        ])
        .png()
        .toBuffer(),
      left: Math.round(w * 0.94 - mw),
      top: Math.round((h - mh) / 2),
    });
  }

  return base.composite(layers).webp({ quality: 90 }).toBuffer();
}

async function buildOg(book, ground, title, author) {
  const acc = hexToRgb(book.accent);
  const g = hexToRgb(ground);
  const fit = fitTitle(FONT.display, title, {
    maxWidth: OG.w * 0.62,
    maxLines: 3,
    start: 76,
    min: 34,
    tracking: -0.022,
  });
  const track = trackingFor(fit.size);
  const leading = fit.size * 1.2;
  /* Undated titles exist -- see `year_status` in books.json -- and must never
     print "null" onto a social card. */
  const stamp = book.year ? String(book.year) : book.publisher ?? '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.w}" height="${OG.h}">
    <rect width="${OG.w}" height="${OG.h}" fill="rgb(${g.join(',')})"/>
    <rect x="${OG.w * 0.74}" y="0" width="${OG.w * 0.26}" height="${OG.h}" fill="rgb(${acc.join(',')})"/>
    <path d="${fit.lines
      .map((l, i) => textPath(FONT.display, l, fit.size, 72, 250 + i * leading, { tracking: track }))
      .join(' ')}" fill="${TEXT}"/>
    <path d="${textPath(FONT.body, author, 30, 72, 250 + fit.lines.length * leading + 46, { tracking: 0.01 })}" fill="${TEXT}" fill-opacity="0.8"/>
    ${stamp ? `<path d="${textPath(FONT.mono, stamp, 22, 72, 150, { tracking: 0.14 })}" fill="${TEXT}" fill-opacity="0.6"/>` : ''}
  </svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/* ---- Main --------------------------------------------------------------- */

const books = JSON.parse(readFileSync(P('content/books.json'), 'utf8'));
const grounds = JSON.parse(readFileSync(P('content/grounds.json'), 'utf8'));
const author = JSON.parse(readFileSync(P('content/author.json'), 'utf8'));
const AUTHOR_EL = author.name_el ?? 'Πέτρος Μάρκαρης';

/* Surface textures are shared by every book, so they are published once rather
 * than per book. Resized down hard: they are only ever seen on edges a few
 * pixels wide, and the source files are three megabytes each.
 *
 * HOW HARD depends on whether the sheet is TILED, and they are not all alike.
 * The size each one wants is set by its REPEAT in BookVolume, not by its role:
 *
 *   TILED -- cloth (2.2x3 and 7x1.4), board (9x1), endpaper (1.6x2.2). The
 *   sheet's pixels are laid across the face several times over, so a 768px
 *   weave repeated seven times along a spine carries about 5000px of detail
 *   onto a strip sixty pixels wide. These were sized as if seen once and whole,
 *   which is the one thing a tiled surface never is. Halved, each still lands
 *   oversampled against its face -- measured at the on-screen size of a single
 *   repeat, halving costs 36dB on the cloth and 45dB on the board, a maximum
 *   channel error of 13 and 6.
 *
 *   NOT TILED -- foredge and topedge are stretched ONCE across the page block
 *   (topedge is surface(...,1,1); the fore-edge sheet is used raw and merely
 *   turned). Halving these halves their real on-screen resolution: 24dB and a
 *   maximum channel error of 96, on the two sheets that carry the most actual
 *   colour, and on the paper edges that are most of what says "book". They keep
 *   their 1024. Headband is the same story on one axis -- it tiles 3 along the
 *   braid but its second axis is the band's own width at repeat 1 -- so it
 *   keeps its 512, and at 28KB there was nothing there worth taking.
 *
 * Greyscale was the obvious next move and it is not worth making: these carry
 * almost no chroma to begin with (a mean channel spread of 1.3 on the cloth)
 * and are tinted by the material anyway, so the chroma planes already cost
 * essentially nothing -- measured, dropping them saved 86 bytes on the cloth
 * while putting the edge sheets, which DO carry real colour, at risk. */
mkdirSync(P('public/textures'), { recursive: true });
/* quality: 72 -- plan.md Phase 1.5, on top of the resolution work above (which
 * already halved the tiled sheets and deliberately kept foredge/topedge/
 * headband at their measured sizes -- see the paragraph above; this doesn't
 * revisit that). 88 was never chosen for a reason, just inherited; checked
 * against render-check.mjs and against `cloth` specifically as a bump map
 * (globals.css/textures.js), the one place over-compression would show as
 * mush rather than softness -- no visible change at either role. */
for (const [name, size, quality = 72] of [
  ['foredge', 1024],
  ['topedge', 1024],
  ['cloth', 384],
  ['board', 384],
  ['endpaper', 384],
  ['headband', 512],
]) {
  const img = await textureImage(name);
  if (!img) {
    console.log(`texture ${name} master missing -- skipped`);
    continue;
  }
  writeFileSync(
    P('public/textures', `${name}.webp`),
    await img.resize(size, size, { fit: 'inside' }).webp({ quality }).toBuffer()
  );
  console.log(`texture ${name}.webp published`);
}

/* The imprint's mark, for the DOM this time.
 *
 * The masthead needs the same artwork the spines carry, and it needs it the
 * same way: white, on nothing. imprintMark() already does exactly that work --
 * it turns the file's own luminance into an alpha channel and replaces the
 * colour wholesale, which is what keeps every anti-aliased edge of the mark
 * intact at the size a spine wants it. Publishing its result rather than
 * repeating it means the corner of the page and the foot of every spine are
 * provably the same mark, and the source PNG's black plate never ships.
 *
 * WebP, LOSSLESS, because it carries an alpha channel that is the whole point
 * and because at this size the file is a couple of kilobytes either way. */
const mark = await imprintMark();
if (mark) {
  writeFileSync(P('public/imprint.webp'), await sharp(mark).webp({ lossless: true }).toBuffer());
  console.log('imprint.webp published');
} else {
  console.log('imprint mark master missing -- skipped');
}

/* The author's poster, as one photographed sheet of paper.
 *
 * This used to be synthesised -- a plain stock plus a procedurally baked
 * crease map -- because there was no real folded sheet to shoot. There is one
 * now (tools/covers-src/paper.png): the publisher's bio, handset and
 * photographed folded, creases and foxing and all. Published straight, the
 * same way a licensed cover is: resized and re-encoded, nothing composited in,
 * because it is someone else's finished object and this pipeline has no
 * business drawing on top of it.
 *
 * The fold positions AuthorPoster.jsx animates around are measured off this
 * exact file (see the FOLDS comment there) and MUST be re-measured if this
 * image is ever replaced -- a different sheet creases in different places. */
const paperMaster = licensedCover('paper');
if (paperMaster) {
  /* 800x1131 -- plan.md Phase 1.4. Same 1055x1491 aspect ratio as the source
   * (within 0.1%), which matters here specifically because the element this
   * paints is `background: ... center / 100% 100% no-repeat` (AuthorPoster.jsx)
   * -- fully stretched to its box regardless of the file's own pixel size, so
   * an aspect-ratio mismatch would show as visible distortion of the crease
   * pattern, not just softer detail. FOLDS in AuthorPoster.jsx are fractions
   * of printed height, not pixels, so they are unaffected by this resize. */
  writeFileSync(
    P('public/textures/paper.webp'),
    await sharp(paperMaster).resize(800, 1131).webp({ quality: 70 }).toBuffer()
  );
  console.log('paper.webp published');
} else {
  console.log('author poster paper missing -- skipped');
}

/* The author's portrait, for the standing text at the foot of the page.
 *
 * Resolved through licensedCover() like everything else in covers-src, so it
 * picks up the webp master and would still build from a jpg dropped in beside
 * it. Published at its native 350 -- there is no more resolution in the file to
 * give, and it is shown at about a third of that, which leaves it sharp on a
 * 2x display with nothing spare to trim.
 *
 * Quality 84 rather than the 90 a cover gets: a cover is artwork the reader is
 * asked to look at, and this is a face at 150px beside a paragraph. */
const portrait = licensedCover('markaris');
if (portrait) {
  writeFileSync(
    P('public/author.webp'),
    await sharp(portrait).resize(350, 350, { fit: 'cover', position: 'centre' }).webp({ quality: 84 }).toBuffer()
  );
  console.log('author.webp published');
} else {
  console.log('author portrait missing -- skipped');
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length ? books.books.filter((b) => only.includes(b.id)) : books.books;

let licensed = 0;
const skipped = [];

for (const book of targets) {
  const title = book.title_el;
  const src = licensedCover(book.id);
  const outDir = P('public/covers', book.id);
  if (!src) {
    skipped.push(book.id);
    continue;
  }
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'front.webp'), await buildLicensedFront(src));
  writeFileSync(join(outDir, 'front-sm.webp'), await buildLicensedFrontSmall(src));
  writeFileSync(join(outDir, 'spine.webp'), await buildSpine(book, title, AUTHOR_EL, 'ΚΕΙΜΕΝΑ'));
  writeFileSync(
    join(outDir, 'og.png'),
    await buildOg(book, grounds[book.id]?.ground ?? INK, title, AUTHOR_EL)
  );

  licensed++;
  console.log(`${book.id.padEnd(34)} licensed cover${isCloth(book.id) ? '   cloth-bound spine' : ''}`);
}

console.log(`\n${licensed} licensed cover(s) built.`);
if (skipped.length) {
  console.log(`${skipped.length} title(s) have no licensed cover and are NOT on the site:`);
  for (const id of skipped) console.log(`  ${id}`);
}
