// Phase 1 gate: drag, spring-return, and DOM lock.
// Drives a real pointer gesture across a book and samples the rendered pixels
// before, during and after, so "it rotates and springs back" is measured rather
// than asserted.
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:3000/el/';
const scrollTo = Number(process.argv[3] || 0);

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
await evalJs(`(() => {
  const s = document.createElement('style');
  s.textContent = 'nextjs-portal{display:none !important}';
  document.head.appendChild(s); return true;
})()`);

await evalJs(`window.scrollTo(0, ${scrollTo})`);
await new Promise((r) => setTimeout(r, 1500));

// Where the DOM says the book is. The volume must be drawn over this box.
const slot = await evalJs(`(() => {
  const els=[...document.querySelectorAll('[data-book-slot]')];
  const vis = els.find(e => { const r=e.getBoundingClientRect();
    return r.top > -r.height && r.top < window.innerHeight - 40; });
  if(!vis) return null;
  const r=vis.getBoundingClientRect();
  return { id: vis.dataset.bookSlot, left:Math.round(r.left), top:Math.round(r.top),
           w:Math.round(r.width), h:Math.round(r.height),
           cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2) };
})()`);

if (!slot) { console.log(JSON.stringify({ error: 'no visible slot' })); process.exit(1); }

const cap = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = `.screenshots/p1_drag_${name}.png`;
  writeFileSync(p, Buffer.from(s.data, 'base64'));
  return p;
};

const before = await cap('before');

// Drag right across the book.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: slot.cx, y: slot.cy });
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: slot.cx, y: slot.cy, button: 'left', clickCount: 1,
});
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: slot.cx + i * 22, y: slot.cy + i * 3, button: 'left',
  });
  await new Promise((r) => setTimeout(r, 60));
}
const dragging = await evalJs(
  `document.documentElement.classList.contains('is-dragging')`
);
const during = await cap('during');

await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: slot.cx + 176, y: slot.cy + 24, button: 'left', clickCount: 1,
});
await new Promise((r) => setTimeout(r, 2500));
const after = await cap('after');
const navigated = await evalJs(`location.pathname`);

console.log(JSON.stringify(
  { slot, gotDraggingClass: dragging, navigatedTo: navigated, shots: { before, during, after } },
  null, 2
));
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
