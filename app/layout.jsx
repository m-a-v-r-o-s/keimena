import localFont from 'next/font/local';
import { Literata } from 'next/font/google';
import CanvasMount from '@/components/three/CanvasMount';
import Loader from '@/components/Loader';
import './globals.css';

/* All four faces are OFL -- no commercial licence anywhere in this stack.
 * DECISIONS D1.
 *
 * Didot and Mono are self-hosted, subset to exactly this site's own glyph
 * set (plan.md Phase 4.2 -- tools/glyphs.mjs derives the set, tools/subset-
 * fonts.mjs runs it through fonttools into fonts/): real, measured wins,
 * ~22KB->21.3KB and ~49KB->36.5KB.
 *
 * Literata stayed on next/font/google -- tried self-hosting it too and
 * measured it WORSE, not better: subset correctly (glyph set derived, real
 * kerning/mark positioning preserved, see the false starts recorded in
 * DECISIONS.md before landing there), it still subsetted out to ~120KB,
 * against Next's own delivery of it at roughly 72KB for this same page. The
 * reason is structural, not a mistake to fix: Literata is a two-axis
 * variable font (opsz+wght) genuinely used across its full weight range in
 * this codebase (tokens.css sets 400/500/700 via CSS font-weight, all
 * mapped onto the SAME wght axis -- see --weight-body/-md/-b), so keeping
 * the axis (the plan's own instruction: do not instance, or every size on
 * the page shifts) keeps the gvar table's real cost regardless of how few
 * glyphs are requested. Splitting into separate latin/greek files the way
 * Google does barely moved the number (~2KB) when tested, so that was not
 * the missing piece either. Reported and kept on Google's CDN rather than
 * forced self-hosted at a real cost, the same call Phase 3.1 made for
 * three.js tree-shaking: measure, and revert what the plan predicted would
 * help but measurably does not. */

const didot = localFont({
  // GFS Didot ships weight 400 only, with no italic -- unchanged from the
  // next/font/google call this replaced. Asking CSS for bold would still
  // yield synthetic fake-bold that smears the Didone hairlines.
  src: '../fonts/gfs-didot.woff2',
  weight: '400',
  display: 'swap',
  variable: '--f-didot',
  adjustFontFallback: 'serif',
});

const literata = Literata({
  subsets: ['greek', 'latin'],
  display: 'swap',
  variable: '--f-literata',
});

/* Italic, declared SEPARATELY and deliberately not preloaded.
 *
 * Asking one next/font call for both styles preloads both, and the italic is
 * two more files -- 73KB of the 211KB this page preloads, more than the display
 * face and the mono face put together. It buys one rule: the drag hint, which
 * starts at opacity 0 and is only ever seen by someone already dragging a book.
 *
 * Preloading a face for a state most visitors never reach is the wrong trade,
 * and dropping the italic to fix it would be the wrong fix -- the hint is set
 * in italic because it is an aside, and that is a design decision, not a
 * loading one. So the face stays, its @font-face stays, and only the <link
 * rel=preload> goes: the browser fetches it if and when the hint is styled.
 * Same typography, off the critical path.
 *
 * Also next/font/google, matching literata above -- not preloaded either way,
 * so the byte-size argument for self-hosting never applied to this one; only
 * the complexity would have (a merged variable font, or two chained files
 * the way the abandoned attempt split it -- see git history if this is ever
 * revisited). */
const literataItalic = Literata({
  subsets: ['greek', 'latin'],
  display: 'swap',
  style: 'italic',
  preload: false,
  variable: '--f-literata-italic',
});

const mono = localFont({
  src: '../fonts/jetbrains-mono.woff2',
  display: 'swap',
  variable: '--f-mono',
  adjustFontFallback: 'monospace',
});

export const metadata = {
  metadataBase: new URL('https://example.invalid'),
  title: {
    default: 'Πέτρος Μάρκαρης',
    template: '%s - Πέτρος Μάρκαρης',
  },
  description:
    'Κατάλογος έργων του Πέτρου Μάρκαρη: τα μυθιστορήματα του αστυνόμου Κώστα Χαρίτου, η Τριλογία της Κρίσης, και τα υπόλοιπα γραπτά.',
};

export const viewport = {
  themeColor: '#1B1714',
};

/* The site is Greek-first, so the document language is Greek -- and since the
 * catalogue now sits at `/` rather than under a locale segment, this is the
 * only place that declares it. If a second language ever arrives it marks its
 * own subtree with lang="en": nested lang attributes are the standard way to
 * signal a language change, and they are what makes a screen reader switch
 * voice instead of reading Greek as mangled Latin. */
export default function RootLayout({ children }) {
  return (
    <html
      lang="el"
      className={`${didot.variable} ${literata.variable} ${literataItalic.variable} ${mono.variable}`}
    >
      <head>
        {/* The loader is visible from the very first paint and is cleared by
            setting data-loaded. Two escapes, because a loading screen that
            cannot clear is worse than no loading screen at all:

            1. NO JAVASCRIPT -- nothing would ever set data-loaded, so the
               loader is hidden outright and the DOM fallback shows instead.
            2. JAVASCRIPT THAT NEVER ARRIVES -- if the app bundle fails or
               stalls, this inline script still clears the loader. It is
               deliberately independent of everything else on the page. */}
        <noscript>
          <style>{`.loader{display:none!important}.slot__hit{opacity:1!important}`}</style>
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "setTimeout(function(){document.documentElement.setAttribute('data-loaded','')},12000)",
          }}
        />
      </head>
      <body>
        {/* Fixed, full-viewport, visible from first paint -- see the LOADER
            block in globals.css for why it is not gated behind any JS state.
            Cleared by data-loaded, which BookCanvas sets once the renderer and
            the covers on screen at load are both ready. */}
        <Loader />

        {/* The canvas is a sibling of the content and outlives any one view of
            it, so it mounts here rather than inside the page: a WebGL context
            that is torn down and rebuilt is the one thing this scene cannot
            afford. Moved up from the old [locale] layout, unchanged. */}
        <CanvasMount />
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
