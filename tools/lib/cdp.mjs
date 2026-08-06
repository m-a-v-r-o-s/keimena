/**
 * A minimal Chrome DevTools Protocol client -- the same shape
 * tools/render-check.mjs already hand-rolls (plain WebSocket, id-keyed
 * request/response), pulled out so tools/perf-check.mjs and tools/shots.mjs
 * don't each reinvent it. No new dependency: CDP is just JSON over a
 * WebSocket, which node has built in.
 *
 * Needs a debuggable Chrome already listening on 127.0.0.1:9222 (same
 * expectation render-check.mjs has).
 */
export async function openTab() {
  const page = await (
    await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  ).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map(); // method -> Set<fn>

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
      return;
    }
    if (m.method && listeners.has(m.method)) {
      for (const fn of listeners.get(m.method)) fn(m.params);
    }
  };
  await new Promise((res) => (ws.onopen = res));

  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
    return () => listeners.get(method).delete(fn);
  };

  const evaluate = async (expression, { awaitPromise = false } = {}) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  };

  const close = async () => {
    ws.close();
    await fetch(`http://127.0.0.1:9222/json/close/${page.id}`);
  };

  return { send, on, evaluate, close, id: page.id };
}

/**
 * Polls `expression` (must evaluate truthy/falsy) until true or `timeoutMs`
 * elapses. A navigation destroys and recreates the page's execution context
 * partway through this loop, and an evaluate that lands in that gap throws
 * (its own document briefly gone) rather than answering false -- that is not
 * a real failure, just a poll that landed at a bad moment, so it is swallowed
 * and retried instead of aborting the whole wait.
 */
export async function waitFor(tab, expression, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await tab.evaluate(expression)) return true;
    } catch {
      /* mid-navigation context churn -- retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
