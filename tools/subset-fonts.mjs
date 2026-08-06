#!/usr/bin/env node
/**
 * Subset and self-host this site's two static-weight faces -- plan.md
 * Phase 4.2. Didot and JetBrains Mono only: Literata was tried the same way
 * (both upright and italic; see the git history around this file for the
 * two-file-split italic attempt) and measured WORSE self-hosted than
 * Google's own delivery for this page, for structural reasons -- a
 * genuinely two-axis variable font, used across its full weight range, does
 * not shrink much by subsetting the glyph set alone, since gvar's cost
 * tracks the axes kept, not the glyph count. See app/layout.jsx's own
 * comment on the `literata` call for the full account. Reverted rather than
 * kept at a real, measured cost, the same call Phase 3.1 made for three.js
 * tree-shaking.
 *
 *   node tools/glyphs.mjs && node tools/subset-fonts.mjs
 *
 * Runs `tools/.venv/bin/pyftsubset` (fonttools, installed into a venv per
 * the plan -- Debian's system Python is externally managed) against the
 * codepoint set `tools/glyphs.mjs` derived, writing WOFF2 straight to
 * `fonts/` (app/layout.jsx imports from there -- see OUT_DIR below for why
 * not `public/`).
 *
 * Two things were easy to get wrong here and both are load-bearing enough to
 * be worth restating even with only two faces left:
 *
 *  - KEEP THE VARIABLE AXES for JetBrains Mono ([wght] alone) -- subset, do
 *    not instance (no --instance flag), so fvar/gvar/HVAR survive.
 *  - LAYOUT FEATURES: NOT `--layout-features=*`, despite that being the
 *    plan's own literal suggestion. Left unset instead, which uses
 *    pyftsubset's own default set (kern/mark/mkmk/liga/ccmp/locl and a
 *    generous rest) -- see the long comment inside `subset()` below for the
 *    two separate ways `*` went wrong in practice before landing here.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PYFTSUBSET = join(ROOT, 'tools/.venv/bin/pyftsubset');
/* NOT public/ -- next/font/local processes its own src file (fingerprints
   it, computes fallback-face metrics from it, emits its own copy into the
   build), so it wants a relative import path to a source file, not a static
   asset already sitting in the public tree. app/layout.jsx imports from
   here. */
const OUT_DIR = join(ROOT, 'fonts');

mkdirSync(OUT_DIR, { recursive: true });

const unicodes = readFileSync(join(ROOT, 'tools/glyphs.txt'), 'utf8').trim();
if (!unicodes) {
  console.error('tools/glyphs.txt is empty -- run node tools/glyphs.mjs first.');
  process.exit(1);
}

function subset(input, output) {
  const args = [
    input,
    `--unicodes=${unicodes}`,
    `--output-file=${output}`,
    '--flavor=woff2',
    /* NOT --layout-features=* (plan.md's own suggestion). Two things wrong
       with that in practice, found in order:
       1. Passed through execFileSync with shell:false, `--layout-features=
          '*'` (the plan's own shell-typed form) reaches pyftsubset with the
          quote characters INSIDE the argument -- not the wildcard, a
          literal unmatched feature tag -- and it silently kept none of
          GSUB/GPOS's actual lookups. Caught by a real, visible symptom: a
          paragraph reflowing (verified with a controlled two-font width
          measurement, ~1.6% wider per line with the broken build) once
          Greek kerning quietly vanished.
       2. Fixing the quoting and actually passing the wildcard made it
          WORSE, not better -- literata.woff2 alone came out to 168KB,
          bigger than Google's own separately-hosted latin+greek chunks
          COMBINED (72KB) for the same weight. `*` keeps every GSUB feature,
          not just the ones the plan actually cares about (kern, mark,
          mkmk) -- small caps, stylistic sets, fractions, ordinals, slashed
          zero, none of which any CSS on this site ever turns on -- and
          pyftsubset's GSUB closure pulls in every alternate glyph those
          features could ever substitute, ballooning the glyph count from
          the requested ~500 codepoints to 679 actual glyphs.
       Leaving --layout-features unset uses pyftsubset's own default set,
       which already includes kern/mark/mkmk/liga/ccmp/locl -- exactly the
       plan's stated concern -- and excludes the decorative extras. */
  ];
  execFileSync(PYFTSUBSET, args, { stdio: 'inherit', shell: false });
  console.log(`  -> ${output}`);
}

console.log('Didot (static, weight 400)');
subset(join(ROOT, 'tools/fonts/GFSDidot-Regular.ttf'), join(OUT_DIR, 'gfs-didot.woff2'));

console.log('JetBrains Mono (variable, wght)');
subset(join(ROOT, "tools/fonts/JetBrainsMono[wght].ttf"), join(OUT_DIR, 'jetbrains-mono.woff2'));

console.log('\ndone. (Literata stays on next/font/google -- see file header.)');
