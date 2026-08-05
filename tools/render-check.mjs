#!/usr/bin/env node
/**
 * The rendered-colour gate.
 *
 *   node tools/render-check.mjs [url]
 *
 * tools/contrast.py checks the colours we AUTHOR. Once the books are lit, that
 * is no longer the same thing as the colours a reader SEES: a light rig scales
 * every surface, and a floor that passes on paper can fail on screen.
 *
 * So this opens each book, samples the pixels actually rendered for its cover,
 * and measures them against the ground it is sitting on. It needs a running
 * dev server and a debuggable Chrome on 9222.
 *
 * The floor is the one from DECISIONS.md D10 -- cover against its ground
 * >= 1.5:1 -- but measured at the end of the pipeline instead of the start.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.argv[2] || 'http://localhost:3000/el/';

const books = JSON.parse(readFileSync(join(ROOT, 'content/books.json'), 'utf8')).books.filter(
  (b) => b.cover_licensed
);
const grounds = JSON.parse(readFileSync(join(ROOT, 'content/grounds.json'), 'utf8'));

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
await send('Page.navigate', { url: URL_ });
await new Promise((r) => setTimeout(r, 8000));
await ev(`(()=>{const s=document.createElement('style');
  s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})()`);

/* Sample a small patch and average it, so a single dark pixel of cover artwork
   does not stand in for the whole face. */
async function samplePatch(cx, cy, half) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: cx - half, y: cy - half, width: half * 2, height: half * 2, scale: 1 },
  });
  const buf = Buffer.from(shot.data, 'base64');
  const { execSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const tmp = '/tmp/rc.png';
  writeFileSync(tmp, buf);
  const out = execSync(
    `node -e "const s=require('${join(ROOT, 'node_modules/sharp')}');s('${tmp}').stats().then(st=>console.log(st.channels.slice(0,3).map(c=>Math.round(c.mean)).join(',')))"`
  )
    .toString()
    .trim();
  return out.split(',').map(Number);
}

console.log('RENDERED-COLOUR GATE  (lit surfaces, measured on screen)');
console.log('='.repeat(74));
console.log(`${'book'.padEnd(34)}${'cover(rendered)'.padStart(17)}${'vs ground'.padStart(12)}  verdict`);
console.log('-'.repeat(74));

let worst = Infinity;
const failures = [];

for (const b of books) {
  const ok = await ev(`(()=>{const rows=[...document.querySelectorAll('[data-book-slot]')];
    const el=rows.find(n=>n.dataset.bookSlot===${JSON.stringify(b.id)});
    if(!el) return false; el.querySelector('button').click(); return true;})()`);
  if (!ok) continue;
  await new Promise((r) => setTimeout(r, 2300));

  const box = await ev(`(()=>{const st=document.querySelector('.readerRow__stage');
    const r=st.getBoundingClientRect();
    return {cx:Math.round(r.left+r.width*0.5), cy:Math.round(r.top+r.height*0.5)};})()`);

  const cover = await samplePatch(box.cx, box.cy, 26);
  const ground = hexToRgb(grounds[b.id].reading);
  const ratio = contrast(cover, ground);
  worst = Math.min(worst, ratio);

  const pass = ratio >= 1.5;
  if (!pass) failures.push([b.id, ratio]);
  console.log(
    `${b.id.slice(0, 33).padEnd(34)}${`rgb(${cover.join(',')})`.padStart(17)}${`${ratio.toFixed(2)}:1`.padStart(12)}  ${pass ? 'PASS' : 'FAIL'}`
  );

  await ev(`document.querySelector('.rail__back').click()`);
  await new Promise((r) => setTimeout(r, 1400));
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
