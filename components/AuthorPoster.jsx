'use client';

import { useEffect, useRef } from 'react';

/**
 * The author's page as a folded poster that opens under the reader's scroll.
 *
 * WHY THIS IS GEOMETRY AND NOT A FRAME SEQUENCE. The obvious way to build this
 * is to render the fold as images and flip through them. It cannot work here:
 * the thing being folded is a photograph of a specific person, and no generator
 * reproduces a real face across twenty frames without drifting. Hinged planes
 * fold the actual file, stay exact at any size, scrub at whatever framerate the
 * reader's scroll produces rather than at whatever framerate was baked, and
 * cost three kilobytes instead of a sprite sheet.
 *
 * WHY EVERY PANEL CARRIES THE WHOLE SHEET. The crease runs across the type, and
 * a line of text cannot span two separately transformed elements. So each panel
 * holds a full copy of the poster and shows only its own band of it, the way a
 * folded sheet shows only the panel facing you. The alternative -- splitting the
 * bio into pieces and putting one in each panel -- breaks the moment the type
 * reflows and a sentence lands across a fold. Moot now that the bio is baked
 * into the paper image rather than set live, but the photo is still live, and
 * the same argument holds for it: it must land whole inside one panel, never
 * straddling a hinge (see the FOLDS comment below).
 *
 * The copies are the cost, and they are paid for in the accessibility tree: the
 * visible panels are aria-hidden, and ONE real copy carries the content. Below
 * the fold's breakpoint that copy is also what is displayed, so a phone gets the
 * genuine text rather than clipped duplicates of it. Nothing here is announced
 * twice, and there is no second source of truth -- both branches render the
 * same props.
 *
 * SCROLL OWNS IT. `--fold` runs 1 (folded, still below the reader) to 0 (open),
 * driven from the sheet's own position and nothing else. Scroll is read, never
 * written -- no pinning, no scroll-jacking, no snapping (DESIGN.md 6). Scrolling
 * back up folds it again, because a scrubbed animation that only plays forwards
 * is a video with extra steps.
 */

/* Where the real sheet actually creases, as fractions of its printed height,
 * measured off tools/covers-src/paper.png (0 = top edge, 1 = bottom edge). The
 * old six-panel version fabricated a crease every sixth because nothing but
 * CSS drew it; this paper is a photograph of a real folded sheet with three
 * creases already on it, in these three places and no others, so the panels
 * are built to match rather than the other way round. Re-measure and update
 * this if paper.png is ever replaced -- see tools/covers.mjs. */
const FOLDS = [0.274, 0.5037, 0.7331];
const BOUNDS = [0, ...FOLDS, 1];
const PANELS = BOUNDS.length - 1;

/* Where in the viewport the sheet is fully open, and where it is fully folded,
   as fractions of viewport height measured against the sheet's top edge. Open
   before it reaches the middle: the reader should be reading a flat page, not
   watching it finish arriving. */
const OPEN_AT = 0.2;
const FOLDED_AT = 0.86;

/* "Open" never means flat. A sheet that has been folded keeps a crease --
   it does not press itself back to nothing just because it is lying open on
   a table -- so --fold has a floor instead of a floor of zero, and the
   concertina and the panel shading (both scaled off --fold) stay visibly
   present even at full scroll, not just technically nonzero. */
const MIN_FOLD = 0.16;

/* How far the sheet leans toward the cursor, at the screen's own edges -- not
   the sheet's, so the reaction is to where the reader is looking on the
   whole page, not to how close the mouse happens to be to a small object.
   The vertical axis is capped tighter than the horizontal one: side-to-side
   is the sheet turning to face the reader, which is the whole of what
   leaning toward a cursor means; up-and-down is closer to nodding, and reads
   as a tic rather than attention past a couple of degrees. */
const MAX_TILT_X = 4;
const MAX_TILT_Y = 2;

/* How quickly the lean catches up to the cursor, per animation frame. Low on
   purpose: at 1 the sheet would snap to the pointer's exact position on every
   mousemove, which is what a UI control does, not what a leaning piece of
   paper does. This is the same "come back to flat slowly" whether the cursor
   is approaching the edge or leaving it -- one spring, not an animation with
   a direction. */
const TILT_EASE = 0.06;

export default function AuthorPoster({ name, bio, photo, photoAlt }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    /* Reduced motion gets the poster, not the folding. The sheet, the creases,
       the wear and the paper all stay -- they are what it looks like, not what
       it does. Only the movement goes. */
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const measure = () => {
      frame = 0;
      if (still.matches) {
        el.style.setProperty('--fold', String(MIN_FOLD));
        return;
      }
      const top = el.getBoundingClientRect().top;
      const vh = window.innerHeight || 1;
      const p = (top - vh * OPEN_AT) / (vh * (FOLDED_AT - OPEN_AT));
      el.style.setProperty('--fold', Math.min(1, Math.max(MIN_FOLD, p)).toFixed(4));
    };

    /* rAF-coalesced and passive, the same shape as the stack's own scroll
       reader: a scroll handler that measures synchronously on every event is
       how a page with a WebGL canvas on it starts dropping frames. */
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    still.addEventListener('change', measure);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      still.removeEventListener('change', measure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /* The sheet leans toward wherever the cursor is on the screen, on two axes
     at once -- rotateY for left/right, rotateX for up/down -- and eases back
     to flat as the cursor returns toward centre. Both ride alongside the
     fold's own rotateX rather than fighting it: --tilt-y is ADDED into the
     same rotateX the fold already uses (see .poster__sheet), which is valid
     because two rotations about the same axis commute -- rotateX(a)
     rotateX(b) is rotateX(a+b) regardless of order -- so which way the paper
     is being nodded at has nothing to do with how far open it is.

     A running lerp, not a CSS transition on `transform`: that property is
     ALSO where --fold's rotateX lives, and a transition on it would smooth
     out the fold's scroll-tracking too, breaking the "scroll IS the
     timeline" rule above. Easing the tilt in JS keeps the two motions on
     their own clocks sharing one property. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (still.matches) {
      el.style.setProperty('--tilt', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
      return undefined;
    }

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let raf = 0;

    const onMouseMove = (e) => {
      /* -1 at the left/top edge of the screen, 1 at the right/bottom, 0 dead
         centre on each axis. Y is inverted: cursor at the top should tip the
         sheet's top edge UP toward the reader, not away from them. */
      targetX = (e.clientX / (window.innerWidth || 1)) * 2 - 1;
      targetY = -((e.clientY / (window.innerHeight || 1)) * 2 - 1);
    };

    const tick = () => {
      currentX += (targetX - currentX) * TILT_EASE;
      currentY += (targetY - currentY) * TILT_EASE;
      el.style.setProperty('--tilt', `${(currentX * MAX_TILT_X).toFixed(3)}deg`);
      el.style.setProperty('--tilt-y', `${(currentY * MAX_TILT_Y).toFixed(3)}deg`);
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* The printed side of the sheet. Identical in every panel -- the panel's own
     clip is the only thing that differs, so the bands line up into one
     continuous poster. The paper itself (poster__face's background) carries
     the name and bio now; the only live layer left is the photo, so it stays
     whole inside the top panel rather than being reflowed into each copy. */
  const face = (
    <div className="poster__face">
      <div className="poster__plate" style={{ backgroundImage: `url(${photo})` }} />
    </div>
  );

  /* Built from the inside out so the hinges NEST: the outer panel's angle is
     measured from the one inside it rather than from the page, which is how
     the folds of real paper compound. Signs alternate -- a concertina, not a
     roll. */
  let stack = null;
  for (let i = PANELS - 1; i >= 0; i--) {
    /* --facet is which way this panel is turned. The hinges alternate, so odd
       panels are the ones tilted away from the reader and even ones face them.
       It is passed down because CSS cannot take --i modulo 2, and because it is
       what the lighting is keyed off: without a different shade per facet the
       geometry is invisible and the creases read as drawn lines.

       --band-start/--band-end are this panel's slice of the sheet, as
       fractions of its printed height (see FOLDS above) -- the panel's own
       height and the face's clip offset are both derived from them in CSS,
       so an uneven pitch costs nothing beyond not being --pitch anymore. */
    const panel = (
      <div
        className="poster__panel"
        style={{ '--facet': i % 2, '--band-start': BOUNDS[i], '--band-end': BOUNDS[i + 1] }}
        aria-hidden="true"
      >
        {face}
      </div>
    );
    stack =
      stack === null ? (
        panel
      ) : (
        <>
          {panel}
          <div className={`poster__hinge poster__hinge--${i % 2 === 0 ? 'back' : 'fwd'}`}>
            {stack}
          </div>
        </>
      );
  }

  return (
    <div className="poster" ref={ref}>
      <div className="poster__sheet" role="img" aria-label={photoAlt}>
        {stack}
      </div>
      {/* The one copy that is real. Visually hidden while the fold is on show,
          and the visible poster below the breakpoint where folding is off. */}
      <div className="poster__flat">
        <img className="poster__flatPhoto" src={photo} alt={photoAlt} width="350" height="350" />
        <h1 className="poster__flatName">{name}</h1>
        <p className="poster__flatBio">{bio}</p>
      </div>
    </div>
  );
}
