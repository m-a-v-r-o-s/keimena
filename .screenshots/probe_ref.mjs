// Phase 0 reference study: press.stripe.com, live, over CDP.
//
// D6 exists because a markdown-converted fetch dropped the stylesheets and the
// palette was read wrong for a whole session. This probe only reports what the
// live runtime says: real computed styles, real canvas/WebGL presence, real
// pointer behaviour. Nothing here is inferred.
const url = process.argv[2] || 'https://press.stripe.com/';
const width = Number(process.argv[3] || 1440);
const height = Number(process.argv[4] || 900);

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
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));

const evalJs = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 500,
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 6000));

const report = {};

// 1. Rendering substrate: is the shelf WebGL, and how many contexts?
report.substrate = await evalJs(`(() => {
  const canvases = [...document.querySelectorAll('canvas')].map(c => ({
    w: c.width, h: c.height,
    css: c.getBoundingClientRect().width + 'x' + Math.round(c.getBoundingClientRect().height),
    pos: getComputedStyle(c).position,
    z: getComputedStyle(c).zIndex,
    pointerEvents: getComputedStyle(c).pointerEvents,
    cls: c.className || null,
    parentCls: c.parentElement ? c.parentElement.className : null,
  }));
  return {
    canvasCount: canvases.length,
    canvases,
    hasThree: typeof window.THREE !== 'undefined',
    bodyClasses: document.body.className,
    htmlClasses: document.documentElement.className,
  };
})()`);

// 2. The colour takeover: which custom properties actually drive the page.
report.customProps = await evalJs(`(() => {
  const read = (el) => {
    const out = {};
    const cs = getComputedStyle(el);
    for (const name of cs) {
      if (name.startsWith('--')) out[name] = cs.getPropertyValue(name).trim().slice(0, 90);
    }
    return out;
  };
  return {
    root: read(document.documentElement),
    body: read(document.body),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
  };
})()`);

// 3. Book DOM: what wraps each object, and what the non-WebGL fallback is.
report.bookDom = await evalJs(`(() => {
  const guess = [...document.querySelectorAll('[class*="Book"], [class*="book"], [class*="Product"]')]
    .slice(0, 40)
    .map(e => ({
      tag: e.tagName.toLowerCase(),
      cls: (e.className || '').toString().slice(0, 120),
      rect: (() => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })(),
      transform: getComputedStyle(e).transform.slice(0, 60),
      perspective: getComputedStyle(e).perspective,
      transformStyle: getComputedStyle(e).transformStyle,
    }));
  return { count: guess.length, sample: guess };
})()`);

// 4. Idle behaviour: sample the canvas over 2s with no input. If the pixels
//    never change, books are motionless at rest (REDESIGN §2.4).
report.idle = await evalJs(`(async () => {
  const c = document.querySelector('canvas');
  if (!c) return 'no-canvas';
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  let frames = 0;
  const raf = window.requestAnimationFrame;
  const t0 = performance.now();
  await new Promise(res => {
    const tick = () => { frames++; if (performance.now() - t0 < 2000) raf(tick); else res(); };
    raf(tick);
  });
  return {
    glContextLive: !!gl,
    rafFramesIn2s: frames,
    note: 'rAF frames only prove the page ticks, not that the scene changes',
  };
})()`, true);

// 5. Scroll behaviour: sample scroll position vs body background over a walk.
report.scrollWalk = await evalJs(`(async () => {
  const samples = [];
  const max = document.body.scrollHeight;
  const step = window.innerHeight * 0.75;
  for (let y = 0; y < Math.min(max, window.innerHeight * 9); y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 420));
    const cs = getComputedStyle(document.body);
    samples.push({
      y: Math.round(y),
      bg: cs.backgroundColor,
      coverColor: cs.getPropertyValue('--coverColor').trim(),
      backgroundColor: cs.getPropertyValue('--backgroundColor').trim(),
      scrollY: Math.round(window.scrollY),
    });
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 600));
  return samples;
})()`, true);

// 6. Scroll hijack check: does the page write scrollTop itself?
report.scrollHijack = await evalJs(`(() => {
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  return {
    htmlOverflow: html.overflow, bodyOverflow: body.overflow,
    htmlHeight: html.height, bodyHeight: body.height,
    bodyPosition: body.position,
    scrollBehavior: html.scrollBehavior,
    docScrollHeight: document.body.scrollHeight,
    viewportH: window.innerHeight,
    ratio: +(document.body.scrollHeight / window.innerHeight).toFixed(1),
  };
})()`);

// 7. Drag: synthesize a pointer drag across the first book and watch for a
//    dragging state flag and a transform/uniform change.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width / 2, y: height / 2 });
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: width / 2, y: height / 2, button: 'left', clickCount: 1,
});
const dragStates = [];
for (let i = 1; i <= 6; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: width / 2 + i * 28, y: height / 2, button: 'left',
  });
  await new Promise((r) => setTimeout(r, 90));
  dragStates.push(
    await evalJs(`(() => {
      const cs = getComputedStyle(document.body);
      return {
        isDragging: cs.getPropertyValue('--isDragging').trim(),
        cursor: cs.cursor,
        bodyCls: document.body.className.slice(0, 120),
      };
    })()`)
  );
}
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: width / 2 + 168, y: height / 2, button: 'left', clickCount: 1,
});
await new Promise((r) => setTimeout(r, 900));
report.drag = {
  duringDrag: dragStates,
  afterRelease: await evalJs(`(() => {
    const cs = getComputedStyle(document.body);
    return { isDragging: cs.getPropertyValue('--isDragging').trim(), cursor: cs.cursor };
  })()`),
};

// 8. Type + motion tokens worth carrying over as evidence.
report.typography = await evalJs(`(() => {
  const els = [...document.querySelectorAll('h1,h2,h3,p,a')].slice(0, 14);
  return els.map(e => {
    const cs = getComputedStyle(e);
    return {
      tag: e.tagName.toLowerCase(),
      family: cs.fontFamily.slice(0, 60),
      size: cs.fontSize, weight: cs.fontWeight,
      tracking: cs.letterSpacing, leading: cs.lineHeight,
      text: (e.textContent || '').trim().slice(0, 40),
    };
  });
})()`);

console.log(JSON.stringify(report, null, 2));
ws.close();
await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
