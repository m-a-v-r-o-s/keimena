'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Quaternion, RepeatWrapping, FrontSide, BackSide } from 'three';
import { POSE, AXIS_X, AXIS_Y, assembly, faceColor, poseQuaternion } from './book-model';
import { spineGeometry, inlayGeometry } from './spine-geometry';
import {
  loadTexture,
  surface,
  coverUrl,
  coverSmallUrl,
  spineUrl,
  FOREDGE_URL,
  TOPEDGE_URL,
  CLOTH_URL,
  BOARD_URL,
  ENDPAPER_URL,
  HEADBAND_URL,
} from './textures';
import { FRONT_BOARD, BACK_BOARD, SPINE, EDGE, PAGES, HEADBAND, HOLLOW, ENDPAPER } from './materials';
import { DRAG_BOOK } from './events';

const EASE = 0.14;      // slerp toward the target pose, per frame at 60fps
const SIZE_EASE = 0.18; // and toward the target size, when a pose changes it
const SPIN_DECAY = 0.9; // inertia falloff after a drag is released
/* The stack clears almost immediately. This is not a reveal to be savoured --
 * it is getting out of the way of a gesture already in progress, and any
 * perceptible lag reads as the page being slow rather than as choreography. */
const DIM_EASE = 0.45;
/* Coming back is the other way round, and deliberately so. Clearing serves the
 * gesture; returning has nothing to serve, so it takes its time.
 *
 * This one number now carries the whole return. It used to share the work with a
 * per-book wait staged by BookCanvas, so the stack's total duration was mostly
 * stagger and this only had to fade one slab; with the pile coming back as two
 * rigid blocks there is no stagger left to spend, and 0.16 would have snapped
 * the entire shelf into place in about a fifth of a second. Eased to roughly
 * the duration the staggered version took overall, which is the tempo the rest
 * of the page was built against -- the motion moved, not the pacing.
 *
 * It drives the travel as well as the fade (`slot.returnFrom`, in BookVolume's
 * frame below), so a block's arrival and its appearance are the same event. */
const RETURN_EASE = 0.085;

/* On mobile the stack runs full-bleed (see .slot on mobile in globals.css),
 * wide enough for the stacked pose's spine face to show its whole spine
 * sheet -- author, title and imprint together (see buildSpine in
 * tools/covers.mjs, which lays them out left to right in exactly that
 * order). Scaled up by this factor instead, the book overflows the screen
 * equally on both sides (it stays centred on its slot), so what falls off
 * is the two ends: the author's name, set flush left at 6% of the sheet,
 * and the imprint's mark, held flush right at 94% -- leaving only the
 * title, which the sheet keeps centred and never lets grow past 46% of the
 * sheet's own width. 1.6x leaves a 62%-wide window on screen, comfortably
 * inside that 46% ceiling even for the longest title in the catalogue,
 * with both ends clear of it. Applied only to the stacked pose: the
 * upright reading pose is sized off the slot's height, not its width, and
 * has no ends to hide. */
const MOBILE_STACK_ZOOM = 1.6;

/* The fallback base for a partial `setMaps` merge (Phase 2.1's two
 * independent fetch groups, below) -- whichever group resolves first has
 * nothing yet to spread from a still-null `maps`, so it spreads this instead.
 * Every field stays null (flat colour) until its own group actually arrives. */
const BLANK_MAPS = {
  cover: null,
  spine: null,
  foreEdge: null,
  headEdge: null,
  cloth: null,
  clothBump: null,
  board: null,
  endpaper: null,
  headband: null,
};

/**
 * One book, as a real volume.
 *
 * Position and size come from the DOM: the canvas measures the book's slot
 * element every frame and passes screen pixels straight through, because the
 * scene runs at 1 unit = 1px. So when the slot moves -- including when CSS
 * transitions it from the stack into the detail layout -- the object follows it
 * exactly, and cannot drift away from the text that describes it.
 *
 * Rotation is a single quaternion slerped toward the pose's target, which is
 * what makes a book rotate smoothly from lying in the stack to standing upright
 * rather than cutting between two states.
 */
export default function BookVolume({ slot, mobile, reduced, invalidate }) {
  const group = useRef();
  const body = useRef();
  const spin = useRef(0);
  const dragX = useRef(0);
  const dragY = useRef(0);
  const size = useRef(0);
  const dim = useRef(1);

  const target = useMemo(() => new Quaternion(), []);
  const scratch = useMemo(() => new Quaternion(), []);

  const parts = useMemo(() => assembly(slot.book), [slot.book]);

  /* The spine's profile is drawn rather than taken from a primitive, so its two
     meshes are built here and disposed with the book. Both come off the SAME
     spec: the headband is the spine's own outline, shrunk and closed, which is
     the only way the plug can stay inside the covering at every thickness. */
  const geo = useMemo(
    () => ({
      spine: spineGeometry(parts.spine),
      headband: spineGeometry(
        { ...parts.spine, height: parts.headband.height },
        { scale: parts.headband.scale, capped: true }
      ),
      inlay: inlayGeometry(parts.spine, parts.inlay),
    }),
    [parts]
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const c = useMemo(
    () => ({
      cover: faceColor('cover', slot.book.accent),
      spine: faceColor('spine', slot.book.accent),
      back: faceColor('back', slot.book.accent),
      pages: faceColor('pages', slot.book.accent),
      /* The board's cut edge, and the groove beside the spine. Both are the
         binding seen end-on, so both are darker than any printed surface. */
      edge: faceColor('back', slot.book.accent).clone().multiplyScalar(0.8),
      hinge: faceColor('back', slot.book.accent).clone().multiplyScalar(0.42),
    }),
    [slot.book.accent]
  );

  /* Textures arrive after the volume does. The book is already correct in flat
     accent before they land, so a slow connection shows a plain coloured book
     rather than a hole -- the same reason the flat shading exists at all. */
  const [maps, setMaps] = useState(null);
  /* Set once the cover map has been upgraded to the full-resolution sheet, so
     it is only ever fetched once, from whichever of its two triggers (below)
     reaches it first. Starts true for a book that mounts already upright --
     it loads the full sheet from the first frame and there is nothing to
     upgrade FROM. A stacked slot mounts on the small shelf sheet and only
     ever moves up to the full one, never back down. */
  const upgraded = useRef(slot.pose === 'upright');
  /* The two triggers plan.md Phase 2.4 asks for: a reader dragging a stacked
     book (below) is about to see far more of the cover than the resting
     sliver, and a slot that mounts already upright -- a book's own page --
     already gets the full sheet from its very first fetch (see `frontUrl` in
     the mount effect), so `upgraded` starting `true` for that case is what
     satisfies that trigger; there is no separate fetch to wire for it. This
     function is the one place either trigger calls into, so "fetched once,
     from whichever happens first" is enforced in a single spot rather than
     duplicated at each call site. */
  const upgradeCover = () => {
    if (upgraded.current) return;
    upgraded.current = true;
    loadTexture(coverUrl(slot.book.id)).then((cover) => {
      setMaps((m) => (m ? { ...m, cover } : m));
      invalidate();
    });
  };
  /* Dragging a STACKED book never changes its pose -- it only rotates in
     place -- so the useFrame upgrade below, which is keyed on the pose
     turning upright, never fires for it. A drag is exactly when a reader
     sees far more of the cover than the raked resting sliver, so it needs
     its own trigger, independent of pose. */
  useEffect(() => {
    const onDrag = (e) => {
      if (e.detail?.id === slot.book.id) upgradeCover();
    };
    window.addEventListener(DRAG_BOOK, onDrag);
    return () => window.removeEventListener(DRAG_BOOK, onDrag);
  }, [slot.book.id]);
  useEffect(() => {
    let live = true;
    const id = slot.book.id;
    /* The stacked pose shows the cover as a sliver a few pixels deep
       (POSE.stacked.rake, book-model.js) -- see coverSmallUrl's own comment
       in textures.js for why the full 683x1024 photograph is wasted there.
       Upright (a reader row, or a book's own page) is where a cover is
       actually seen whole, so it starts on the real thing. Read once, here,
       rather than made a dependency: `slot.pose` is a plain property on a
       mutable object, not React state (see the useFrame comment below on
       why), so this effect intentionally only re-runs when the BOOK changes. */
    const frontUrl = slot.pose === 'upright' ? coverUrl(id) : coverSmallUrl(id);

    /* Two independent fetch groups, not one chain -- plan.md Phase 2.1. The
       book's own cover+spine used to be gated behind the SHARED surface
       sheets (foredge/topedge/cloth/board/endpaper/headband), because both
       groups fed one `setMaps` call at the end of a single chain. That means
       the spine -- what a reader is actually looking at in the stack --
       waited on five more files that are cached instantly for every book
       after the first, but cost real bytes and decode time for whichever
       book happens to load first on a cold page. Each group now calls
       `setMaps` on its own arrival; per-field keys throughout the JSX below
       (`${i}:${map ? 'tex' : 'flat'}`) already tolerate a material's map
       showing up after the mesh's first paint, which is what makes this
       safe to split without touching the render code at all. */
    Promise.all([loadTexture(frontUrl), loadTexture(spineUrl(id))])
      .then(([cover, spine]) => {
        if (!live) return;
        /* The spine sheet is authored landscape; on the canonical geometry the
           spine face is tall and narrow, so it is always turned. Cloned first:
           the cache hands the same texture to every book that shows it, and
           rotating the shared instance would turn all of them. */
        const sp = spine.clone();
        sp.center.set(0.5, 0.5);
        sp.rotation = -Math.PI / 2;
        sp.needsUpdate = true;

        /* The cover is used exactly as the publisher authored it -- no clone,
           no rotation, no pose-dependent mapping. It therefore keeps its true
           portrait proportions and is never stretched to fit a face.
           Lying flat with the spine toward the reader, the book's head axis is
           forced sideways, so a portrait cover reads turned on its side. That
           is simply what a stack of books looks like, and it is the version
           that keeps the spine facing the reader and legible. */
        setMaps((m) => ({ ...(m ?? BLANK_MAPS), cover, spine: sp }));
        invalidate();
      })
      .catch(() => {
        /* A missing texture is not a failure state: the flat accent volume is
           a complete object on its own. */
      });

    (async () => {
      /* The page block, on its three exposed edges.
       *
       * The sheet has the leaves running HORIZONTALLY. On the head and tail
       * that is already correct -- the pages stack across the book's
       * thickness and the edges run along its width. On the fore-edge the
       * two axes swap, so that one instance is turned a quarter turn. Cloned
       * per book because the repeat is set from the book's own proportions,
       * and a shared texture would hand the last book's numbers to all of
       * them. */
      let foreEdge = null;
      let headEdge = null;
      try {
        const raw = await loadTexture(FOREDGE_URL);
        if (!live) return;
        headEdge = await surface(TOPEDGE_URL, 1, 1);

        foreEdge = raw.clone();
        foreEdge.wrapS = foreEdge.wrapT = RepeatWrapping;
        foreEdge.center.set(0.5, 0.5);
        foreEdge.rotation = Math.PI / 2;
        foreEdge.needsUpdate = true;
      } catch {
        /* No sheet, no edges -- the block stays flat paper. */
      }
      /* The binding. Cloth on the back board and as relief on the spine --
         the spine keeps its printed map, so the weave has to arrive as bump
         rather than colour, which is also how a real cloth spine works: the
         foil sits ON the weave, it does not replace it. Board goes on every
         cut edge, where you are looking at the board end-on.

         The headband sheet is the odd one out, and its repeat is not free to
         pick: the second axis is the band's own WIDTH, rolled edge to rolled
         edge, not a direction it tiles in. So it stays at 1 whatever the
         joint does -- a narrower gap simply gets a narrower band, which is
         what a real one does -- and the 3 along the braid is the number that
         fixes how big a strand is on the page. */
      let cloth = null;
      let clothBump = null;
      let board = null;
      let endpaper = null;
      let headband = null;
      try {
        [cloth, clothBump, board, endpaper, headband] = await Promise.all([
          surface(CLOTH_URL, 2.2, 3),
          surface(CLOTH_URL, 7, 1.4),
          surface(BOARD_URL, 9, 1),
          surface(ENDPAPER_URL, 1.6, 2.2),
          surface(HEADBAND_URL, 3, 1),
        ]);
        if (!live) return;
      } catch {
        /* No sheets, no binding -- the parts stay flat colour. */
      }
      if (!live) return;
      setMaps((m) => ({ ...(m ?? BLANK_MAPS), foreEdge, headEdge, cloth, clothBump, board, endpaper, headband }));
      invalidate();
    })();

    return () => {
      live = false;
    };
  }, [slot.book.id, invalidate]);

  useFrame(() => {
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    let settled = true;

    /* Pose and size are read HERE, not at render time.
     *
     * `slot` is a mutable object whose identity is deliberately preserved
     * across rebuilds, so a book keeps its volume -- and therefore its
     * rotation -- when the layout changes. The cost of that is that React
     * never re-renders on a slot mutation, so anything captured in a render
     * closure is frozen at the value it had when the component last rendered.
     * Reading the pose at render time meant a selected book kept being sized
     * by its old row height while its slot had already grown to the stage. */
    const pose = POSE[slot.pose] ? slot.pose : 'stacked';
    const zoom = mobile && pose === 'stacked' ? MOBILE_STACK_ZOOM : 1;
    const driver = (POSE[pose].driver === 'width' ? slot.width : slot.height) * zoom;
    if (!driver) return;

    /* Upgrade the cover, never downgrade it.
     *
     * A stacked slot mounted on the small shelf sheet (see the mount effect
     * above); if its pose ever turns upright while still mounted, the small
     * sheet stays painted until the full one has actually arrived, then
     * swaps once, silently -- never the other way round, since upright ->
     * stacked already has the full sheet cached and correct. Read from
     * `slot.pose` here rather than as an effect dependency for the same
     * reason the pose read above is: it is a mutable property, not React
     * state, and this frame loop is the one place already reading it fresh
     * every frame. Gated on `maps?.cover` specifically, not `maps` broadly:
     * since Phase 2.1 split the cover+spine fetch from the shared-surface
     * fetch, the surface group can resolve first and make `maps` truthy
     * before the mount effect's own cover has arrived -- gating on the
     * object instead of the field this depends on could fire this fetch
     * before there is a small sheet to upgrade FROM, and race the two
     * fetches' `setMaps` calls against each other for who lands last. Calls
     * the shared `upgradeCover` (declared above, alongside the DRAG_BOOK
     * trigger) rather than fetching inline, so "once, from whichever trigger
     * reaches it first" holds for this trigger too. */
    if (!upgraded.current && pose === 'upright' && maps?.cover) upgradeCover();

    /* Fade out while another book is being read, and back in afterwards -- but
       not symmetrically. Out is immediate; in takes its time.
     *
     * Computed BEFORE the position below, because the travel is derived from it
     * and a frame late would show every book a step behind its own opacity. */
    const wantDim = slot.dim || slot.dimByDrag ? 0 : 1;
    if (Math.abs(dim.current - wantDim) > 0.004) {
      dim.current = reduced
        ? wantDim
        : MathUtils.lerp(dim.current, wantDim, wantDim === 0 ? DIM_EASE : RETURN_EASE);
      settled = false;
    } else {
      dim.current = wantDim;
    }

    /* The return travel: how far this book still is from where it belongs.
     *
     * Tied to the fade rather than timed against the clock, which is what makes
     * the pile rigid. Every book on the same side of the gap is given the same
     * `returnFrom` by BookCanvas and eases on the same curve from the same
     * frame, so the block holds its shape all the way in -- no book can arrive
     * before another, because there is no per-book timing left to disagree
     * about. It also means arrival and appearance are one event.
     *
     * Zero on the way out. Clearing is the stack getting out of the way of a
     * gesture, and it does that where it stands. */
    const slide = wantDim === 1 ? (1 - dim.current) * (slot.returnFrom ?? 0) : 0;

    /* Position is SET, never eased -- the DOM is the authority and the CSS
       transition on the slot is what animates it.
     *
     * The travel is added HERE rather than moved in the DOM on purpose: the
     * slot elements are in flow, so displacing them would move the page under
     * the reader, and the scroll position is the one thing this scene reads and
     * must never write. The book is drawn away from its slot for the length of
     * the return and handed back to it. */
    g.position.x = slot.x;
    g.position.y = slot.y + slide;

    /* Size DOES ease, because a pose change swaps which DOM dimension drives
       it and that would otherwise pop. */
    if (size.current === 0) size.current = driver;
    else if (Math.abs(size.current - driver) > 0.4) {
      size.current = MathUtils.lerp(size.current, driver, reduced ? 1 : SIZE_EASE);
      settled = false;
    } else size.current = driver;

    /* The assembly is modelled at unit height, so resizing a book is one
       uniform scale on the group that holds its parts. */
    b.scale.setScalar(size.current);
    g.visible = dim.current > 0.01;
    /* Every part fades together. Traversing costs a handful of nodes and
       avoids threading a material list through the assembly. */
    b.traverse((node) => {
      const mats = node.material;
      if (!mats) return;
      for (const mat of Array.isArray(mats) ? mats : [mats]) {
        mat.opacity = dim.current;
        mat.transparent = dim.current < 0.999;
      }
    });

    if (!reduced) {
      if (Math.abs(spin.current) > 0.0001) {
        dragY.current += spin.current;
        spin.current *= SPIN_DECAY;
        settled = false;
      }
      /* A released drag springs back to the pose the page owns -- unless the
         book is free, where it stays where the reader left it. */
      if (!slot.dragging && !slot.free) {
        dragX.current = MathUtils.lerp(dragX.current, 0, EASE * 0.5);
        dragY.current = MathUtils.lerp(dragY.current, 0, EASE * 0.5);
        if (Math.abs(dragX.current) + Math.abs(dragY.current) > 0.001) settled = false;
      }
    }

    const hover = slot.hovered && pose === 'stacked' ? -0.035 : 0;
    /* Same shape for both poses -- a book eases toward its pose's own transit
       magnitude as it nears the reading zone (slot.progress -> 1) -- just a
       far smaller magnitude for upright (see POSE.upright.transit) so a
       reader row settles rather than wobbling while someone reads it. */
    const transitMag = pose === 'stacked' ? POSE.stacked.transit : POSE.upright.transit;
    const transit = (1 - slot.progress) * transitMag;
    poseQuaternion(pose, { mobile, transit: transit + hover }, target);
    target.premultiply(scratch.setFromAxisAngle(AXIS_Y, dragY.current));
    target.premultiply(scratch.setFromAxisAngle(AXIS_X, dragX.current));

    if (reduced) {
      g.quaternion.copy(target);
    } else {
      g.quaternion.slerp(target, EASE);
      if (g.quaternion.angleTo(target) > 0.0008) settled = false;
    }

    /* On demand-driven rendering an unfinished ease gets no further frames
       unless it asks for them. Keep asking until it has actually arrived. */
    if (!settled) invalidate();
  });

  /* The canvas hands drag deltas straight to the object rather than through
     React state: a pointermove must not re-render every book on the page. */
  useEffect(() => {
    slot.applyDrag = (dx, dy) => {
      dragY.current += dx * 0.006;
      dragX.current = MathUtils.clamp(dragX.current + dy * 0.004, -0.9, 0.9);
      spin.current = dx * 0.0009;
      invalidate();
    };
    return () => {
      slot.applyDrag = null;
    };
  }, [slot, invalidate]);

  /* Board faces in BoxGeometry order [+X, -X, +Y, -Y, +Z, -Z]. Only the outward
     face carries artwork; the other five are the board seen end-on -- except
     face 5, the pastedown, which is endpaper rather than raw greyboard. Three
     materials, three answers: the cover gets a clearcoat, the endpaper stays
     flat paper, the cut edges stay the dullest thing on the book. */
  const boardFaces = (outward, map) =>
    [0, 1, 2, 3, 4, 5].map((i) => {
      const isOutward = i === outward;
      const shared = {
        attach: `material-${i}`,
        color: isOutward ? (map ? '#ffffff' : c.cover) : c.edge,
        map: isOutward ? map : i === 5 ? maps?.endpaper ?? null : maps?.board ?? null,
        metalness: 0,
        toneMapped: false,
      };
      const key = `${i}:${map ? 'tex' : 'flat'}`;
      return isOutward ? (
        <meshPhysicalMaterial key={key} {...shared} {...FRONT_BOARD} />
      ) : (
        <meshStandardMaterial key={key} {...shared} {...(i === 5 ? ENDPAPER : EDGE)} />
      );
    });

  return (
    <group ref={group} position={[slot.x, slot.y, 0]}>
      {/* Modelled at unit height; the group is scaled to the book's size. */}
      <group ref={body}>
        {/* Front board -- the publisher's cover, standing proud of the text
            block on three edges. */}
        <mesh position={[parts.board.x, 0, parts.board.z]}>
          <boxGeometry args={parts.board.size} />
          {boardFaces(4, maps?.cover ?? null)}
        </mesh>

        {/* Back board */}
        <mesh position={[parts.board.x, 0, -parts.board.z]}>
          <boxGeometry args={parts.board.size} />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const outward = i === 5;
            const map = outward ? maps?.cloth ?? null : null;
            const shared = {
              attach: `material-${i}`,
              /* The sheets are neutral grey, so the book's own colour comes
                 from here and the weave only modulates it. */
              color: outward ? c.back : i === 4 ? c.pages : c.edge,
              map: outward ? map : i === 4 ? maps?.endpaper ?? null : maps?.board ?? null,
              metalness: 0,
              toneMapped: false,
            };
            const key = `${i}:${map ? 'tex' : 'flat'}`;
            return outward ? (
              <meshStandardMaterial key={key} {...shared} bumpMap={maps?.clothBump ?? null} {...BACK_BOARD} />
            ) : (
              <meshStandardMaterial key={key} {...shared} {...(i === 4 ? ENDPAPER : EDGE)} />
            );
          })}
        </mesh>

        {/* The text block: inset by the square at head, tail and fore-edge, so
            the boards overhang it exactly as a bound book's do. */}
        <mesh position={[parts.pages.x, 0, 0]}>
          <boxGeometry args={parts.pages.size} />
          {/* Only three faces of the block are ever seen: the fore-edge and the
              head and tail. The spine side is bound and the two flat sides are
              under the boards, so they stay plain -- a texture there would be
              memory spent on something no reader can look at. */}
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const map =
              i === 0 ? maps?.foreEdge ?? null : i === 2 || i === 3 ? maps?.headEdge ?? null : null;
            return (
              <meshStandardMaterial
                key={`${i}:${map ? 'tex' : 'flat'}`}
                attach={`material-${i}`}
                color={map ? '#FBF6EC' : c.pages}
                map={map}
                metalness={0}
                toneMapped={false}
                {...PAGES}
              />
            );
          })}
        </mesh>

        {/* The spine: a flat panel with a turned joint at each side, lapping
            onto the boards. The back of the shell faces the text block and is
            never seen, so it is left open. */}
        <mesh position={[parts.spine.x, 0, 0]} geometry={geo.spine}>
          <meshStandardMaterial
            /* KEYED, like every other material here. R3F does not set
               needsUpdate when a prop changes, so handing a map to a material
               that has already compiled leaves the old shader in place -- the
               map is ignored and the white base colour is all that renders.
               That is what the blank spines were. Remounting recompiles.
               Keyed on `maps?.spine` specifically, not `maps` broadly: since
               Phase 2.1 split the cover+spine fetch from the shared-surface
               fetch, the surface group can resolve first and make `maps`
               truthy before `maps.spine` itself has arrived -- keying on the
               object instead of the field would then compile the 'tex'
               variant with no map and get stuck there, the exact bug this
               comment is describing, just from a new direction. */
            key={maps?.spine ? 'tex' : 'flat'}
            color={maps?.spine ? '#ffffff' : c.spine}
            map={maps?.spine ?? null}
            bumpMap={maps?.clothBump ?? null}
            metalness={0}
            side={FrontSide}
            toneMapped={false}
            {...SPINE}
          />
        </mesh>

        {/* The hollow of the binding: the SAME shell, seen from inside.
         *
         * It shows through the ring left between the headband and the covering,
         * and only there -- which is why it is worth so little geometry and so
         * much care. Drawn DoubleSide it was the printed title sheet's own back
         * face, lit and pale, and on a light spine that ring read as exactly the
         * tube the bracket profile exists to avoid. So the inside is unprinted
         * and near-black, the way the inside of a case is.
         *
         * One geometry, two meshes, opposite sides: a front face and a back face
         * of the same triangle are never both drawn, so this cannot z-fight the
         * covering the way a second surface tucked inside it would. */}
        <mesh position={[parts.spine.x, 0, 0]} geometry={geo.spine}>
          <meshStandardMaterial
            color={c.hinge}
            metalness={0}
            side={BackSide}
            toneMapped={false}
            {...HOLLOW}
          />
        </mesh>

        {/* The spine board, under the covering.
         *
         * Surfaced exactly as the boards' cut edges are -- same sheet, same
         * colour, same roughness -- because the whole job of this part is that
         * the three edges read as one band across the head. Any difference here
         * would be read as a seam, which is the thing it exists to close. */}
        <mesh position={[parts.inlay.x, 0, 0]} geometry={geo.inlay}>
          <meshStandardMaterial
            key={maps?.board ? 'tex' : 'flat'}
            color={c.edge}
            map={maps?.board ?? null}
            metalness={0}
            toneMapped={false}
            {...EDGE}
          />
        </mesh>

        {/* The headband, at head and tail: the spine's own profile, solid and
            slightly inset, so it closes the covering rather than bridging it. */}
        {maps?.headband
          ? [1, -1].map((end) => (
              <mesh
                key={end}
                position={[parts.headband.x, end * parts.headband.y, 0]}
                geometry={geo.headband}
              >
                <meshPhysicalMaterial
                  map={maps.headband}
                  color="#EDE4D4"
                  metalness={0}
                  toneMapped={false}
                  {...HEADBAND}
                />
              </mesh>
            ))
          : null}
      </group>
    </group>
  );
}
