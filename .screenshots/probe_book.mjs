// Diagnose computed styles on the live page via CDP (node 24 has native WebSocket).
const target = process.argv[2] || 'http://localhost:4173/el/';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = list.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:4173'));
if (!page) {
  page = await (
    await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(target)}`, { method: 'PUT' })
  ).json();
}

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
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: target });
await new Promise((r) => setTimeout(r, 6000));

const expr = `
(() => {
  const out = {};
  const probe = (label, sel) => {
    const el = document.querySelector(sel);
    if (!el) { out[label] = 'MISSING'; return; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out[label] = {
      opacity: cs.opacity,
      color: cs.color,
      bg: cs.backgroundColor,
      fontFamily: cs.fontFamily.slice(0, 40),
      fontSize: cs.fontSize,
      w: Math.round(r.width), h: Math.round(r.height),
      text: (el.textContent || '').trim().slice(0, 30),
    };
  };
  probe('h1', '.bookhead__title');
  probe('metarow', '.bookhead .meta-row');
  probe('bookFace', '.bookhead__object .book__face');
  probe('prose', '.prose');
  probe('buy', '.buy__row a');
  out.bodyClass = document.body.className;
  out.htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  out.groundVar = getComputedStyle(document.documentElement).getPropertyValue('--book-ground').trim();
  out.revealCount = document.querySelectorAll('.reveal').length;
  out.revealHidden = [...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity === '0').length;
  out.gsapLoaded = typeof window.gsap !== 'undefined';
  return JSON.stringify(out, null, 1);
})()
`;

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(res.result?.value ?? JSON.stringify(res).slice(0, 600));
ws.close();
