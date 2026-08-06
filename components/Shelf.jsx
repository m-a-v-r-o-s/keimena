'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SLOTS_CHANGED, DRAG_BOOK, SHELF_CURRENT } from '@/components/three/events';
import { t as dict } from '@/lib/i18n';
import { title as bookTitle, titleLang, teaser } from '@/lib/content';
import { useGround } from '@/lib/useGround';
import Rail from '@/components/Rail';
import grounds from '@/content/grounds.json';

/* The four corners the held-book teaser can land in -- top/bottom is chosen
   to clear the book actually being dragged (see the teaser effect below),
   left/right is free, so DEFAULT_TEASER_CORNER only matters before any drag
   has happened yet. See .teaser in globals.css. */
const DEFAULT_TEASER_CORNER = 'top-left';

/**
 * The shelf: a stacked pile, turned by dragging, opened by a click on a
 * spine -- which now genuinely opens that book's own page at
 * `/books/<id>/` (D23; this used to be a `<button>` that opened an overlay
 * in place, D11's original shape). No shelf slot is ever "the open book" --
 * clicking one does not transform it, it navigates.
 *
 * Both this and Reader.jsx (the book page) share the canvas measurement
 * contract (DECISIONS.md D11: measure every `[data-book-slot]` live, every
 * frame) but never collide even though a shelf slot and a reader row for the
 * SAME book can carry the same id, because they never appear on the same
 * page at once -- and BookCanvas.jsx's `rebuild` keys its tracked volumes by
 * `${id}:${slotKey}` regardless, a shelf slot carrying no slot-key at all.
 */
export default function Shelf({ books, locale }) {
  const s = dict(locale);
  const router = useRouter();
  const [dragging, setDragging] = useState(null);
  const [teaserBook, setTeaserBook] = useState(null);
  const [teaserCorner, setTeaserCorner] = useState(DEFAULT_TEASER_CORNER);
  /* Which book is "here" -- the shelf slot nearest the viewport's middle.
     Drives the rail's current tick. */
  const [current, setCurrent] = useState(0);

  const teaserBookObj = teaserBook ? books.find((b) => b.id === teaserBook) : null;
  const teaserText = teaserBookObj ? teaser(teaserBookObj, locale) : null;

  /* The room's colour answers to a book being turned -- see lib/useGround.js.
     Nothing else on the shelf recolours the room; opening a book is a real
     navigation now, so the room the reader lands in is the book page's own
     first paint (BookGround.jsx), not a state this component drives. */
  useGround(dragging);

  /* The canvas only re-reads a slot's pose/dim on a SLOTS_CHANGED event,
     never per-frame (BookCanvas.jsx's `rebuild`). The root layout that owns
     the canvas is never remounted by the App Router, so returning to the
     shelf from a book page leaves the canvas measuring rects that belonged
     to the PREVIOUS page -- it has to be told, once, that this page's own
     slots now exist. Reader.jsx does the same on its own mount. */
  useLayoutEffect(() => {
    window.dispatchEvent(new Event(SLOTS_CHANGED));
  }, []);

  /* Landing back on the spine that was clicked, focused -- the shelf's half
     of decision 3 (URL/content/history) in HANDOFF-book-pages.md. A book
     page's rail back control links to `/#book-<id>`, and browser Back does
     the same natively (the URL a book page settles on, via replaceState, is
     always `/books/<the book scrolled to>/` -- but the ORIGIN spine, the one
     actually clicked, is what a reader expects to land back on, which is why
     the back link carries the page's own `currentId`, not wherever the
     reader had scrolled to).
     `scrollIntoView` restores the shelf's own scroll POSITION, not just
     focus -- the two together replace `returnFocus`, which could not survive
     a route change (the whole component, and the ref, are recreated).
     Instant, not smooth: this is a page load settling into place. Focus is
     `preventScroll: true` because the scrollIntoView above already put the
     spine where it belongs; a focus-driven scroll would fight it. */
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
  }, []);

  /* A book being turned (not yet opened) recolours the room, so the
     background answers the reader's hand before they commit to a click. The
     canvas owns the gesture and knows nothing of this component; DRAG_BOOK
     is how it tells the page.

     The same event drives the held-book teaser: a fresh corner is picked
     only when a drag STARTS (id goes from null to something), and
     `teaserBook` is left standing on release rather than cleared, so the
     text stays put while the teaser fades out instead of vanishing with
     it.

     The book being dragged doesn't travel across the screen -- it only
     rotates in place, at its own slot's rect (BookVolume sizes and
     positions it straight from the same DOM element this reads here) -- so
     which HALF the teaser lands in is not random: it's whichever of
     top/bottom is farther from that rect, the one guaranteed not to have
     the book sitting in it. That matters most on mobile, where a dragged
     book is zoomed to near the full width of the screen (see
     MOBILE_STACK_ZOOM in BookVolume.jsx) and every corner used to be fair
     game for the pointer to land the label on top of it. Left/right stays
     random -- horizontal position was never the collision, only vertical
     was. */
  useEffect(() => {
    const onDrag = (e) => {
      const id = e.detail?.id ?? null;
      if (id) {
        const rect = document.querySelector(`[data-book-slot="${id}"]`)?.getBoundingClientRect();
        const bookMidY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        const half = bookMidY > window.innerHeight / 2 ? 'top' : 'bottom';
        const side = Math.random() < 0.5 ? 'left' : 'right';
        setTeaserCorner(`${half}-${side}`);
        setTeaserBook(id);
      }
      setDragging(id);
    };
    window.addEventListener(DRAG_BOOK, onDrag);
    return () => window.removeEventListener(DRAG_BOOK, onDrag);
  }, []);

  /* ---- Which book is the reader at ------------------------------------- */

  /* BookCanvas.jsx's own place() already measures every slot's rect every
     frame and already computes this exact quantity (as `s.progress`) for its
     own purposes -- this used to be a second, independent rAF-throttled
     scroll listener doing the same `getBoundingClientRect` pass over the
     same elements to answer the same question. One tracker, multiple
     consumers (plan.md Phase 2.5): consume the broadcast instead. */
  useEffect(() => {
    const onCurrent = (e) => setCurrent(e.detail.index);
    window.addEventListener(SHELF_CURRENT, onCurrent);
    return () => window.removeEventListener(SHELF_CURRENT, onCurrent);
  }, []);

  /* A rail tick opens that book's own page now, the same destination its
     shelf spine already links to -- the rail is a position indicator for
     the whole catalogue, not just a within-page scroller, and a reader
     picking a title off it means to go there, not just bring its spine to
     the middle of the stack. `router.push`, matching a real `<Link>` click:
     it adds a history entry, so Back returns to the shelf exactly as
     clicking a spine already does. */
  const jumpTo = (i) => {
    const book = books[i];
    if (!book) return;
    router.push(`/books/${book.id}/`);
  };

  return (
    <div className="catalogue">
      <Rail books={books} locale={locale} current={current} onJump={jumpTo} />

      {/* ---- The stack ------------------------------------------------------
          A stacked pile, seen at a raking angle -- see DECISIONS.md D9. */}
      <div className="stack" aria-label={s.worksTitle}>
        {books.map((book) => (
          <div key={book.id} className="slot" data-book-slot={book.id} data-pose="stacked">
            <Link
              href={`/books/${book.id}/`}
              id={`book-${book.id}`}
              className="slot__hit spinebar"
            >
              <span className="spinebar__author">{s.authorShort}</span>
              <span className="spinebar__title" lang={titleLang(book, locale)}>
                {bookTitle(book, locale)}
              </span>
              <span className="spinebar__imprint">{book.year}</span>
            </Link>
          </div>
        ))}
      </div>

      {/* ---- The held-book teaser -------------------------------------------
          Text only while a book is being turned. The card fills with that
          same book's `text` colour -- the colour its title and nav mark
          carry once the book is actually open -- and the text itself is set
          in `reading`, the background the reading panel opens onto: the fill
          and the words trade places with what the reader is about to see.
          Both come straight from content/grounds.json, nothing here invents
          a colour. */}
      {teaserText ? (
        <p
          className="teaser"
          data-corner={teaserCorner}
          data-show={dragging ? '' : undefined}
          style={{
            '--teaser-fill': grounds[teaserBook]?.text,
            '--teaser-text': grounds[teaserBook]?.reading,
          }}
          aria-hidden="true"
        >
          {teaserText}
        </p>
      ) : null}
    </div>
  );
}
