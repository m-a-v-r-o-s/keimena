'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { t as dict } from '@/lib/i18n';
import { title as bookTitle } from '@/lib/content';

/**
 * A position indicator, not navigation chrome: one tick per book, the current
 * one lit. It says where in the catalogue you are, and lets you jump. The back
 * control lives at its head, so returning from a book is always in the same
 * place the rail already trained the eye to look.
 *
 * `backHref` is optional: the shelf page has nowhere to go back TO, so it
 * mounts this without one and the control simply isn't rendered. A book
 * page always has a shelf to return to, so it always passes one -- a real
 * `<Link>`, not a click handler, because Back is a navigation now (D23),
 * not a state change on the same page.
 */
export default function Rail({ books, locale, current, onJump, backHref }) {
  const s = dict(locale);
  const [hoveredTick, setHoveredTick] = useState(null);
  /* Hover tracking's own state -- see the onMouseMove handler on
     .rail__ticks below. Cached rect avoids a layout read on every mousemove
     event; the rAF handle caps the resulting re-render to once per frame
     instead of once per event (mousemove can fire far faster than the
     screen refreshes). */
  const railTicksRect = useRef(null);
  const hoverFrame = useRef(0);
  const pendingClientY = useRef(0);
  const rootRef = useRef(null);

  /* Mobile only: the rail fades out as the footer's own black ground climbs
   * up to meet it, rather than sitting drawn on top of that ground's own
   * close of the page. `--rail-fade` (read by .rail in globals.css) is set
   * live off the footer's measured position -- not a one-shot
   * IntersectionObserver threshold -- so the fade tracks scroll position
   * continuously in both directions, same rAF-gated-scroll-listener shape
   * as the hover tracking above and Reader.jsx's own position tracker.
   *
   * Fully lit until the footer's top edge reaches the BOTTOM of the
   * viewport (nothing of it visible yet); fully gone by the time that same
   * edge reaches the viewport's own MIDDLE, which is where .rail's `top:
   * 50%` holds it -- past that point the footer's ground would be running
   * behind the rail, not approaching it. Desktop is untouched: the
   * matchMedia guard below means the effect never runs there at all, and
   * .rail's own `var(--rail-fade, 1)` default keeps it at full opacity
   * with no listener attached.
   */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    let footer = null;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const root = rootRef.current;
      if (!root) return;
      if (!footer) footer = document.querySelector('.foot');
      if (!footer) return;
      const top = footer.getBoundingClientRect().top;
      const mid = window.innerHeight / 2;
      const t = Math.min(1, Math.max(0, (window.innerHeight - top) / (window.innerHeight - mid)));
      root.style.setProperty('--rail-fade', String(1 - t));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const sync = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (mq.matches) {
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        measure();
      } else {
        rootRef.current?.style.removeProperty('--rail-fade');
      }
    };

    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /**
   * The rail's hover taper -- length and brightness are two separate
   * questions here, deliberately decoupled.
   *
   * LENGTH is a continuous curve across every tick, current or not: each
   * one's distance from the hovered index maps through smoothstep (t*t*(3
   * -2t), not the raw linear distance) into its scaleX between the 0.2
   * floor and the 2.8 peak. Smoothstep eases both ends -- flat near the
   * hovered tick's own peak, flat again out at the floor, all the steepness
   * bunched in the middle -- so the whole rail reads as one continuous
   * curve, not a straight-sided ramp meeting a point (the "sharp triangle"
   * the linear version produced). The current tick gets no special
   * treatment in this part: it sits on the curve exactly where its
   * distance from the hover puts it, same as any other line, and can go
   * shorter than its own resting length if the hover is far from it.
   *
   * BRIGHTNESS is binary and is the one place current DOES get special
   * treatment: only the hovered tick and the current tick ever reach full
   * opacity. Every other tick stays at the same dark resting opacity
   * regardless of where it lands on the length curve -- a tick can grow
   * long from proximity to the hover without ever lighting up. This is the
   * opposite split from the length curve above: current is irrelevant to
   * length, decisive for brightness.
   */
  const tickStyle = (i) => {
    if (hoveredTick === null) return undefined;
    const dist = Math.abs(i - hoveredTick);
    const maxDist = Math.max(hoveredTick, books.length - 1 - hoveredTick);
    const linear = maxDist > 0 ? 1 - dist / maxDist : 1;
    const t = linear * linear * (3 - 2 * linear);
    const lit = i === hoveredTick || i === current;
    return {
      transform: `scaleX(${(0.2 + t * 2.6).toFixed(3)})`,
      opacity: lit ? 1 : 0.3,
    };
  };

  return (
    <div ref={rootRef} className={backHref ? 'rail rail--book' : 'rail'}>
      {/* `rail--book` only: a book page has somewhere for the full readout to
          point AT (this page's own place among the other sixteen), which is
          also why `backHref` alone is what distinguishes it from the shelf
          -- the shelf mounts this with no `backHref` at all. See the mobile
          block in globals.css, which shows the ticks only in this case. */}

      {/* Only rendered on a book page (see the doc comment above) -- there is
          no state to hide it in while it's mounted, so unlike the ticks
          below it needs no visibility toggle of its own. */}
      {backHref ? (
        <Link href={backHref} className="rail__back" aria-label={s.backToShelf}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M15 5 8 12l7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="square"
            />
          </svg>
        </Link>
      ) : null}

      {/* A position indicator, not navigation chrome: it says where in the
          catalogue the reader is, and lets them jump. Stays up through
          reading too, and clicking a tick jumps straight there (see
          `onJump`) rather than being inert. Only the current tick sits in
          the tab sequence (tabIndex below) so 17 always-present ticks
          don't turn a Tab from the back control into a march down the
          list. At rest every line is the same length -- the current tick
          only reads brighter, not longer. Hovering any one line grows it
          to a 2.8x peak, and every OTHER line -- current included --
          eases down from that same peak by a smoothstep curve of its
          distance from the hover, a continuous curved silhouette across
          the whole rail rather than a sharp linear ramp. Brightness is
          the separate, binary half of this: only the hovered tick and
          the current tick ever reach full opacity; every other line
          stays dark regardless of how long the curve has made it, see
          `tickStyle` above and .rail__tickLine in globals.css. The
          hovered book's title appears as real text beside its line for
          exactly as long as the hover lasts, nowhere else.

          Tracked continuously by ONE mousemove handler on the list itself
          rather than per-tick enter/leave: dividing the list's own
          measured height by the book count gives back exactly which tick
          the cursor is nearest, with no seam between adjacent ticks to
          fall through and no dead zone once a title is showing -- the
          list's own hoverable box already extends out to cover it (see
          .rail__ticks's padding-right in globals.css), so moving up or
          down while reading a title keeps tracking and lands on whichever
          book is now alongside the cursor instead of just dropping the
          hover.

          The rect is measured once per hover session (cached in
          railTicksRect, cleared on leave) rather than on every mousemove
          -- a fresh getBoundingClientRect() per event forces a layout
          read against whatever the previous render just wrote, and
          mousemove can fire far more often than the screen repaints. The
          resulting setHoveredTick is itself capped to one per animation
          frame via hoverFrame, same rAF-gating pattern as the scroll
          trackers in Shelf.jsx and Reader.jsx: only the latest clientY
          before each frame ever reaches state, so a fast sweep across the
          rail renders at most once per frame instead of once per raw
          event.

          The list's own onClick below jumps to hoveredTick directly,
          same value the highlight is drawn from -- so the clickable area
          is exactly the hoverable area, not just each tick's own 12px
          button. Without it, the gaps between ticks and the title
          readout past them would highlight a book on hover but do
          nothing on click. */}
      <ol
        className="rail__ticks"
        aria-label={s.railLabel}
        onMouseMove={(e) => {
          if (!railTicksRect.current) {
            railTicksRect.current = e.currentTarget.getBoundingClientRect();
          }
          pendingClientY.current = e.clientY;
          if (!hoverFrame.current) {
            hoverFrame.current = requestAnimationFrame(() => {
              hoverFrame.current = 0;
              const rect = railTicksRect.current;
              const i = Math.floor(
                ((pendingClientY.current - rect.top) / rect.height) * books.length
              );
              setHoveredTick(Math.max(0, Math.min(books.length - 1, i)));
            });
          }
        }}
        onMouseLeave={() => {
          railTicksRect.current = null;
          if (hoverFrame.current) {
            cancelAnimationFrame(hoverFrame.current);
            hoverFrame.current = 0;
          }
          setHoveredTick(null);
        }}
        onClick={() => {
          /* Click anywhere the hover tracking above already covers --
             the gaps between ticks, the title readout past the ticks'
             own narrow box -- rather than only the 12px-tall buttons.
             hoveredTick is exactly "whichever book this point belongs
             to", the same value the highlight itself is drawn from, so
             there is no dead space where hovering picks out a book but
             clicking does nothing. A click landing on a tick's own
             button still fires this too (bubbling), redundantly jumping
             to the same book its own onClick just did -- harmless. */
          if (hoveredTick !== null) onJump(hoveredTick);
        }}
      >
        {books.map((b, i) => (
          <li key={b.id} className="rail__tickItem">
            <button
              type="button"
              className="rail__tick"
              aria-current={i === current ? 'true' : undefined}
              onClick={() => onJump(i)}
              tabIndex={i === current ? 0 : -1}
            >
              <span className="rail__tickLine" aria-hidden="true" style={tickStyle(i)} />
              <span className="visually-hidden">{bookTitle(b, locale)}</span>
            </button>
            {hoveredTick === i ? (
              <span className="rail__activeTitle" aria-hidden="true">
                {bookTitle(b, locale)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
