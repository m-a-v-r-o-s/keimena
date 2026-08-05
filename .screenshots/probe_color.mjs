// Phase 1 gate: does a rendered book face match the colour the contrast gate
// verified? The whole per-book colour system assumes it does. Tone mapping,
// colour-space handling or an implicit light would each shift it silently, so
// this is measured rather than eyeballed.
//
// The paper grain sits above the canvas by design, so it is suppressed for the
// sample -- we are testing the renderer, not the compositing.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.argv[2] || 'http://localhost:3000/el/';
const expect = (process.argv[3] || '#8C3A2B').toUpperCase();

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
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  return r?.exceptionDetails ? { __error: r.exceptionDetails.text } : r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 6000));

// Suppress the grain overlay and the dev overlay for a clean read.
await evalJs(`(() => {
  const s = document.createElement('style');
  s.textContent = 'body::after{opacity:0 !important} nextjs-portal{display:none !important}';
  document.head.appendChild(s);
  return true;
})()`);
await new Promise((r) => setTimeout(r, 900));

// Where is the featured book's slot on screen?
const box = await evalJs(`(() => {
  const el = document.querySelector('[data-book-slot]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.55), y: Math.round(r.top + r.height * 0.5),
           w: Math.round(r.width), h: Math.round(r.height), id: el.dataset.bookSlot };
})()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const outPath = join(dirname(fileURLToPath(import.meta.url)), 'colorprobe.png');
writeFileSync(outPath, Buffer.from(shot.data, 'base64'));

console.log(JSON.stringify({ box, expect, shot: outPath }, null, 2));
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
