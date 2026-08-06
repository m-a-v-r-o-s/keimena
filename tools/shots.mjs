#!/usr/bin/env node
/**
 * The visual gate.
 *
 *   node tools/shots.mjs capture <label>            -- shoot the fixed set
 *   node tools/shots.mjs compare <label> [baseline]  -- diff against a
 *                                                        previously captured
 *                                                        set (default:
 *                                                        "baseline")
 *
 * Same production-export discipline as tools/perf-check.mjs: starts a static
 * server over `out/`, never `next dev`.
 *
 * `prefers-reduced-motion` is forced to `no-preference` -- the reduced-motion
 * path in BookVolume.jsx sets pose directly with no easing, which is not
 * what most readers see and not what this gate exists to protect.
 *
 * Every state is shot only once it has actually stopped moving, confirmed by
 * SAMPLING THE CANVAS rather than guessing a delay: a fixed wait after
 * `data-loaded` was tried first and failed -- BookVolume's own slerp/size
 * easing (EASE, SIZE_EASE in BookVolume.jsx) plus the font-swap reflow
 * BookCanvas.jsx's own comment describes ("fonts settle after first paint and
 * move the slots with them") land at a real but VARIABLE wall-clock time,
 * cold-cache runs slower than warm ones, so any fixed number caught two runs
 * of the identical page at two different points of the same motion and
 * reported a false regression. Screenshotting on an interval and stopping
 * once several consecutive frames agree is what "settled" actually means,
 * and it costs nothing when the page is already still (home-1440-y2400,
 * nothing left to ease, converges on the first sample).
 *
 * STABLE_STREAK is deliberately generous (3s of continuous agreement, not
 * one lull) and MAX_SAMPLES deliberately long (up to 40s) -- confirmed
 * necessary, not just cautious, by comparing this same route against a
 * disposable `git worktree` built from HEAD: the homepage shelf has a real
 * settle tail that runs 15-20s past `data-loaded` in this project's headless
 * CDP test environment (texture arrival for slots at the edge of the
 * loader's wait-list, well after the loader itself has cleared), present
 * identically in both builds. A short streak requirement can mistake a brief
 * lull in that tail for done, and because the two builds' covers load at
 * different speeds, they land on different POINTS of the same tail -- which
 * reads as a false visual regression between builds that are, once both are
 * actually finished settling, pixel-identical. See DECISIONS.md for the
 * fuller account. (This tail's exact length is a property of this
 * environment's software-rendered WebGL, not a claim about real hardware.)
 *
 * Per plan.md Phase 0.2, the fixed set:
 *   - /                      1440x900, scrolled to 0
 *   - /                      1440x900, scrolled to 2400
 *   - /                      390x844,  scrolled to 0
 *   - /books/faust/          1440x900
 *   - /books/nychterino-deltio/ 1440x900
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { startServer } from './lib/static-server.mjs';
import { openTab, waitFor } from './lib/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_ROOT = join(ROOT, '.screenshots/perf');
const SCROLL_SETTLE_MS = 400;
const SAMPLE_INTERVAL_MS = 200;
const MAX_SAMPLES = 200; // ~40s worst case per state before giving up and using the last frame
const STABLE_STREAK = 15; // consecutive matching samples required to call it settled (3s)
/* A perceptible diff, not a bit-exact one: PNG re-encode and WebGL AA jitter
   a handful of edge pixels even between two genuinely identical frames. */
const STABLE_MEAN = 0.05;
const STABLE_DIFFPCT = 0.05;
const GATE_MEAN = 0.15;
const GATE_DIFFPCT = 0.5;

const STATES = [
  { name: 'home-1440-y0', route: '/', width: 1440, height: 900, scrollY: 0 },
  { name: 'home-1440-y2400', route: '/', width: 1440, height: 900, scrollY: 2400 },
  { name: 'home-390-y0', route: '/', width: 390, height: 844, scrollY: 0, mobile: true },
  { name: 'book-faust-1440', route: '/books/faust/', width: 1440, height: 900, scrollY: 0 },
  {
    name: 'book-nychterino-deltio-1440',
    route: '/books/nychterino-deltio/',
    width: 1440,
    height: 900,
    scrollY: 0,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-pixel, per-channel absolute delta between two PNG sources (path or Buffer). */
async function pixelDiff(inputA, inputB) {
  const [{ data: dA, info: infoA }, { data: dB, info: infoB }] = await Promise.all([
    sharp(inputA).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(inputB).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (infoA.width !== infoB.width || infoA.height !== infoB.height) {
    return { sizeMismatch: true, infoA, infoB };
  }

  const totalPixels = infoA.width * infoA.height;
  const diffBuf = Buffer.alloc(totalPixels * 3);
  let sumDelta = 0;
  let maxDelta = 0;
  let diffPixels = 0;

  for (let p = 0; p < totalPixels; p++) {
    const o = p * 4;
    let pixelMax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(dA[o + c] - dB[o + c]);
      sumDelta += d;
      if (d > maxDelta) maxDelta = d;
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > 8) diffPixels++; // small AA/dither tolerance
    const g = Math.min(255, pixelMax * 4); // amplified so a small diff stays visible
    diffBuf[p * 3] = g;
    diffBuf[p * 3 + 1] = pixelMax > 8 ? 0 : g;
    diffBuf[p * 3 + 2] = pixelMax > 8 ? 0 : g;
  }

  return {
    meanDelta: sumDelta / (totalPixels * 3),
    maxDelta,
    diffPct: (diffPixels / totalPixels) * 100,
    width: infoA.width,
    height: infoA.height,
    diffBuf,
  };
}

async function shootState(baseUrl, state) {
  const tab = await openTab();
  await tab.send('Page.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', {
    width: state.width,
    height: state.height,
    deviceScaleFactor: 1,
    mobile: !!state.mobile,
  });
  /* Real motion, not the reduced-motion shortcut -- see file header. */
  await tab.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  /* A background tab gets its rAF loop throttled by Chrome's page-visibility
     heuristics, which starves BookVolume's own easing (useFrame) of frames --
     foregrounding it keeps it running at full rate, like a tab a reader is
     actually looking at. */
  await tab.send('Page.bringToFront');
  await tab.send('Page.navigate', { url: `${baseUrl}${state.route}` });
  await waitFor(tab, "document.documentElement.hasAttribute('data-loaded')", { timeoutMs: 15000 });
  await tab.evaluate('document.fonts.ready.then(() => true)', { awaitPromise: true });

  if (state.scrollY) {
    await tab.evaluate(`window.scrollTo(0, ${state.scrollY})`);
    await sleep(SCROLL_SETTLE_MS);
  }

  let prev = null;
  let final = null;
  let streak = 0;
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    if (prev) {
      const d = await pixelDiff(prev, buf);
      if (!d.sizeMismatch && d.meanDelta <= STABLE_MEAN && d.diffPct <= STABLE_DIFFPCT) {
        streak++;
        if (streak >= STABLE_STREAK) {
          final = buf;
          break;
        }
      } else {
        streak = 0;
      }
    }
    prev = buf;
    await sleep(SAMPLE_INTERVAL_MS);
  }
  if (!final) {
    console.warn(`  ! ${state.name}: did not visually settle within ${MAX_SAMPLES * SAMPLE_INTERVAL_MS}ms -- using the last frame anyway`);
    final = prev;
  }

  await tab.close();
  return final;
}

async function capture(label) {
  const dir = join(SHOTS_ROOT, label);
  mkdirSync(dir, { recursive: true });
  const srv = await startServer(join(ROOT, 'out'), 3001);
  console.log(`serving out/ at http://127.0.0.1:${srv.port}`);
  for (const state of STATES) {
    const buf = await shootState(`http://127.0.0.1:${srv.port}`, state);
    const file = join(dir, `${state.name}.png`);
    writeFileSync(file, buf);
    console.log(`  ${state.name}.png  (${(buf.length / 1024).toFixed(0)}K)`);
  }
  await srv.close();
  console.log(`\ncaptured to ${dir}`);
}

async function compare(label, baselineLabel) {
  const dir = join(SHOTS_ROOT, label);
  const baseDir = join(SHOTS_ROOT, baselineLabel);
  if (!existsSync(baseDir)) {
    console.error(`no baseline set at ${baseDir} -- run "capture ${baselineLabel}" first`);
    process.exit(1);
  }

  console.log(`comparing ${label}  vs  ${baselineLabel}`);
  console.log('='.repeat(74));
  let anyFail = false;

  for (const state of STATES) {
    const a = join(baseDir, `${state.name}.png`);
    const b = join(dir, `${state.name}.png`);
    if (!existsSync(a) || !existsSync(b)) {
      console.log(`  ${state.name.padEnd(30)} MISSING (${!existsSync(a) ? baselineLabel : label})`);
      anyFail = true;
      continue;
    }

    const d = await pixelDiff(a, b);
    if (d.sizeMismatch) {
      console.log(
        `  ${state.name.padEnd(30)} SIZE MISMATCH (${d.infoA.width}x${d.infoA.height} vs ${d.infoB.width}x${d.infoB.height})`
      );
      anyFail = true;
      continue;
    }

    const fail = d.meanDelta > GATE_MEAN || d.diffPct > GATE_DIFFPCT;
    if (fail) {
      anyFail = true;
      const diffDir = join(SHOTS_ROOT, `${label}-diff`);
      mkdirSync(diffDir, { recursive: true });
      await sharp(d.diffBuf, { raw: { width: d.width, height: d.height, channels: 3 } })
        .png()
        .toFile(join(diffDir, `${state.name}.png`));
    }

    console.log(
      `  ${state.name.padEnd(30)} mean ${d.meanDelta.toFixed(3).padStart(6)}  max ${String(d.maxDelta).padStart(3)}  diffpx ${d.diffPct.toFixed(2).padStart(5)}%  ${fail ? 'FAIL' : 'ok'}`
    );
  }

  console.log();
  if (anyFail) {
    console.log('GATE FAILED -- a visible pixel diff is a failed phase, whatever the byte count says.');
    process.exit(1);
  }
  console.log('GATE PASSED -- screenshots indistinguishable from baseline.');
}

const [, , cmd, label, baselineLabel] = process.argv;
if (!cmd || !label || !['capture', 'compare'].includes(cmd)) {
  console.error('usage: node tools/shots.mjs capture <label>');
  console.error('       node tools/shots.mjs compare <label> [baselineLabel=baseline]');
  process.exit(1);
}

if (cmd === 'capture') await capture(label);
else await compare(label, baselineLabel ?? 'baseline');
