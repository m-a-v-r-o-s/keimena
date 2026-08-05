// Phase 0, second pass. The first probe found the homepage ground is CONSTANT
// (#201819 at every scroll depth) and --coverColor is empty on body — which
// contradicts how DESIGN.md §2 describes the takeover. Before changing anything
// we look at pixels, not at computed styles: capture the shelf at several scroll
// depths, and probe where --coverColor actually lives (book rows, detail pages).
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const tag = process.argv[3];
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);
const stops = (process.argv[6] || '0,900,1800,2700,3600').split(',').map(Number);

const page = await (
  await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  })
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
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const evalJs = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  return r?.exceptionDetails ? { __error: r.exceptionDetails.text } : r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: width < 500,
  ...(width < 500 ? { hasTouch: true } : {}),
});
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 7000));

// Where does --coverColor actually live? Walk every element that declares it.
const coverColorOwners = await evalJs(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const inline = el.getAttribute && el.getAttribute('style');
    if (inline && inline.includes('--')) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 90),
        style: inline.slice(0, 200),
      });
    }
    if (out.length > 25) break;
  }
  return out;
})()`);

// Per-row geometry: how tall is a book row, how much air between rows.
const rowGeometry = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.PressHomepageBook')];
  const rects = rows.slice(0, 6).map(r => {
    const b = r.getBoundingClientRect();
    return { top: Math.round(b.top + window.scrollY), h: Math.round(b.height) };
  });
  const gaps = [];
  for (let i = 1; i < rects.length; i++) gaps.push(rects[i].top - (rects[i-1].top + rects[i-1].h));
  const cvs = document.querySelector('.PressHomepageCanvas__container');
  const cs = cvs ? getComputedStyle(cvs) : null;
  return {
    rowCount: rows.length, rects, gaps,
    canvasContainer: cs ? { position: cs.position, top: cs.top, height: cs.height, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents } : null,
  };
})()`);

const shots = [];
for (const y of stops) {
  await evalJs(`window.scrollTo(0, ${y})`);
  await new Promise((r) => setTimeout(r, 1600));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = `.screenshots/ref_${tag}_${y}.png`;
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  shots.push(out);
}

console.log(JSON.stringify({ coverColorOwners, rowGeometry, shots }, null, 2));
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
