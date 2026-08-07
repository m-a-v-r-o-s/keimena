// Shelf -> book page pick-up transition: measures it instead of eyeballing
// screenshots, because this sandbox's headless Chrome throttles rAF hard
// (observed ~2-4Hz instead of 60Hz) and each CDP round-trip has real,
// inconsistent latency (routinely 300-500ms+). Both of those make
// Node-side `setTimeout` polling report misleading "still at t=200ms"
// snapshots that are actually much later in wall-clock terms.
//
// The fix: record the trace INSIDE the page, on the page's own
// performance.now() clock (immune to CDP latency and, once
// Target.activateTarget is called, to background-tab rAF throttling), then
// fetch the finished array back in one go after a generous, safe wait.
//
// Usage: node .screenshots/probe_pickup.mjs http://localhost:3001 [mobile]
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2];
if (!BASE) {
  console.error('usage: node .screenshots/probe_pickup.mjs <base-url> [mobile]');
  process.exit(1);
}
const mobile = process.argv[3] === 'mobile';
const width = mobile ? 390 : 1440;
const height = mobile ? 844 : 900;

const page = await (
  await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(BASE + '/')}`, { method: 'PUT' })
).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const msgId = ++id;
    pending.set(msgId, res);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));

await send('Runtime.enable');
await send('Page.enable');
await send('Target.activateTarget', { targetId: page.id }); // defeats background-tab rAF throttling
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
await send('Page.navigate', { url: `${BASE}/` });
await new Promise((r) => setTimeout(r, 2500));

await send('Runtime.evaluate', { expression: `window.scrollTo(0, document.body.scrollHeight * 0.28)` });
await new Promise((r) => setTimeout(r, 400));

// Find the mid-viewport spine, install the tracer, and dispatch the click's
// coordinates in one round trip -- Input.dispatchMouseEvent still has to be
// separate (it's a top-level CDP domain, not something page JS can call).
const target = await send('Runtime.evaluate', {
  expression: `(() => {
    const mid = window.innerHeight / 2;
    const slots = [...document.querySelectorAll('.slot[data-book-slot]')];
    let best = null, bestD = Infinity;
    for (const el of slots) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) { bestD = d; best = el; }
    }
    const r = best.getBoundingClientRect();
    return JSON.stringify({ id: best.dataset.bookSlot, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`,
  returnByValue: true,
});
const t = JSON.parse(target.result.value);
console.log('target', t);

await send('Runtime.evaluate', {
  expression: `(() => {
    window.__trace = [];
    const id = ${JSON.stringify(t.id)};
    const t0 = performance.now();
    const startHref = location.href;
    window.__navAt = null;
    const sample = () => {
      const el = document.querySelector('[data-book-slot="' + id + '"]');
      const r = el ? el.getBoundingClientRect() : null;
      window.__trace.push({
        t: Math.round(performance.now() - t0),
        w: r ? Math.round(r.width) : null,
        h: r ? Math.round(r.height) : null,
        x: r ? Math.round(r.left) : null,
        y: r ? Math.round(r.top) : null,
        href: location.href,
      });
      if (window.__navAt === null && location.href !== startHref) window.__navAt = Math.round(performance.now() - t0);
      if (performance.now() - t0 < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`,
});

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x, y: t.y, button: 'left', clickCount: 1 });

await new Promise((r) => setTimeout(r, 3500));

const out = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ navAt: window.__navAt, href: location.href, trace: window.__trace })`,
  returnByValue: true,
});
const data = JSON.parse(out.result.value);
console.log('navigated at (in-page clock):', data.navAt, 'ms   final href:', data.href);
console.log('samples:', data.trace.length);
for (const s of data.trace) {
  console.log(`t=${String(s.t).padStart(5)}ms  w=${String(s.w).padStart(5)} h=${String(s.h).padStart(4)}  x=${String(s.x).padStart(6)} y=${String(s.y).padStart(6)}  href=${s.href}`);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('.screenshots/pickup_landed.png', Buffer.from(shot.data, 'base64'));
console.log('wrote .screenshots/pickup_landed.png');

ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
