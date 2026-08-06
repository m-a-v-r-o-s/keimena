'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { NoToneMapping, SRGBColorSpace, PMREMGenerator, Object3D } from 'three';
import { buildEnvironment } from './env';
import BookVolume from './BookVolume';
import { bookById } from '@/lib/content';
import { SLOTS_CHANGED, DRAG_BOOK, CANVAS_READY, SHELF_CURRENT } from './events';
import { loadTexture, coverUrl, coverSmallUrl, spineUrl } from './textures';

/* Distance from the camera to the z=0 plane. The fov is derived from it so that
 * one world unit is exactly one CSS pixel at that plane -- which is what lets a
 * book be positioned straight from its DOM rect, with no projection maths and
 * no chance of the object drifting away from its own caption. */
const CAM_Z = 1200;
/* Two tiers, not one -- plan.md Phase 2.3. The old single OVERSCAN (1.0) meant
 * "mount a BookVolume and fetch its textures" were the same boundary, and at
 * this site's slot height that boundary sat almost a full viewport out on
 * both sides -- most of the catalogue, drawn and textured, the moment any of
 * it was onscreen at all. Split into how far out a volume is actually MOUNTED
 * (drawn, animated, holding a mesh) and how far out its textures start
 * warming the shared cache (below, from place() itself) without mounting
 * anything. 0.35 is tuned to the fold: raise it if a fast scroll ever shows a
 * volume popping in visibly at the edge of the mounted band; this session's
 * headless testing didn't find that edge, but it is exactly the kind of thing
 * that only shows on a real scroll, so watch for it. */
const MOUNT_OVERSCAN = 0.35;
const FETCH_OVERSCAN = 1.25;
const DRAG_SLOP = 6;  // px of movement before a press counts as a drag, not a click
/* How far the returning pile starts from where it belongs, as a fraction of the
   viewport. Enough that each block is off its own edge of the frame when it
   starts, so what the reader sees is the stack arriving rather than materialising
   in place. */
const RETURN_SLIDE = 0.62;

/* The key light's screen-space position, as a fraction of the viewport --
 * centre-right and a little above the books, close enough in Z to fall off
 * visibly across the shelf. See LIGHT_PLAN.md section 4. */
const KEY_X_FRAC = 0.3;
const KEY_Y_FRAC = 0.1;
const KEY_Z = 520;
/* three.js r155+ lights are physically sized: a point/spot's irradiance is
 * `intensity / distance^decay`, and the key sits roughly 600-800 CSS-pixel
 * "metres" from a book. decay=0 (no falloff) would light every book on the
 * shelf identically regardless of position, which defeats the point of a
 * POSITIONAL light; decay=2 (true inverse-square) is correct but needs an
 * intensity in the hundreds of thousands to read as anything at that
 * distance. Split the difference at decay=1.2 -- enough falloff that the
 * beam is visibly a beam, not so much that the far end of the shelf goes
 * black -- and scale intensity to match. */
const KEY_DECAY = 1.2;
const KEY_INTENSITY = 4200;

function Scene({ slotsRef, version, mobile, reduced }) {
  const { camera, size, invalidate, gl, scene } = useThree();
  const [, force] = useState(0);
  const keyTarget = useMemo(() => new Object3D(), []);

  /* The environment exists for one thing: foil and any other metal needs
     something to reflect, or it renders black. Prefiltered once. */
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const source = buildEnvironment();
    const env = pmrem.fromEquirectangular(source).texture;
    scene.environment = env;
    /* D20: the room now does the whole job alone -- ambientLight and the
       fill directionalLight were removed below, so this is the only source
       left besides the key spotLight (for diffuse fill; D21 zeroed the
       env map's contribution to reflections separately, in materials.js,
       and this value has no effect on that). D22: raised to 3/4 of the
       original D16/D17 brightness -- KEY and RIM in env.js are back to
       their original colour (see there), so this one number is now the
       ONLY thing scaling the room, instead of two multipliers compounding
       to an answer neither number alone told you. See DECISIONS.md D22. */
    scene.environmentIntensity = 0.75;
    source.dispose();
    pmrem.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene, invalidate]);

  useEffect(() => {
    camera.fov = (2 * Math.atan(size.height / 2 / CAM_Z) * 180) / Math.PI;
    camera.position.set(0, 0, CAM_Z);
    /* The scene is a thin slab around z=0, roughly a viewport deep. Spanning
       1..3600 spent almost all of the depth buffer's precision on empty space
       in front of and behind it, and the book's own parts -- a few pixels
       apart -- were left fighting over what remained. */
    camera.near = CAM_Z * 0.45;
    camera.far = CAM_Z * 1.75;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.height, invalidate]);

  /* Re-render the slot list only when the set of books changes -- never on
     scroll, which mutates coordinates in place instead. */
  useEffect(() => force((n) => n + 1), [version]);

  /* Screen-space, so it has to be read from `size` and re-placed on resize --
     a directionalLight has no location and would give every book on the page
     the identical vector, and the beam could never fall off across the
     frame. Computed at render time rather than in an effect: `size` changing
     already re-renders Scene, and the position prop update alone is enough
     for R3F's demand frameloop to invalidate and redraw on the same pass. */
  const keyX = size.width * KEY_X_FRAC;
  const keyY = size.height * KEY_Y_FRAC;

  return (
    <>
      {/* No ambientLight, no fill directionalLight (D20) -- both removed
          outright rather than kept at intensity 0. D16 through D19 spent
          four passes cutting ambient (0.95 -> 0.40 -> 0.12) and the fill
          (0.18 -> 0) because every remaining watt of flat, directionless
          light was diluting the one thing this rig is actually for: a
          highlight that travels when a book turns. Zero is where that
          series was always headed. What is left is the key spotLight below,
          which is a real point in space, and the environment map two lines
          up, which is the room itself -- between the two, nothing needs a
          third, undirected source to keep it off pure black; the far side
          of a board going dark is now the correct read, not a bug to patch
          with ambient. Confirmed against tools/render-check.mjs before this
          was made permanent -- see DECISIONS.md D20 for the number. */}

      {/* Key -- positional and warm, centre-right of the viewport. This is
          the light the brief is about: it must be a real point in space, not
          a vector, or turning a book could never change what it sees. Angle
          narrowed from the plan's starting 0.85 rad -- that wide a cone with
          penumbra 0.9 floods a whole spine evenly, which reads as another
          flat wash rather than a highlight that travels. Narrower cone, same
          intensity, concentrates the same energy into an actual highlight
          instead of spreading it. */}
      <primitive object={keyTarget} position={[0, 0, 0]} />
      <spotLight
        position={[keyX, keyY, KEY_Z]}
        target={keyTarget}
        angle={0.55}
        penumbra={0.75}
        decay={KEY_DECAY}
        distance={0}
        color="#FFEAD2"
        intensity={KEY_INTENSITY}
      />

      {slotsRef.current.map((slot) =>
        slot.mountOnscreen ? (
          <BookVolume
            key={slot.key}
            slot={slot}
            mobile={mobile}
            reduced={reduced}
            invalidate={invalidate}
          />
        ) : null
      )}
    </>
  );
}

/**
 * The one canvas. Fixed, full-viewport, pointer-events: none, aria-hidden.
 *
 * It draws; it does not own anything. Every book is a real element in the
 * server-rendered DOM underneath -- that is what carries the link, the
 * accessible name, the keyboard focus and the crawlable text, and it is what
 * remains if WebGL never starts. The canvas only reads the DOM's layout and
 * paints an object over it. See DECISIONS.md D7.
 */
export default function BookCanvas() {
  const slotsRef = useRef([]);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [reduced, setReduced] = useState(false);
  const invalidateRef = useRef(() => {});
  const drag = useRef(null);
  const rafRef = useRef(0);
  /* The last index published on SHELF_CURRENT (Phase 2.5) -- compared every
     tick so the event only fires on an actual change, the same discipline
     `changed`/setVersion already follows below for mountOnscreen. */
  const currentRef = useRef(0);

  /**
   * Rects are measured LIVE, every frame, never cached against the document.
   *
   * An earlier version stored each slot's document-space top once and offset it
   * by scrollY. That is only correct for elements that sit still in normal
   * flow: anything pinned, sticky, or mid-CSS-transition kept its stale
   * coordinate, and its book drifted off to somewhere the reader could not see.
   * Measuring live costs one getBoundingClientRect per visible slot and makes
   * the whole class of drift impossible -- including, deliberately, the
   * transition from the stack into the detail layout, which is nothing but a
   * slot box moving.
   */
  const place = useCallback(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const mountMargin = H * MOUNT_OVERSCAN;
    const fetchMargin = H * FETCH_OVERSCAN;
    let changed = false; // a slot's mountOnscreen flipped -- forces the React re-render Scene's .map needs
    /* Whether anything a BookVolume actually reads (position, size,
       progress) moved this tick -- plan.md Phase 2.6's quiescence signal.
       Gates the invalidate() below, and its return value gates the tick
       loop itself: nothing here bypasses the reconciler except an imperative
       write inside a useFrame closure, so nothing here needs a redraw when
       every one of those writes was a no-op. */
    let moved = false;
    /* Which mounted slot is nearest the viewport's middle -- see SHELF_CURRENT
       in events.js. Tracked alongside the same rect this loop already reads
       for `s.progress`, rather than a second pass over the elements. */
    let bestIdx = -1;
    let bestProgress = -Infinity;

    for (let i = 0; i < slotsRef.current.length; i++) {
      const s = slotsRef.current[i];
      const r = s.el.getBoundingClientRect();
      const was = s.mountOnscreen;
      s.mountOnscreen = r.bottom > -mountMargin && r.top < H + mountMargin && r.width > 0;
      if (s.mountOnscreen !== was) {
        changed = true;
        moved = true;
      }

      /* The fetch tier warms the shared texture cache for a slot well before
         it is due to be mounted and drawn, so by the time MOUNT_OVERSCAN's
         tighter boundary reaches it, `loadTexture`'s cache already has (or is
         already fetching) what BookVolume's own mount effect is about to ask
         for -- same URL, same cache, no second request. Fired once, on the
         transition INTO the fetch band, not every frame this loop runs. */
      const wasFetching = s.fetchOnscreen;
      s.fetchOnscreen = r.bottom > -fetchMargin && r.top < H + fetchMargin && r.width > 0;
      if (s.fetchOnscreen && !wasFetching) {
        loadTexture(s.pose === 'upright' ? coverUrl(s.book.id) : coverSmallUrl(s.book.id));
        loadTexture(spineUrl(s.book.id));
      }

      if (!s.mountOnscreen) continue;

      const width = r.width;
      const height = r.height;
      const x = r.left + r.width / 2 - W / 2;
      const y = -(r.top + r.height / 2 - H / 2);
      /* Sub-pixel jitter (layout rounding, not actual motion) must not keep
         the tick loop awake forever -- 0.05px is well under anything a
         reader could perceive, but well over the floating-point noise a
         static element's own rect can carry between two calls. */
      if (
        Math.abs(x - s.x) > 0.05 ||
        Math.abs(y - s.y) > 0.05 ||
        Math.abs(width - s.width) > 0.05 ||
        Math.abs(height - s.height) > 0.05
      ) {
        moved = true;
      }
      s.width = width;
      s.height = height;
      s.x = x;
      s.y = y;

      /* How near the reading zone this book is: 1 at the centre of the
         viewport, 0 at either edge. The stack's motion is driven from this.
         It reads scroll and never writes it, so a hijack is impossible here by
         construction rather than by convention. */
      const centre = r.top + r.height / 2;
      const progress = 1 - Math.min(1, Math.abs(centre - H / 2) / (H / 2));
      if (Math.abs(progress - s.progress) > 0.0005) moved = true;
      s.progress = progress;
      if (progress > bestProgress) {
        bestProgress = progress;
        bestIdx = i;
      }
    }

    /* At the very top of the page the first slot's row can sit ABOVE the
       viewport's vertical middle (there's a nav/hero above the stack), so
       the nearest-to-mid heuristic above picks the second slot instead --
       carried over from Shelf.jsx's own version of this check, which this
       replaces (plan.md Phase 2.5): scroll position 0 unambiguously means
       "the first slot", so it short-circuits rather than relying on the
       heuristic to get that edge case right. bestIdx otherwise stays -1
       only when nothing is mounted yet, which a fresh SLOTS_CHANGED/rebuild
       corrects on its very next tick -- not worth publishing in the
       meantime. */
    const current = window.scrollY <= 0 ? 0 : bestIdx;
    if (current >= 0 && current !== currentRef.current) {
      currentRef.current = current;
      window.dispatchEvent(new CustomEvent(SHELF_CURRENT, { detail: { index: current } }));
    }

    if (changed) setVersion((v) => v + 1);
    /* Gated on `moved`, not called unconditionally: every write this
       function makes to a slot is read imperatively inside BookVolume's own
       useFrame, bypassing the reconciler, which is the ONE reason this needs
       an explicit invalidate() at all (everything that goes through props --
       mount/unmount, `version` itself -- already invalidates on its own,
       see r3f's own demand-frameloop behaviour). Nothing moved means nothing
       for a redraw to show. */
    if (moved) invalidateRef.current();
    return moved;
  }, []);

/**
 * Stage the pile's return.
 *
 * Clearing is instant and stays that way -- it is getting out of the way of a
 * gesture already under way, and any delay there reads as the page being slow.
 * Coming BACK is the opposite, and it comes back as TWO BLOCKS: everything that
 * was above the book the reader handled, and everything below it.
 *
 * Each block is rigid. Every book in it is given the SAME travel, so the pile
 * arrives already stacked -- the books do not resolve into a stack, they are one
 * and move like one, and the spacing a reader saw before they opened a book is
 * the spacing it comes back with. The two blocks close on the gap from opposite
 * sides: the one above starts off the top of the frame and comes DOWN, the one
 * below starts off the bottom and comes UP.
 *
 * This replaces a per-book wait (each book trailing the one further out than it
 * by 0.05s). That cascade was the thing to lose: it made the stack assemble
 * itself a slab at a time in front of the reader, which draws the eye to the
 * individual books at exactly the moment the pile should read as one object
 * again. The travel is what carries the motion now, and the direction is what
 * carries the meaning -- the shelf closing over the space the book came out of.
 *
 * World Y is flipped from DOM Y (see measure), so +Y is up the screen: the
 * upper block starts POSITIVE and eases down to nothing.
 *
 * Computed only while something is actually dimmed -- which is the only moment
 * the focus exists. On release nothing is dimmed, findIndex would answer 0, and
 * every travel would be recomputed against the wrong book at exactly the moment
 * they are about to be used. Leaving the last staging in place is the point.
 *
 * Grouped by `slotKey` before any of that: the shelf pile and the reader's
 * rows are two unrelated populations that happen to share this one flat
 * array (see rebuild's `${id}:${slotKey}` keying), and while reading, every
 * shelf slot is dimmed together while no reader row ever is. Pooling them
 * would hand `findIndex` an arbitrary reader row as "focus" the moment the
 * shelf's own dim state changes, and the shelf's return travel would be
 * computed against a book that was never part of its pile. Per-group focus
 * keeps this exactly what it always was: the shelf staging its own return.
 */
function stageReturns(slots) {
  const groups = new Map();
  for (const s of slots) {
    const group = groups.get(s.slotKey);
    if (group) group.push(s);
    else groups.set(s.slotKey, [s]);
  }
  const travel = window.innerHeight * RETURN_SLIDE;
  for (const group of groups.values()) {
    if (!group.some((s) => s.dim || s.dimByDrag)) {
      for (const s of group) s.returnFrom = 0;
      continue;
    }
    const focus = group.findIndex((s) => !(s.dim || s.dimByDrag));
    for (let i = 0; i < group.length; i++) {
      /* The handled book itself never left, so it never travels. */
      group[i].returnFrom = focus < 0 || i === focus ? 0 : i < focus ? travel : -travel;
    }
  }
}

  const rebuild = useCallback(() => {
    const els = [...document.querySelectorAll('[data-book-slot]')];
    const prev = new Map(slotsRef.current.map((s) => [s.key, s]));

    slotsRef.current = els
      .map((el) => {
        const id = el.dataset.bookSlot;
        const book = bookById(id);
        if (!book) return null;
        const slotKey = el.dataset.slotKey ?? '0';
        const key = `${id}:${slotKey}`;
        /* Reuse the existing slot object where one exists, so a book keeps its
           volume -- and therefore its rotation and its drag -- across a layout
           change. Replacing it would remount the mesh and lose the transition
           that makes selecting a book feel continuous. */
        const s = prev.get(key) ?? {
          key,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          progress: 0,
          mountOnscreen: false,
          fetchOnscreen: false,
          hovered: false,
          dragging: false,
          dimByDrag: false,
          applyDrag: null,
        };
        s.el = el;
        s.book = book;
        /* Which population this slot belongs to -- the shelf pile or a
           reader row (see Catalogue.jsx's data-slot-key="read"). Read by
           stageReturns above and the drag guard below, both of which need
           to tell the two populations apart even though they share this one
           flat array. */
        s.slotKey = slotKey;
        s.pose = el.dataset.pose ?? 'stacked';
        s.free = el.dataset.free !== undefined;
        s.dim = el.dataset.dim !== undefined;
        return s;
      })
      .filter(Boolean);

    stageReturns(slotsRef.current);
    setVersion((v) => v + 1);
    place();
  }, [place]);

  useEffect(() => {
    const mqMobile = window.matchMedia('(max-width: 767px)');
    const mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMq = () => {
      setMobile(mqMobile.matches);
      setReduced(mqReduced.matches);
    };
    syncMq();
    mqMobile.addEventListener('change', syncMq);
    mqReduced.addEventListener('change', syncMq);

    rebuild();

    /* One rAF loop drives placement. Scroll alone is not enough: a slot can
       also be moving because CSS is transitioning it, and that produces no
       scroll events at all.
     *
     * IDLES after IDLE_LIMIT consecutive ticks where `place()` found nothing
     * moved (plan.md Phase 2.6) -- most of a session has the reader not
     * scrolling, no drag in flight, no CSS transition running, and this loop
     * was polling every mounted slot's `getBoundingClientRect` every ~12ms
     * regardless, forever: a permanent main-thread cost that outlives the
     * page load Phase 1/2's other work targets. STOPS SCHEDULING further
     * frames rather than scheduling-and-skipping-the-work, and re-arms on
     * exactly the things that can start a slot moving again without this
     * component already knowing in advance -- a scroll, a drag starting, a
     * resize, a fresh layout (SLOTS_CHANGED), or a CSS transition beginning
     * or ending (a book's own pose transition is exactly this: it produces
     * no scroll event of its own). Re-arming still measures LIVE from the
     * very next tick -- idling is a scheduling decision, not a cache; see
     * the `place` doc comment above for why caching a coordinate instead of
     * measuring it would be the wrong fix. */
    let last = 0;
    let idleStreak = 0;
    let idle = false;
    const IDLE_LIMIT = 20; // ~240ms of continuous stillness at the throttle below

    const tick = (t) => {
      if (t - last >= 12) {
        last = t;
        if (place()) idleStreak = 0;
        else idleStreak++;
      }
      if (idleStreak >= IDLE_LIMIT) {
        idle = true;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const wake = () => {
      if (!idle) return;
      idle = false;
      idleStreak = 0;
      rafRef.current = requestAnimationFrame(tick);
    };

    const onResize = () => {
      wake();
      rebuild();
    };
    const onSlots = () => {
      wake();
      rebuild();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener(SLOTS_CHANGED, onSlots);
    window.addEventListener('scroll', wake, { passive: true });
    document.addEventListener('pointerdown', wake);
    document.addEventListener('transitionrun', wake);
    document.addEventListener('transitionend', wake);

    /* Fonts settle after first paint and move the slots with them. */
    const settle = setTimeout(onResize, 400);

    return () => {
      mqMobile.removeEventListener('change', syncMq);
      mqReduced.removeEventListener('change', syncMq);
      window.removeEventListener('resize', onResize);
      window.removeEventListener(SLOTS_CHANGED, onSlots);
      window.removeEventListener('scroll', wake);
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('transitionrun', wake);
      document.removeEventListener('transitionend', wake);
      cancelAnimationFrame(rafRef.current);
      clearTimeout(settle);
      document.documentElement.classList.remove('webgl-on');
    };
  }, [rebuild, place]);

  /* ---- Keyboard-focus modality ----------------------------------------------
   * html.using-keyboard is what globals.css's `.webgl-on .slot__hit:focus-
   * visible` rule gates on to decide whether the flat DOM fallback bar should
   * reveal itself over a book's WebGL volume. Plain `:focus-visible` isn't
   * enough on its own: a browser that has seen no input yet in the current
   * document treats a programmatic `.focus()` call as keyboard-like by
   * default, and Shelf.jsx's hash-restore effect (`/#book-<id>`) calls one on
   * every load -- so without an explicit signal the fallback bar would sit lit
   * in front of that one book regardless of whether the reader is on a mouse,
   * a trackpad or a keyboard. Tab is the key that actually matters here (it's
   * what moves focus between spines); any pointerdown clears it, so a click or
   * tap immediately drops back to trusting the WebGL volume alone. */
  useEffect(() => {
    const onKeydown = (e) => {
      if (e.key === 'Tab') document.documentElement.classList.add('using-keyboard');
    };
    const onPointerDown = () => {
      document.documentElement.classList.remove('using-keyboard');
    };
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  /* ---- Pointer ------------------------------------------------------------
   * Listeners live on the document, not the canvas: the canvas is
   * pointer-events: none so the real DOM control underneath stays clickable and
   * focusable. A press that becomes a drag rotates the book and is then
   * prevented from also activating it.
   */
  useEffect(() => {
    const slotFor = (target) => {
      const el = target?.closest?.('[data-book-slot]');
      if (!el) return null;
      return slotsRef.current.find((s) => s.el === el) ?? null;
    };

    /* A book lives inside a control, and dragging a link is how the browser
       starts a native drag-and-drop: it fires pointercancel and takes the
       gesture away mid-rotation. Refusing dragstart is what makes the book
       draggable at all. */
    const onDragStart = (e) => {
      if (e.target?.closest?.('[data-book-slot]')) e.preventDefault();
    };

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      const slot = slotFor(e.target);
      if (!slot || slot.dim) return;
      drag.current = { slot, x: e.clientX, y: e.clientY, moved: 0 };
    };

    const onMove = (e) => {
      const d = drag.current;
      if (!d) {
        const slot = slotFor(e.target);
        let changed = false;
        for (const s of slotsRef.current) {
          const h = s === slot && !s.dim;
          if (s.hovered !== h) {
            s.hovered = h;
            changed = true;
          }
        }
        if (changed) invalidateRef.current();
        return;
      }

      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);

      /* Touch: a vertical drag is the page scrolling and must never be stolen.
         Only a clearly horizontal gesture rotates the book. */
      if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }

      if (d.moved > DRAG_SLOP && !d.slot.dragging) {
        d.slot.dragging = true;
        document.documentElement.classList.add('is-dragging');
        /* Turning a book in a stack of twenty-nine is impossible if the
           neighbours stay in the way -- they occlude it at exactly the angles
           worth looking at. So the rest of that SAME pile clears out for as
           long as the reader is handling one, and comes back when they let
           go -- scoped to the dragged slot's own group (the grouping
           stageReturns already uses), because a reader row's "pile" is
           every other book on the page's own continuous scroll, which never
           occlude one another and have nothing here worth clearing. */
        if (d.slot.slotKey !== 'read') {
          for (const s2 of slotsRef.current) {
            s2.dimByDrag = s2.slotKey === d.slot.slotKey && s2 !== d.slot;
          }
          stageReturns(slotsRef.current);
        }
        window.dispatchEvent(new CustomEvent(DRAG_BOOK, { detail: { id: d.slot.book.id } }));
        invalidateRef.current();
      }
      if (d.moved > DRAG_SLOP && e.cancelable) e.preventDefault();
      if (d.slot.dragging) d.slot.applyDrag?.(dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    };

    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      document.documentElement.classList.remove('is-dragging');
      for (const s2 of slotsRef.current) s2.dimByDrag = false;
      window.dispatchEvent(new CustomEvent(DRAG_BOOK, { detail: { id: null } }));
      if (!d) {
        invalidateRef.current();
        return;
      }
      d.slot.dragging = false;
      if (d.moved > DRAG_SLOP) {
        /* Swallow exactly the click this drag would otherwise fire. */
        const swallow = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
      }
      invalidateRef.current();
    };

    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /**
   * Clear the loader -- once, and only once both the renderer and the covers
   * a reader actually sees at load are ready.
   *
   * `ready` alone is not enough: it fires as soon as the WebGL context exists,
   * which is before a single texture has arrived, so clearing on it alone
   * would drop the reader onto flat-coloured placeholder volumes and call that
   * "loaded". Waiting on every book's cover is too much the other way -- most
   * of the shelf is still off-screen and has not even started fetching. So
   * this waits on exactly the slots `place()` has already marked mounted
   * (MOUNT_OVERSCAN, not the wider fetch tier -- see the constants above),
   * through the same `loadTexture` cache BookVolume itself draws from: no
   * second request, no extra bytes, just the same promise resolving twice.
   *
   * Waits on whichever front sheet that slot's OWN pose will actually show --
   * the small shelf sheet for a stacked slot, the full one for a slot that
   * mounts upright (a book's own page) -- matching BookVolume's own mount
   * effect exactly (plan.md Phase 2.2). Waiting on the full sheet
   * unconditionally, as this used to, meant the loader held the page open for
   * bytes the reader's own first paint was never going to show: a stacked
   * slot's material paints from the small sheet regardless, so the full one
   * arriving sooner or later made no visible difference except to how long
   * the loader stayed up.
   *
   * `allSettled`, not `all` -- a dropped connection on one cover must not hold
   * the whole page hostage behind the loader forever. The 12s inline script in
   * the root layout is the backstop if this effect never runs at all.
   */
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    const covers = slotsRef.current
      .filter((s) => s.mountOnscreen)
      .flatMap((s) => [
        loadTexture(s.pose === 'upright' ? coverUrl(s.book.id) : coverSmallUrl(s.book.id)),
        loadTexture(spineUrl(s.book.id)),
      ]);
    Promise.allSettled(covers).then(() => {
      if (!cancelled) document.documentElement.setAttribute('data-loaded', '');
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  return (
    <div className="bookcanvas" aria-hidden="true" data-ready={ready ? '' : undefined}>
      <Canvas
        frameloop="demand"
        /* Desktop cap tried at 1.75 (plan.md Phase 3.3, a ~23% fill-rate cut
           against 2 on a Retina display) and screenshotted at device scale
           factor 2 against the original cap on the raked edges -- the
           sharpest lines in the scene, and where a resolution cut would show
           first. See DECISIONS.md for the result. */
        dpr={[1, mobile ? 1.5 : 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0, CAM_Z], fov: 45 }}
        onCreated={({ gl, invalidate }) => {
          gl.toneMapping = NoToneMapping;
          gl.outputColorSpace = SRGBColorSpace;
          invalidateRef.current = invalidate;

          /* `webgl-on` is what hides the DOM fallback, so it may only be set
             once a renderer demonstrably exists -- not when the component
             mounts. Setting it on mount meant a browser without WebGL got the
             fallback hidden and no books drawn in its place: a blank shelf,
             the exact failure the DOM layer exists to prevent. onCreated does
             not fire if the context cannot be created. */
          document.documentElement.classList.add('webgl-on');
          setReady(true);
          window.dispatchEvent(new Event(CANVAS_READY));
        }}
      >
        <Scene slotsRef={slotsRef} version={version} mobile={mobile} reduced={reduced} />
      </Canvas>
    </div>
  );
}
