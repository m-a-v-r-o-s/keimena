#!/usr/bin/env node
/**
 * The byte-budget gate.
 *
 *   node tools/perf-check.mjs                 -- measure, compare to the
 *                                                 recorded budget, fail >2%
 *   node tools/perf-check.mjs --save           -- measure and (re)write the
 *                                                 budget file from this run
 *   node tools/perf-check.mjs --url=http://... -- measure against an
 *                                                 already-running server
 *                                                 instead of starting one
 *
 * Always measures the real static export in out/ -- never `next dev` (see
 * plan.md Phase 0: dev-mode SSR places things differently and inflates every
 * JS number, which makes a claim measured there worthless). Starts its own
 * static file server over `out/` on 3001 (never 3000 -- that port is never
 * ours to bind or free) unless --url points somewhere already listening.
 *
 * Every response is bucketed by CDP's own resource `type` -- document,
 * script, stylesheet, font, image, other -- and each bucket carries two
 * numbers: RAW (the uncompressed byte count, recovered from the
 * `X-Raw-Length` header tools/lib/static-server.mjs stamps on every
 * response) and GZ (what actually crossed the wire -- `encodedDataLength`,
 * gzip for text, untouched for anything already compressed). GZ is the
 * number the budget is measured against, because that is the number a
 * reader's connection actually pays for.
 *
 * `data-loaded` is BookCanvas.jsx's own signal that the renderer and the
 * covers a reader can see are ready -- see events.js and BookCanvas.jsx's
 * final effect. Time-to-loaded is measured against that, not against the
 * network idling, because idling and "the reader can see the shelf" are two
 * different moments on this site (that gap is what Phase 2 exists to close).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/static-server.mjs';
import { openTab, waitFor } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'tools/perf-baseline.json');
const ROUTES = ['/', '/books/faust/'];
const BUDGET_SLACK = 1.02; // 2% over the recorded budget fails the gate

const args = process.argv.slice(2);
const save = args.includes('--save');
const urlArg = args.find((a) => a.startsWith('--url='))?.slice('--url='.length);

const TYPE_BUCKET = {
  Document: 'document',
  Script: 'script',
  Stylesheet: 'stylesheet',
  Font: 'font',
  Image: 'image',
};
const bucketFor = (cdpType) => TYPE_BUCKET[cdpType] ?? 'other';
const BUCKETS = ['document', 'script', 'stylesheet', 'font', 'image', 'other'];

function headerLen(headers, name) {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name);
  return key ? Number(headers[key]) : null;
}

async function measureRoute(baseUrl, route) {
  const tab = await openTab();
  const meta = new Map(); // requestId -> { type, rawLen }
  const finished = new Map(); // requestId -> encodedDataLength

  tab.on('Network.responseReceived', (p) => {
    meta.set(p.requestId, {
      type: p.type,
      rawLen: headerLen(p.response.headers, 'x-raw-length'),
      url: p.response.url,
    });
  });
  tab.on('Network.loadingFinished', (p) => {
    finished.set(p.requestId, p.encodedDataLength);
  });

  await tab.send('Network.enable');
  await tab.send('Network.setCacheDisabled', { cacheDisabled: true });
  await tab.send('Page.enable');

  const t0 = Date.now();
  await tab.send('Page.navigate', { url: `${baseUrl}${route}` });
  const loaded = await waitFor(tab, "document.documentElement.hasAttribute('data-loaded')", {
    timeoutMs: 15000,
  });
  const timeToLoadedMs = Date.now() - t0;
  /* Let trailing loadingFinished events for late resources land before reading. */
  await new Promise((r) => setTimeout(r, 300));

  const fcpMs = await tab.evaluate(
    "performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime ?? null"
  );

  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, { raw: 0, gz: 0, count: 0 }]));
  for (const [id, m] of meta) {
    const gz = finished.get(id) ?? 0;
    const raw = m.rawLen ?? gz;
    const b = buckets[bucketFor(m.type)];
    b.raw += raw;
    b.gz += gz;
    b.count += 1;
  }

  await tab.close();
  return { route, loaded, timeToLoadedMs, fcpMs, buckets };
}

function printReport(results) {
  for (const r of results) {
    console.log(`\n${r.route}`);
    console.log('='.repeat(74));
    if (!r.loaded) console.log('  WARNING: data-loaded never fired within 15s');
    console.log(`  time to data-loaded : ${r.timeToLoadedMs} ms`);
    console.log(`  first contentful paint : ${r.fcpMs == null ? 'n/a' : `${Math.round(r.fcpMs)} ms`}`);
    console.log();
    console.log(`  ${'bucket'.padEnd(12)}${'count'.padStart(7)}${'raw'.padStart(11)}${'gz (wire)'.padStart(13)}`);
    let totalRaw = 0;
    let totalGz = 0;
    for (const b of BUCKETS) {
      const { raw, gz, count } = r.buckets[b];
      totalRaw += raw;
      totalGz += gz;
      if (!count) continue;
      console.log(
        `  ${b.padEnd(12)}${String(count).padStart(7)}${fmt(raw).padStart(11)}${fmt(gz).padStart(13)}`
      );
    }
    console.log('  ' + '-'.repeat(43));
    console.log(`  ${'total'.padEnd(12)}${''.padStart(7)}${fmt(totalRaw).padStart(11)}${fmt(totalGz).padStart(13)}`);
  }
}

const fmt = (bytes) => (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}K` : `${bytes}B`);

function compareToBaseline(results, baseline) {
  let failed = false;
  console.log('\nBUDGET GATE (vs tools/perf-baseline.json, wire bytes, +2% tolerance)');
  console.log('='.repeat(74));
  for (const r of results) {
    const base = baseline.routes?.[r.route];
    if (!base) {
      console.log(`  ${r.route}: no recorded budget -- run with --save first`);
      continue;
    }
    for (const b of BUCKETS) {
      const now = r.buckets[b].gz;
      const was = base.buckets[b]?.gz ?? 0;
      if (was === 0 && now === 0) continue;
      const limit = was * BUDGET_SLACK;
      const over = now > limit;
      if (over) failed = true;
      const pct = was ? (((now - was) / was) * 100).toFixed(1) : 'new';
      console.log(
        `  ${r.route.padEnd(20)}${b.padEnd(12)}now ${fmt(now).padStart(8)}  budget ${fmt(was).padStart(8)}  ${pct}%  ${over ? 'FAIL' : 'ok'}`
      );
    }
  }
  return failed;
}

async function main() {
  if (!existsSync(join(ROOT, 'out/index.html'))) {
    console.error('out/ has no build -- run `npm run build` first.');
    process.exit(1);
  }

  let close = async () => {};
  let baseUrl = urlArg;
  if (!baseUrl) {
    const srv = await startServer(join(ROOT, 'out'), 3001);
    baseUrl = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
    console.log(`serving out/ at ${baseUrl}`);
  }

  const results = [];
  for (const route of ROUTES) results.push(await measureRoute(baseUrl, route));
  await close();

  printReport(results);

  const record = {
    capturedAt: new Date().toISOString(),
    routes: Object.fromEntries(
      results.map((r) => [
        r.route,
        { timeToLoadedMs: r.timeToLoadedMs, fcpMs: r.fcpMs, buckets: r.buckets },
      ])
    ),
  };

  if (save || !existsSync(BASELINE_PATH)) {
    writeFileSync(BASELINE_PATH, JSON.stringify(record, null, 2) + '\n');
    console.log(`\nbaseline written to ${BASELINE_PATH}`);
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const failed = compareToBaseline(results, baseline);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
