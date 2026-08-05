#!/usr/bin/env node
// Harvest press/interview/excerpt links from each licensed title's
// keimenabooks.gr product page, verify every link actually resolves, and
// emit content/press.json.
//
//   node tools/press.mjs            harvest + verify + write content/press.json
//   node tools/press.mjs --verify   gate: re-fetch every URL press.json actually
//                                   renders (dead ones excluded) and confirm 2xx
//
// Two phases, so a phase-2 (verify) failure never re-hammers the publisher:
// phase 1 fetches each buy_url into a cache and only reads that cache after;
// phase 2 is the only part that hits the network again on a re-run.
//
// The extraction rules below are transcribed from a recon pass that already
// read all 17 pages by hand (plan.md §2) -- do not re-derive them from a
// fresh reading of the HTML, the traps documented there are real:
//   - the interview-bullet block is identified by DOM region (a <span>
//     heading widget in the product summary), never by anchor text or domain
//   - the "read a PDF excerpt" link is a dead WordPress shortcode; the real
//     PDF URL lives in a DearFlip config <script> keyed by the same id
//   - the reviews slider duplicates every slide 3-6x in the raw markup
//     (responsive variants x swiper loop clones) and sometimes carries a
//     "(Διαβάστε περισσότερα)" label with no anchor at all (unlinkable --
//     dropped, since there is nothing to point a link at)
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = '/tmp/claude-1000/-home-akos-markaris-press/50299a01-3f2d-4427-ba0d-1cba88bbbfab/scratchpad';
const CACHE_DIR = join(SCRATCH, 'press-cache');
const RECON_CACHE_DIR = '/tmp/claude-1000/-home-akos-markaris-press/81d04e91-c684-442f-8ca5-bc7cfe6dcf83/scratchpad/pages';
const OUT_PATH = join(ROOT, 'content/press.json');
const TODAY = new Date().toISOString().slice(0, 10);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// §2e -- the recon's own expected-yield table, used only as a self-check
// against a bad extraction (a region silently dropped, or site chrome
// leaking in). Counts are the raw per-region harvest, before the
// cross-category dedupe §2e's own footnote calls for.
const EXPECTED = {
  'ola-gia-tin-anaptyxi': { interviews: 0, press: 0 },
  'i-apati-einai-to-mellon': { interviews: 1, press: 2 },
  'i-via-tis-apotychias': { interviews: 1, press: 5 },
  'i-exegersi-ton-karyatidon': { interviews: 0, press: 1 },
  'to-kinima-tis-aftoktonias': { interviews: 2, press: 4 },
  'o-fonos-einai-chrima': { interviews: 5, press: 10 },
  'i-epochi-tis-ypokrisias': { interviews: 0, press: 0 },
  'palia-poly-palia': { interviews: 0, press: 0 },
  'vasikos-metochos': { interviews: 0, press: 0 },
  'o-tse-aftoktonise': { interviews: 0, press: 0 },
  'amyna-zonis': { interviews: 0, press: 0 },
  'nychterino-deltio': { interviews: 0, press: 0 },
  'i-techni-tou-tromou': { interviews: 1, press: 5 },
  faust: { interviews: 2, press: 5 },
  'i-athina-tis-mias-diadromis': { interviews: 1, press: 3 },
  'istories-tou-kyriou-koiner': { interviews: 0, press: 0 },
  'istories-tis-allis-ochthis': { interviews: 1, press: 0 },
};
// Four titles genuinely carry no excerpt of either kind (§2c) -- confirmed
// twice: once against the recon's cached HTML, and again live via a
// headless-Chrome render (in case the flipbook script is lazily injected).
const NO_EXCERPT = new Set([
  'i-exegersi-ton-karyatidon',
  'vasikos-metochos',
  'i-athina-tis-mias-diadromis',
  'o-tse-aftoktonise',
]);

// ---------------------------------------------------------------------------
// Small helpers: no HTML-parser dependency, so entity decoding and tag
// stripping are hand-rolled against the fixed set this Elementor output uses.
// ---------------------------------------------------------------------------

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', hellip: '…', mdash: '—',
  ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ent in ENTITY_MAP ? ENTITY_MAP[ent] : m;
  });
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

// A "byline, outlet" or "byline - outlet" attribution line is parsed
// mechanically from a clear delimiter -- never guessed. Text that doesn't
// look like an attribution (parentheses, a mid-sentence period, or just
// long) is left unsplit: label_el keeps the full text, byline/outlet stay
// null rather than risk cutting a sentence in half on a stray comma (Greek
// decimal commas in a frequency like "98,4 FM" are exactly this trap). A
// period is only disqualifying next to whitespace (prose) -- a bare period
// inside a short token, e.g. the outlet name "Pod.gr", is not prose.
function looksLikeAttribution(s) {
  return s.length < 80 && !/[()]/.test(s) && !/\s\.|\.\s/.test(s);
}

function splitAttribution(label) {
  if (!looksLikeAttribution(label)) return { byline: null, outlet: null };
  const dash = label.search(/\s[-–—]\s(?=[^-–—]*$)/);
  if (dash !== -1) {
    return { byline: label.slice(0, dash).trim() || null, outlet: label.slice(dash + 3).trim() || null };
  }
  const comma = label.lastIndexOf(',');
  if (comma !== -1) {
    return { byline: label.slice(0, comma).trim() || null, outlet: label.slice(comma + 1).trim() || null };
  }
  return { byline: null, outlet: null };
}

// §2a bullets: "<bullet><byline>, <em>outlet</em>" is the common shape, but
// the bullet glyph varies (•, ~, -, none) and some books skip the <em> and
// just run "byline - outlet" as plain text. Parsed from the anchor's raw
// inner HTML so the <em> case can be read structurally before falling back
// to the same delimiter search splitAttribution uses.
function parseInterviewLabel(rawInner) {
  const label_el = stripTags(rawInner).replace(/^[•~-]\s*/, '').trim();
  const em = /^([\s\S]*?)<em>([\s\S]*?)<\/em>\s*$/.exec(rawInner.trim());
  if (em) {
    // The <em> itself is the structural signal here -- trust it over the
    // prose-shaped-text guard splitAttribution's plain-text fallback needs.
    const byline = stripTags(em[1]).replace(/^[•~-]\s*/, '').replace(/[\s,\-–—]+$/, '').trim();
    const outlet = stripTags(em[2]).trim();
    return { label_el, byline: byline || null, outlet: outlet || null };
  }
  return { label_el, ...splitAttribution(label_el) };
}

// §2d review byline widget: "byline, <i>outlet</i>" or just "<i>outlet</i>"
// alone (a roundup with no named critic) are the common shapes, but some
// responsive-variant clones of the same slide drop the <i> entirely and
// leave plain "byline, outlet" text -- fall back to the same comma split
// splitAttribution uses for that case.
function parsePressByline(rawInner) {
  const m = /^([\s\S]*?)<i>([\s\S]*?)<\/i>\s*$/.exec(rawInner.trim());
  if (m) {
    const byline = stripTags(m[1]).replace(/,\s*$/, '').trim();
    const outlet = stripTags(m[2]).trim();
    return { byline: byline || null, outlet: outlet || null };
  }
  const t = stripTags(rawInner);
  if (!t) return { byline: null, outlet: null };
  const comma = t.lastIndexOf(',');
  if (comma !== -1) {
    return { byline: t.slice(0, comma).trim() || null, outlet: t.slice(comma + 1).trim() || null };
  }
  return { byline: null, outlet: t };
}

function looksLikeRoundup(title, url) {
  const t = `${title || ''} ${url}`;
  if (/\d+\s*(βιβλ\w*|μυθιστορ\w*|προτάσ\w*)/iu.test(t)) return true;
  if (/(καλοκαίρι|διακοπές)/iu.test(t) &&
      /(βιβλ\w*|μυθιστορ\w*|προτάσ\w*|οδηγός)/iu.test(t)) return true;
  if (/(deka|10|20|100)-?\s*(vivlia|biblia|mythistorimata|protaseis)/i.test(url)) return true;
  return false;
}

// Exactly the hosts §4's classify table names -- a station's own website
// (ert.gr, athina984.gr) also carries plain text write-ups, so it is not
// safe to assume every URL on it is audio; ertecho.gr/serpico.gr/soundcloud
// URLs harvested here are always to a specific show/episode page, which is.
const AUDIO_HOSTS = ['ertecho.gr', 'serpico.gr', 'soundcloud.com'];
const VIDEO_HOSTS = ['youtube.com', 'youtu.be'];

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function mediumFor(url, contentType) {
  const host = hostOf(url);
  if (VIDEO_HOSTS.some((h) => host.endsWith(h))) return 'video';
  if (AUDIO_HOSTS.some((h) => host.endsWith(h))) return 'audio';
  if (contentType && contentType.includes('application/pdf')) return 'pdf';
  return 'text';
}

// ---------------------------------------------------------------------------
// Phase 1 -- fetch & cache each product page.
// ---------------------------------------------------------------------------

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBuffer(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'el,en;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, finalUrl: res.url, contentType: res.headers.get('content-type') || '', buf };
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(buf, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
    charset = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function harvestPages(books) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  for (const book of books) {
    const dest = join(CACHE_DIR, `${book.id}.html`);
    if (existsSync(dest)) continue;
    const reconSrc = join(RECON_CACHE_DIR, `${book.id}.html`);
    if (existsSync(reconSrc)) {
      copyFileSync(reconSrc, dest);
      console.log(`  cache: ${book.id} <- recon cache`);
      continue;
    }
    console.log(`  fetch: ${book.id} <- ${book.buy_url}`);
    const { status, buf, contentType } = await fetchBuffer(book.buy_url);
    if (status !== 200) throw new Error(`${book.id}: buy_url returned ${status}`);
    writeFileSync(dest, decodeHtml(buf, contentType), 'utf-8');
    await sleep(1000); // ~1 req/s against the publisher
  }
}

// ---------------------------------------------------------------------------
// Phase 2a -- extract, per §2.
// ---------------------------------------------------------------------------

function balancedSpanContent(html, openTagIdx) {
  const openEnd = html.indexOf('>', openTagIdx) + 1;
  let depth = 1;
  const tagRe = /<(\/?)span\b[^>]*>/g;
  tagRe.lastIndex = openEnd;
  let m;
  while ((m = tagRe.exec(html))) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(openEnd, m.index);
  }
  return null;
}

// §2a -- the interview/appearance bullets in the summary heading widget.
// Identified by DOM region (the one <span class="elementor-heading-title">
// in the product summary), never by anchor text or domain -- a domain
// blocklist would eat the youtube.com and soundcloud.com entries, which are
// real content here, not site chrome.
function extractInterviews(html) {
  const idx = html.indexOf('<span class="elementor-heading-title');
  if (idx === -1) return [];
  const content = balancedSpanContent(html, idx);
  if (!content) return [];
  const anchorRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const out = [];
  let m;
  while ((m = anchorRe.exec(content))) {
    const url = decodeEntities(m[1]);
    const { label_el, byline, outlet } = parseInterviewLabel(m[2]);
    out.push({ url, label_el, byline, outlet, kind: 'interview' });
  }
  return out;
}

// §2b/§2c -- the excerpt: an issuu flipbook, and/or a PDF whose real URL
// hides in a DearFlip config <script> keyed by the same dflip id as the
// (permanently dead) shortcode anchor. The generic /απόσπασμα/ popup
// trigger is deliberately not matched by either branch below.
function extractExcerpt(html) {
  const iconBoxRe = /<h4 class="elementor-icon-box-title">\s*<a href="([^"]*)"[^>]*>/g;
  let issuu = null;
  let dflipId = null;
  let m;
  while ((m = iconBoxRe.exec(html))) {
    const href = m[1];
    if (href.includes('issuu.com')) issuu = href;
    const dm = /dflip%20id=(\d+)/.exec(href);
    if (dm) dflipId = dm[1];
  }
  let pdf = null;
  if (dflipId) {
    const scriptRe = new RegExp(`window\\.option_df_${dflipId}\\s*=\\s*\\{[\\s\\S]*?"source":"([^"]*?\\.pdf)"`);
    const sm = scriptRe.exec(html);
    if (sm) pdf = sm[1].replace(/\\\//g, '/');
  }
  return { issuu, pdf };
}

// §2d -- the reviews slider. Each quote is a <div class="ae-element-post-content">
// paragraph ending in a "(Διαβάστε περισσότερα)"/"(Διαβάστε την)" anchor;
// the byline/outlet live in the widget that immediately follows. The slider
// clones every slide 3-6x for its responsive breakpoints and its loop --
// dedupe on (quote, href), preferring whichever clone actually carries a
// byline (not every clone does). Two traps: an anchor buried INSIDE the
// quote's own prose (a tag-cloud link) is not a review link -- only the
// LAST anchor in the paragraph, whose own text is the read-more label,
// counts; and some labels are plain text with no anchor at all -- unlinkable,
// dropped.
function extractPressLinks(html) {
  const blockRe = /<div class="ae-element-post-content">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g;
  const anchorIterRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const labelRe = /^\(Διαβάστε(?:\s+(?:περισσότερα|την))?\)$/;
  const bylineRe = /<div class="ae-element-custom-field">\s*<p>([\s\S]*?)<\/p>/;
  const seen = new Map();
  const order = [];
  let bm;
  while ((bm = blockRe.exec(html))) {
    const block = bm[1];
    if (!block.includes('Διαβάστε')) continue; // "Διαβάστε"
    let lastMatch = null;
    anchorIterRe.lastIndex = 0;
    let am;
    while ((am = anchorIterRe.exec(block))) {
      if (labelRe.test(stripTags(am[2]))) lastMatch = am;
    }
    if (!lastMatch) continue; // label present, no anchor -- unlinkable, drop
    const url = decodeEntities(lastMatch[1]);
    const quote = stripTags(block.slice(0, lastMatch.index));
    const key = `${quote} ${url}`;
    if (!seen.has(key)) {
      seen.set(key, { url, quote, byline: null, outlet: null });
      order.push(key);
    }
    // 3000 chars: one responsive-variant clone's byline widget can sit as
    // far as ~2000 chars after its quote (the desktop/tablet/mobile-hidden
    // variant that lacks a byline of its own comes first in the DOM; the
    // one that carries it follows after a whole extra section wrapper).
    const tail = html.slice(bm.index + bm[0].length, bm.index + bm[0].length + 3000);
    const bym = bylineRe.exec(tail);
    if (bym && seen.get(key).byline === null && seen.get(key).outlet === null) {
      const { byline, outlet } = parsePressByline(bym[1]);
      seen.get(key).byline = byline;
      seen.get(key).outlet = outlet;
    }
  }
  return order.map((k) => seen.get(k));
}

function extractBook(html) {
  return {
    interviews: extractInterviews(html),
    excerptRaw: extractExcerpt(html),
    pressLinks: extractPressLinks(html),
  };
}

// ---------------------------------------------------------------------------
// Phase 2b -- verify every unique URL.
// ---------------------------------------------------------------------------

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() || null : null;
}

function extractDate(html) {
  let m =
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i.exec(html);
  if (m) return m[1].slice(0, 10);
  m = /<time[^>]+datetime=["']([^"']+)["']/i.exec(html);
  return m ? m[1].slice(0, 10) : null;
}

function looksLikeHomepageBounce(originalUrl, finalUrl) {
  try {
    const a = new URL(originalUrl);
    const b = new URL(finalUrl);
    const origDepth = a.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
    const finalDepth = b.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
    return origDepth > 0 && finalDepth === 0 && a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

async function verifyUrl(url, cache) {
  if (cache.has(url)) return cache.get(url);
  let record;
  try {
    let target = url;
    let upgradedFrom = null;
    if (url.startsWith('http://')) {
      const httpsUrl = 'https://' + url.slice('http://'.length);
      try {
        const probe = await fetchBuffer(httpsUrl, 15000);
        if (probe.status >= 200 && probe.status < 300) {
          target = httpsUrl;
          upgradedFrom = url;
        }
      } catch {
        /* keep http */
      }
    }
    const { status, finalUrl, contentType, buf } = await fetchBuffer(target);
    const isHtml = contentType.includes('text/html') || contentType === '';
    const html = isHtml ? decodeHtml(buf, contentType) : '';
    const bounced = status >= 200 && status < 300 && looksLikeHomepageBounce(target, finalUrl);
    record = {
      resolvedUrl: upgradedFrom ? target : null,
      status,
      final_url: finalUrl !== target ? finalUrl : null,
      dead: !(status >= 200 && status < 300) || bounced,
      target_title: isHtml ? extractTitle(html) : null,
      date: isHtml ? extractDate(html) : null,
      contentType,
      checked: TODAY,
    };
  } catch (err) {
    record = {
      resolvedUrl: null,
      status: null,
      final_url: null,
      dead: true,
      target_title: null,
      date: null,
      contentType: '',
      checked: TODAY,
      error: String(err.message || err),
    };
  }
  cache.set(url, record);
  return record;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify');

  const books = JSON.parse(readFileSync(join(ROOT, 'content/books.json'), 'utf-8')).books;

  if (verifyOnly) {
    if (!existsSync(OUT_PATH)) {
      console.error('content/press.json does not exist yet -- run node tools/press.mjs first.');
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(OUT_PATH, 'utf-8'));
    let total = 0;
    let failures = 0;
    for (const [id, rec] of Object.entries(data.byBook)) {
      const urls = [];
      if (rec.excerpt?.flipbook) urls.push(rec.excerpt.flipbook);
      if (rec.excerpt?.pdf) urls.push(rec.excerpt.pdf);
      for (const link of rec.links) if (!link.dead) urls.push(link.url);
      for (const url of urls) {
        total++;
        const { status } = await fetchBuffer(url, 20000).catch(() => ({ status: null }));
        const ok = status >= 200 && status < 300;
        if (!ok) {
          failures++;
          console.log(`  FAIL ${status ?? 'ERR'}  ${id}  ${url}`);
        }
        await sleep(150);
      }
    }
    console.log(`\n${total - failures}/${total} rendered URLs are 2xx.`);
    process.exit(failures > 0 ? 1 : 0);
  }

  console.log('Phase 1: fetch & cache product pages');
  await harvestPages(books);

  console.log('\nPhase 2: extract');
  const raw = {};
  const warnings = [];
  for (const book of books) {
    const html = readFileSync(join(CACHE_DIR, `${book.id}.html`), 'utf-8');
    raw[book.id] = extractBook(html);
    const exp = EXPECTED[book.id];
    const got = { interviews: raw[book.id].interviews.length, press: raw[book.id].pressLinks.length };
    const flag = (got.interviews !== exp.interviews || got.press !== exp.press) ? '  <-- differs from §2e' : '';
    console.log(
      `  ${book.id.padEnd(28)} interviews ${got.interviews} (exp ${exp.interviews})  press ${got.press} (exp ${exp.press})${flag}`
    );
    if (Math.abs(got.interviews - exp.interviews) > 1 || Math.abs(got.press - exp.press) > 2) {
      warnings.push(`${book.id}: interviews ${got.interviews}/${exp.interviews}, press ${got.press}/${exp.press}`);
    }
    if (NO_EXCERPT.has(book.id) && (raw[book.id].excerptRaw.issuu || raw[book.id].excerptRaw.pdf)) {
      console.log(`  NOTE: ${book.id} was expected to have no excerpt but one was found -- good, use it.`);
    }
  }
  const totalInterviews = Object.values(raw).reduce((s, b) => s + b.interviews.length, 0);
  const totalPress = Object.values(raw).reduce((s, b) => s + b.pressLinks.length, 0);
  console.log(`\nTotals: ${totalInterviews} interview bullets (recon: ~15), ${totalPress} press links (recon: ~35)`);

  if (warnings.length) {
    console.error('\nHarvest counts are materially off §2e for:');
    for (const w of warnings) console.error(`  ${w}`);
    console.error('\nStopping before verify/emit -- fix the extractor rather than ship a partial dataset.');
    process.exit(1);
  }

  console.log('\nPhase 3: verify every unique URL');
  const cache = new Map();
  const allUrls = new Set();
  for (const b of Object.values(raw)) {
    if (b.excerptRaw.issuu) allUrls.add(b.excerptRaw.issuu);
    if (b.excerptRaw.pdf) allUrls.add(b.excerptRaw.pdf);
    for (const it of b.interviews) allUrls.add(it.url);
    for (const p of b.pressLinks) allUrls.add(p.url);
  }
  const urlList = [...allUrls];
  console.log(`  ${urlList.length} unique URLs to verify`);
  let done = 0;
  const upgrades = [];
  for (const url of urlList) {
    const rec = await verifyUrl(url, cache);
    if (rec.resolvedUrl) upgrades.push({ from: url, to: rec.resolvedUrl });
    done++;
    if (done % 5 === 0 || done === urlList.length) console.log(`  verified ${done}/${urlList.length}`);
    await sleep(200);
  }

  console.log('\nPhase 4: classify + assemble');
  const byBook = {};
  const summary = [];
  const deadExcerpts = [];
  for (const book of books) {
    const b = raw[book.id];

    // Cross-category dedupe: the same href appearing in both the interview
    // bullets and the reviews slider keeps its interview classification.
    const interviewUrls = new Set(b.interviews.map((i) => i.url));
    const pressLinksDeduped = b.pressLinks.filter((p) => !interviewUrls.has(p.url));

    const links = [];
    let harvested = 0;
    let live = 0;
    let dead = 0;

    for (const it of b.interviews) {
      harvested++;
      const v = cache.get(it.url);
      const url = v.resolvedUrl || it.url;
      if (!v.dead) live++; else dead++;
      links.push({
        url,
        label_el: it.label_el,
        byline: it.byline,
        outlet: it.outlet,
        kind: 'interview',
        medium: mediumFor(url, v.contentType),
        date: v.date,
        quote: null,
        target_title: v.target_title,
        status: v.status,
        final_url: v.final_url,
        dead: v.dead,
        checked: v.checked,
      });
    }
    for (const p of pressLinksDeduped) {
      harvested++;
      const v = cache.get(p.url);
      const url = v.resolvedUrl || p.url;
      if (!v.dead) live++; else dead++;
      const kind = looksLikeRoundup(v.target_title, url) ? 'roundup' : 'review';
      links.push({
        url,
        label_el: null,
        byline: p.byline,
        outlet: p.outlet,
        kind,
        medium: mediumFor(url, v.contentType),
        date: v.date,
        quote: p.quote,
        target_title: v.target_title,
        status: v.status,
        final_url: v.final_url,
        dead: v.dead,
        checked: v.checked,
      });
    }

    const dropped = b.pressLinks.length - pressLinksDeduped.length;

    let excerpt = null;
    const issuuUrl = b.excerptRaw.issuu;
    const pdfUrl = b.excerptRaw.pdf;
    const issuuDead = issuuUrl ? cache.get(issuuUrl)?.dead : null;
    const pdfDead = pdfUrl ? cache.get(pdfUrl)?.dead : null;
    const issuuLive = issuuUrl && !issuuDead ? (cache.get(issuuUrl).resolvedUrl || issuuUrl) : null;
    const pdfLive = pdfUrl && !pdfDead ? (cache.get(pdfUrl).resolvedUrl || pdfUrl) : null;
    if (issuuLive || pdfLive) excerpt = { flipbook: issuuLive, pdf: pdfLive };
    if (issuuUrl && issuuDead) {
      deadExcerpts.push({ book: book.id, kind: 'issuu', url: issuuUrl, status: cache.get(issuuUrl).status });
    }
    if (pdfUrl && pdfDead) {
      deadExcerpts.push({ book: book.id, kind: 'pdf', url: pdfUrl, status: cache.get(pdfUrl).status });
    }

    byBook[book.id] = { excerpt, links };
    summary.push(
      `  ${book.id.padEnd(28)} harvested ${harvested}  live ${live}  dead ${dead}  dropped(dup) ${dropped}`
    );
  }

  console.log('\nPer-book summary:');
  for (const line of summary) console.log(line);
  if (upgrades.length) {
    console.log('\nhttp:// -> https:// upgrades:');
    for (const u of upgrades) console.log(`  ${u.from} -> ${u.to}`);
  }
  if (deadExcerpts.length) {
    console.log('\nDead excerpt links (harvested, verified dead, excluded from the rendered excerpt object):');
    for (const d of deadExcerpts) console.log(`  ${d.book}  [${d.kind}] ${d.status ?? 'ERR'}  ${d.url}`);
  }

  const out = {
    _meta: {
      compiled: TODAY,
      source:
        'keimenabooks.gr per-title product pages — the link block above the Αγορά button and the reviews slider below the synopsis',
      method: 'tools/press.mjs — harvest, then GET every URL and record status, final URL, <title>',
      checked: TODAY,
      rules: [
        'byline/outlet/date/quote are copied from a source or null. Never inferred.',
        'dead:true records are kept as evidence and never rendered.',
        'The generic https://keimenabooks.gr/απόσπασμα/ popup trigger is not a per-book URL and is never recorded as one.',
        'roundup links (listicles that mention the title once) are harvested and kept in this file, but pressFor() in lib/content.js filters them out of what actually renders by default.',
      ],
      ...(upgrades.length ? { http_upgrades: upgrades } : {}),
      ...(deadExcerpts.length ? { dead_excerpts: deadExcerpts } : {}),
    },
    byBook,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
