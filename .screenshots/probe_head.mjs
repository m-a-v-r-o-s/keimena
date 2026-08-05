// The spine seen END-ON.
//
// This is the one view that shows whether the spine is a bracket or a tube, and
// the stack does not offer it: lying flat with the spine toward the reader, a
// book's head points straight along the screen's X axis, so its end face is
// edge-on and effectively invisible. A horizontal drag swings that end toward
// the camera, which is how the reader sees it too.
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:3000/el/';
const swing = Number(process.argv[3] || 210);

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
  return r?.exceptionDetails ? { __e: r.exceptionDetails.exception?.description } : r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
});
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 9000));
await ev(`(()=>{const s=document.createElement('style');
  s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})()`);

await ev(`window.scrollTo(0, 1200)`);
await new Promise((r) => setTimeout(r, 2000));

const slot = await ev(`(() => {
  const els=[...document.querySelectorAll('[data-book-slot]')];
  const v = els.find(e => { const r=e.getBoundingClientRect();
    return r.top > 200 && r.top + r.height < 760; });
  if(!v) return null; const r=v.getBoundingClientRect();
  return { id:v.dataset.bookSlot, cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2) };
})()`);
if (!slot) {
  console.log(JSON.stringify({ error: 'no slot in band' }));
  process.exit(1);
}

// Hold the drag: released, the book springs back to its pose.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: slot.cx, y: slot.cy });
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: slot.cx,
  y: slot.cy,
  button: 'left',
  clickCount: 1,
});
for (let i = 1; i <= 14; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: slot.cx + (i * swing) / 14,
    y: slot.cy,
    button: 'left',
  });
  await new Promise((r) => setTimeout(r, 70));
}
await new Promise((r) => setTimeout(r, 2200));

const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('.screenshots/sp_head.png', Buffer.from(s.data, 'base64'));

console.log(JSON.stringify({ slot, swing, shot: '.screenshots/sp_head.png' }, null, 2));
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
