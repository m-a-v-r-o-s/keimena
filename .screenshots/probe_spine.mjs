// Spine gate: late textures, and the end-on profile.
//
// Two things are checked here that nothing else checks.
//
// 1. TEXTURES THAT ARRIVE LATE. The blank spines were a race -- if a cover
//    sheet landed after its material had already compiled, the map was ignored
//    and the base colour was all that rendered. On a fast local server that
//    almost never happens, which is exactly why it survived. So the network is
//    throttled hard on purpose: every sheet is guaranteed to arrive long after
//    first paint, and the failure becomes deterministic instead of occasional.
//
// 2. THE PROFILE, SEEN END-ON. The stack shows a book's head at its left end,
//    which is where the spine's shape actually reads. Captured at scale 4 so
//    the two joints can be counted.
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:3000/el/';

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
const shot = async (name, clip, scale = 1) => {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip: { ...clip, scale } } : {}),
  });
  const p = `.screenshots/${name}.png`;
  writeFileSync(p, Buffer.from(s.data, 'base64'));
  return p;
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.enable');
await send('Network.enable');
/* Slow enough that a 40-request texture queue cannot possibly beat the first
   compile. This is the condition the bug needs, not an edge case. */
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 300,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
});

const errors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.text || m.params.exceptionDetails.exception?.description);
});

await send('Page.navigate', { url });

// Wait for the page's own readiness flag rather than a guessed sleep.
let loadedAfter = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await ev(`document.documentElement.hasAttribute('data-loaded')`)) {
    loadedAfter = i + 1;
    break;
  }
}
await ev(`(()=>{const s=document.createElement('style');
  s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})()`);
// And then a long grace period, so every spine sheet has landed.
await new Promise((r) => setTimeout(r, 12000));

/* The throttle has done its job -- every material compiled long before its map
   arrived, which is the condition under test. Lift it now: what follows is
   photography, and this Chrome is on software WebGL, where a demand-driven
   canvas under a 400kbps cap simply does not have a frame ready to capture. */
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await new Promise((r) => setTimeout(r, 2500));

await ev(`window.scrollTo(0, 1200)`);
await new Promise((r) => setTimeout(r, 2500));
/* Nudge, so the demand loop is guaranteed to have drawn this viewport. */
await ev(`window.scrollBy(0, 2); window.scrollBy(0, -2)`);
await new Promise((r) => setTimeout(r, 1500));

const stack = await shot('sp_stack');

// The head end of each visible book: its left edge, where the profile shows.
const slots = await ev(`(() => [...document.querySelectorAll('[data-book-slot]')]
  .map(e => { const r = e.getBoundingClientRect();
    return { id: e.dataset.bookSlot, x: Math.round(r.left), y: Math.round(r.top),
             w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter(s => s.y > 40 && s.y + s.h < 880))()`);

if (!Array.isArray(slots)) { console.log('SLOTS RAW:', JSON.stringify(slots)); process.exit(2); }
const ends = [];
for (const s of slots.slice(0, 3)) {
  ends.push(
    await shot(
      `sp_end_${s.id.slice(0, 12)}`,
      { x: s.x - 10, y: s.y - 10, width: 150, height: s.h + 20 },
      4
    )
  );
}

console.log(
  JSON.stringify(
    {
      loadedAfterSeconds: loadedAfter,
      throttled: '400kbps / 300ms latency',
      consoleErrors: errors,
      booksInView: slots.length,
      shots: { stack, ends },
    },
    null,
    2
  )
);
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
