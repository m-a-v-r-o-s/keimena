// Scroll the whole page (firing every ScrollTrigger), settle, then capture
// full-page. A naive headless screenshot catches scroll-reveals mid-flight and
// reports missing content that a real user would see.
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3];
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);

const page = await (
  await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
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

await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: width < 500,
});
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 3500));

// Walk down the page so every ScrollTrigger fires, then return to the top.
await send('Runtime.evaluate', {
  expression: `(async () => {
    const step = window.innerHeight * 0.6;
    const max = document.body.scrollHeight;
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 180));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 900));
    return document.querySelectorAll('.reveal[style*="opacity: 0"]').length;
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

await new Promise((r) => setTimeout(r, 1200));

const hidden = await send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity !== '1').length + '/' + document.querySelectorAll('.reveal').length`,
  returnByValue: true,
});

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});

writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`${out}  still-hidden reveals: ${hidden.result.value}`);
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
