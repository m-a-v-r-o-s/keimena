import { GFS_Didot, Literata, JetBrains_Mono } from 'next/font/google';
import CanvasMount from '@/components/three/CanvasMount';
import Loader from '@/components/Loader';
import './globals.css';

/* All three verified for Greek coverage against the Google Fonts API and all
 * three are OFL -- no commercial licence anywhere in this stack. DECISIONS D1. */

const didot = GFS_Didot({
  // GFS Didot ships weight 400 only, with no italic. Do not add weights here;
  // the API rejects them, and asking CSS for bold yields synthetic fake-bold
  // that smears the Didone hairlines.
  weight: '400',
  subsets: ['greek', 'latin'],
  display: 'swap',
  variable: '--f-didot',
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
 * Same typography, off the critical path. */
const literataItalic = Literata({
  subsets: ['greek', 'latin'],
  display: 'swap',
  style: 'italic',
  preload: false,
  variable: '--f-literata-italic',
});

const mono = JetBrains_Mono({
  subsets: ['greek', 'latin'],
  display: 'swap',
  variable: '--f-mono',
});

export const metadata = {
  metadataBase: new URL('https://example.invalid'),
  title: {
    default: 'Πέτρος Μάρκαρης',
    template: '%s — Πέτρος Μάρκαρης',
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
