'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SLOTS_CHANGED } from '@/components/three/events';
import { useGround } from '@/lib/useGround';
import { t as dict } from '@/lib/i18n';
import { title as bookTitle } from '@/lib/content';
import Rail from '@/components/Rail';
import ReaderRow from '@/components/ReaderRow';

const rowFor = (id) =>
  document.querySelector(`[data-book-slot="${id}"][data-slot-key="read"]`);

/**
 * The reading document: every book's full text, in catalogue order, each
 * paired with its own upright WebGL volume via `data-slot-key="read"` (see
 * components/three/BookCanvas.jsx's two-population canvas contract, kept
 * alive by DECISIONS.md D11's live-measurement rule).
 *
 * Mounted by app/books/[id]/page.jsx with `currentId` set to THAT page's own
 * book. The reader scrolls the document itself now, not a nested container
 * -- there is no shelf underneath a book page to keep still, so native
 * scroll, find-in-page, keyboard paging and mobile URL-bar collapse all work
 * for free.
 *
 * ---- Server render -> hydration expansion --------------------------------
 * app/books/[id]/page.jsx server-renders ONE row -- this book's own, so the
 * static file for `/books/faust/` genuinely holds only Faust (decision 2 in
 * HANDOFF-book-pages.md), not seventeen copies of the catalogue with
 * different <title>s. `expanded` starts false, on both the server render and
 * the FIRST client render -- it has to match, or React throws a hydration
 * error -- so `rows` is a single book until the effect below flips it.
 *
 * Expanding is not free: inserting the 6-ish rows that belong BEFORE this
 * book shoves it down the page. That's compensated in the same commit,
 * before paint, by a plain scrollBy of the delta -- not an assumed row
 * height (a long synopsis grows one, and the reader may already have
 * scrolled before hydration lands, either of which makes any fixed number
 * wrong). `behavior: 'instant'` explicitly: a smooth-scrolled compensation
 * is a visible lurch, and `scroll-behavior: smooth` may be in force from the
 * stylesheet.
 *
 * SLOTS_CHANGED -- the event that tells BookCanvas.jsx's live-measured
 * slots to re-read the DOM -- fires only once expansion has landed, in the
 * SAME layout effect, after the compensating scroll: fixing the scroll
 * first and telling the canvas second means the canvas never measures rects
 * from a viewport that is about to move.
 */
export default function Reader({ books, locale, currentId }) {
  const index = books.findIndex((b) => b.id === currentId);
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? books : [books[index]];

  const [current, setCurrent] = useState(index === -1 ? 0 : index);
  const anchorTop = useRef(0);
  /* The URL/title only ever get rewritten when the tracked book actually
     changes -- not on every scroll frame, which would spam replaceState. */
  const urlId = useRef(currentId);

  useGround(books[current]?.id);

  useEffect(() => {
    /* Runs after the un-expanded (single-row) tree has painted: measure
       where this book sits NOW, before anything above it exists. */
    anchorTop.current = rowFor(currentId)?.getBoundingClientRect().top ?? 0;
    setExpanded(true);
  }, [currentId]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const delta = (rowFor(currentId)?.getBoundingClientRect().top ?? anchorTop.current) - anchorTop.current;
    if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
    window.dispatchEvent(new Event(SLOTS_CHANGED));
  }, [expanded, currentId]);

  /* ---- Which book is the reader at, and the URL/title that follow it ----
     The nearest-to-viewport-middle heuristic the shelf uses over its own
     slots (Shelf.jsx), scoped to `window` instead of a shelf: there is no
     nested scroll container here, the document itself is the scroller.
     Matched back to a book by id, not by its position in the DOM query --
     before expansion only one row exists, so a DOM-order index would read
     as "book 0" regardless of which book this page actually is. */
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rowEls = [...document.querySelectorAll('[data-book-slot][data-slot-key="read"]')];
      const mid = window.innerHeight / 2;
      let bestId = rowEls[0]?.dataset.bookSlot;
      let bestD = Infinity;
      rowEls.forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestD) {
          bestD = d;
          bestId = el.dataset.bookSlot;
        }
      });
      const i = books.findIndex((b) => b.id === bestId);
      if (i === -1) return;
      setCurrent(i);

      const b = books[i];
      if (b.id !== urlId.current) {
        urlId.current = b.id;
        /* history.state, NOT null: the App Router keeps its routing tree in
           there, and nulling it breaks Back/Forward in ways that only show
           up later. Never pushState -- see decision 3, Back is one press
           back to the shelf, not a walk through every book scrolled past. */
        const s = dict(locale);
        window.history.replaceState(window.history.state, '', `/books/${b.id}/`);
        document.title = `${bookTitle(b, locale)} - ${s.siteName}`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [books, locale]);

  const jumpTo = (i) => {
    const book = books[i];
    if (!book) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rowFor(book.id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <>
      <Rail
        books={books}
        locale={locale}
        current={current}
        onJump={jumpTo}
        backHref={`/#book-${currentId}`}
      />
      {rows.map((book) => (
        <ReaderRow
          key={book.id}
          book={book}
          locale={locale}
          heading={book.id === currentId ? 'h1' : 'h2'}
        />
      ))}
    </>
  );
}
