#!/usr/bin/env node
/**
 * The rendered-colour gate.
 *
 *   node tools/render-check.mjs [origin]
 *
 * tools/contrast.py checks the colours we AUTHOR. Once the books are lit, that
 * is no longer the same thing as the colours a reader SEES: a light rig scales
 * every surface, and a floor that passes on paper can fail on screen.
 *
 * So this opens each book, samples the pixels actually rendered for its cover,
 * and measures them against the ground it is sitting on. It needs a debuggable
 * Chrome on 9222 and a server already up at `origin` (default
 * http://127.0.0.1:3001 -- see the port rule in plan.md/CLAUDE.md: 3000 is
 * never ours to bind or free).
 *
 * The floor is the one from DECISIONS.md D10 -- cover against its ground
 * >= 1.5:1 -- but measured at the end of the pipeline instead of the start.
 *
 * D23 replaced the single-route overlay reader (a book slot was a `<button>`
 * that opened a fixed reading view in place, closed by `.rail__back`) with a
 * real page per book: `/books/<id>/`. This script originally drove that
 * overlay -- click a slot's button, sample, click the rail's back control,
 * repeat -- none of which exists any more, so it hard-failed on `.click()`
 * against a `<button>` no slot has had since.
 *
 * The fix is ONE PAGE LOAD PER BOOK, not one load with sixteen scrolls. That
 * looks like a step backward (17 navigations instead of 1) but it sidesteps
 * a real trap in the reading layout: every `.readerRow__stageWrap` is
 * `position: sticky` (globals.css, ~line 1080), released only once its own
 * row's bottom clears the viewport. Scrolling straight to book N's stage
 * with `scrollIntoView` lands the DOM element in the right place by
 * geometry, but a background CDP tab has requestAnimationFrame throttled
 * hard -- BookCanvas's frameloop is "demand", a new frame only draws on
 * invalidate(), which itself rides on rAF -- so the canvas kept painting
 * whichever book's sticky wrapper was ALREADY stuck there before the jump,
 * for as long as the tab stayed backgrounded. `Page.bringToFront` on its own
 * did not fully close that gap either: this script had ONE tab jumping
 * between all seventeen rows in one long document, and something in that
 * repeated sticky-release/re-stick sequence kept leaving every book after
 * the first sampling flat page background instead of a cover (16/17
 * failures, all landing on ground-equals-cover exactly -- i.e. nothing was
 * drawn there at all). Every book's OWN page always server-renders THAT
 * book's row first, unscrolled, before Reader.jsx's hydration expansion
 * inserts any neighbours around it -- so sampling it needs no scroll and no
 * sticky handoff, the same shape as the one case that always passed in the
 * multi-scroll version (book index 0, sampled before any scrolling
 * happened). Slower, but it tests the thing a reader actually lands on:
 * this book's own page, not this book seen mid-scroll through the others.
 * See DECISIONS.md D26.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const books = JSON.parse(readFileSync(join(ROOT, 'content/books.json'), 'utf8')).books.filter(
  (b) => b.cover_licensed
);
const grounds = JSON.parse(readFileSync(join(ROOT, 'content/grounds.json'), 'utf8'));
const ORIGIN = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/$/, '');

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
const hexToRgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

const page = await (
  await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  })
).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
  return r?.exceptionDetails ? { __e: r.exceptionDetails.text } : r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.enable');
/* See the file header: a background tab's rAF (and therefore r3f's
   demand-frameloop invalidate()) gets throttled, so the canvas can lag well
   behind wherever the DOM says a book's stage now is. Foregrounded once,
   here -- every navigation below reuses the same tab, which stays the
   front one for the rest of the run. */
await send('Page.bringToFront');

/* Sample a small patch and average it, so a single dark pixel of cover artwork
   does not stand in for the whole face.
 *
 * Full-frame capture, cropped locally with sharp -- NOT `Page.captureScreenshot`'s
 * own `clip` option, which this Chrome build (150.x) answers with the wrong
 * pixels: a clip at (cx,cy) came back solid background colour while a local
 * crop of a clip-less screenshot at those exact same coordinates showed the
 * cover correctly. Confirmed side by side before trusting this -- see
 * DECISIONS.md D26. Costs one extra full-page decode per sample, which this
 * gate can afford; correctness matters more than the saved bytes here. */
async function samplePatch(cx, cy, half) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  const sharp = (await import(join(ROOT, 'node_modules/sharp/lib/index.js'))).default;
  const stats = await sharp(buf)
    .extract({ left: cx - half, top: cy - half, width: half * 2, height: half * 2 })
    .stats();
  return stats.channels.slice(0, 3).map((c) => Math.round(c.mean));
}

console.log('RENDERED-COLOUR GATE  (lit surfaces, measured on screen)');
console.log('='.repeat(74));
console.log(`${'book'.padEnd(34)}${'cover(rendered)'.padStart(17)}${'vs ground'.padStart(12)}  verdict`);
console.log('-'.repeat(74));

let worst = Infinity;
const failures = [];

for (const b of books) {
  await send('Page.navigate', { url: `${ORIGIN}/books/${b.id}/` });
  /* data-loaded is BookCanvas.jsx's own "renderer and onscreen covers ready"
     signal (events.js) -- polled, not a fixed guess, since how long the real
     one takes is exactly what plan.md's Phase 2 changes. This book's own row
     is the one thing every book page always server-renders un-scrolled, so
     no scrollIntoView or sticky handoff is needed at all -- see file header. */
  let loaded = false;
  for (let i = 0; i < 150 && !loaded; i++) {
    loaded = await ev("document.documentElement.hasAttribute('data-loaded')");
    if (!loaded) await new Promise((r) => setTimeout(r, 100));
  }
  if (!loaded) {
    console.log(`${b.id.slice(0, 33).padEnd(34)}  data-loaded never fired -- skipped`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 500));
  await ev(`(()=>{const s=document.createElement('style');
    s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})()`);

  const box = await ev(`(()=>{const st=document.querySelector('.readerRow__stage[data-book-slot="${b.id}"]');
    if(!st) return null;
    const r=st.getBoundingClientRect();
    return {cx:Math.round(r.left+r.width*0.5), cy:Math.round(r.top+r.height*0.5)};})()`);
  if (!box) {
    console.log(`${b.id.slice(0, 33).padEnd(34)}  stage not found -- skipped`);
    continue;
  }

  const cover = await samplePatch(box.cx, box.cy, 26);
  const ground = hexToRgb(grounds[b.id].reading);
  const ratio = contrast(cover, ground);
  worst = Math.min(worst, ratio);

  const pass = ratio >= 1.5;
  if (!pass) failures.push([b.id, ratio]);
  console.log(
    `${b.id.slice(0, 33).padEnd(34)}${`rgb(${cover.join(',')})`.padStart(17)}${`${ratio.toFixed(2)}:1`.padStart(12)}  ${pass ? 'PASS' : 'FAIL'}`
  );
}

console.log();
console.log(`  lowest cover-on-reading: ${worst.toFixed(2)}:1   floor 1.5  (visibility)`);
console.log(`  books measured         : ${books.length}`);
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);

if (failures.length) {
  console.log(`\nGATE FAILED -- ${failures.length} book(s) below the floor once lit:`);
  for (const [bid, r] of failures) console.log(`  ${bid}: ${r.toFixed(2)}:1`);
  process.exit(1);
}
console.log('\nGATE PASSED');
