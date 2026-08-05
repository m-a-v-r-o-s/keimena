import { Color, SRGBColorSpace, Euler, Quaternion, Vector3 } from 'three';

/**
 * The book as a physical object: proportions, poses, and the colour of each of
 * its six faces. Pure module -- no React, no scene graph.
 *
 * The scene runs at 1 world unit = 1 CSS pixel (see BookCanvas), so every
 * dimension here is in pixels and can be reasoned about against the DOM.
 *
 * ONE canonical geometry, always. The book is built standing up, and every
 * pose is a rotation of it -- which is what lets a book rotate smoothly from
 * lying in the stack to standing on its own page. An earlier version built a
 * different box per pose; that could only ever swap one shape for another, and
 * a swap is exactly what a seamless transition is not.
 *
 *   X = width (fore-edge to spine)
 *   Y = height (head to tail)
 *   Z = thickness (cover to back)
 */
export const WIDTH_RATIO = 140 / 210;
export const THICKNESS_RATIO = 24 / 210;

/**
 * A hardback is not a solid block, and the details that say so are small.
 *
 * All in units of the book's HEIGHT, so they scale with it:
 *
 *   SQUARE   the overhang -- cover boards are cut larger than the text block
 *            and stand proud of it at head, tail and fore-edge. This is the
 *            single detail that most separates a bound book from a box.
 *   BOARD    board thickness. Real boards are ~2.5mm on a 210mm book.
 *   HINGE    the groove between spine and board that the cover creases along
 *            when it opens. Visible as a channel down both faces.
 *   PROUD    how far the spine's covering stands off the boards where it laps
 *            over them. Tiny -- it exists so the two never share a plane.
 *
 * JOINT is in units of the book's THICKNESS rather than its height, because it
 * is a fact about the spine's cross-section: the radius of the turn between the
 * flat panel and the boards. It is also what sets how far the covering stands
 * off them -- `depth` is the joint plus a fixed margin -- and therefore how much
 * of the book's END face the spine occupies, which is the view a stack gives
 * when a book is swung round. Kept small on purpose: a generous turn eats the
 * end face, so the head reads as binding rather than as paper, and the panel
 * between the turns stops being flat enough to carry a title.
 */
export const SQUARE = 0.015;
export const BOARD = 0.008;
export const HINGE = 0.030;
export const PROUD = BOARD * 0.16;
export const JOINT = 0.02;

/* Books differ in thickness, and a stack of identical slabs reads as a graphic
 * pattern rather than as a shelf. Varied deterministically off the id so a book
 * is the same thickness on every render and in every screenshot. */
function hashUnit(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export function dimensions(book, height) {
  const spread = 0.62 + hashUnit(book.id) * 0.76; // 0.62x - 1.38x
  return {
    height,
    width: height * WIDTH_RATIO,
    thickness: height * THICKNESS_RATIO * spread,
  };
}

/**
 * The book as an assembly of parts, at unit height.
 *
 * Built once per thickness and scaled, rather than rebuilt per frame: the only
 * thing that changes as a book resizes is the scale of the group holding it.
 *
 * Layout along X: the spine sits at -X, the fore-edge at +X. The boards start
 * one hinge-width in from the spine, which is what leaves the groove.
 */
export function assembly(book) {
  const spread = 0.62 + hashUnit(book.id) * 0.76;
  const h = 1;
  const w = WIDTH_RATIO;
  const t = THICKNESS_RATIO * spread;

  /* THREE PARTS, AND NOTHING BETWEEN THEM.
   *
   * The groove beside the spine is not an object. Earlier versions put one
   * there -- first a box, then a cylinder -- and both flickered against their
   * neighbours, because a part wedged into a gap shares a plane with whatever
   * it is wedged against. The second read as a tube lying along the book.
   *
   * What is actually there on a bound book is a DIP: the spine sits slightly
   * below the boards, and the text block shows through the gap between them.
   * So the parts are separated along X by real empty space, and the recessed
   * block behind is what the reader sees in the channel. No part touches
   * another, so there is no seam left to fight over.
   *
   *   |  spine  |  gap  |        boards        |
   *   +---------+       +----------------------+
   *   |            text block (recessed)       |
   */
  /* The spine is a BRACKET, not a half-moon.
   *
   * Rounding it as a half-cylinder makes its radius half the book's thickness,
   * so the whole spine is a single curve and reads end-on as a tube. A real
   * spine is a flat panel with a tight turn at each joint -- see
   * spine-geometry.js, which draws the profile.
   *
   * `depth` is deliberately larger than `joint`: that is what keeps both turns
   * outboard of the boards' bound edge, so the shell laps ONTO the boards
   * rather than cutting through them.
   *
   * The margin between them is FIXED rather than proportional, and that is what
   * makes the joint safe to tune. The covering stops at joint - depth + wrap,
   * which cancels to wrap - BOARD * 0.4: the lap onto the boards -- the band of
   * cloth you see beside the artwork on a cover -- is the same width whatever
   * the turn does. So tightening the joint takes its area off the END face
   * only, and leaves the front of the book alone. */
  const dip = BOARD * 0.55;
  const joint = t * JOINT;
  const depth = joint + BOARD * 0.4;

  /* How far the spine board reaches past the boards' bound edge.
   *
   * It is inset from the covering by PROUD and then given a full BOARD inward,
   * and the relief it has to fit in is only `depth` -- which, at a joint this
   * tight, is thinner than a board on every book on the shelf. So its inner
   * face lands INSIDE the text block's old footprint, and the block is what
   * gives way: pulled back off the bound edge by the difference, plus a hair so
   * the two never meet.
   *
   * The alternative was a spine edge thinner than the covers beside it, which
   * is the one thing a continuous cut edge across the head cannot survive. The
   * block loses about half a percent of its width to this, and no reader will
   * ever find it. */
  /* Inset a HAIR DEEPER than PROUD, and the half is load-bearing. At exactly
   * PROUD the spine board's outer face lands in the boards' own outer plane --
   * and it buries itself in them, so that is a shared plane between two
   * overlapping solids, which is the definition of the flicker this file keeps
   * legislating against. It happens to sit under the covering, so it would
   * never be seen -- until a fade makes every material transparent for half a
   * second. Half a PROUD deeper, nothing shares a plane with anything, and the
   * step it costs at the cut edge is 0.0006h: sub-pixel at any real size. */
  const inset = PROUD * 1.5;
  const reach = inset + BOARD - depth;
  const pull = reach > 0 ? reach + PROUD : 0;

  return {
    w,
    h,
    t,
    /* Cover boards. Thin, full width, standing proud of the text block on the
       three free edges. */
    board: {
      size: [w, h, BOARD],
      x: 0,
      z: t / 2 - BOARD / 2,
    },
    /* The text block, recessed below the boards and reaching back across the
       joint so nothing shows through the gap -- less `pull`, the room the spine
       board needs where it turns in behind the bound edge. */
    pages: {
      size: [w - SQUARE - pull, h - SQUARE * 2, t - dip * 2],
      x: -w / 2 + pull + (w - SQUARE - pull) / 2,
    },
    /* The spine panel and its two joints. `halfT` stands a hair proud of the
       boards so the lap has somewhere to sit: two surfaces sharing a plane is
       what z-fighting IS, and the whole point of the lap is that they overlap. */
    spine: {
      halfT: t / 2 + PROUD,
      radius: joint,
      depth,
      wrap: SQUARE,
      height: h,
      x: -w / 2,
    },
    /* The spine board, under the covering. The third board of the case: it is
       what gives the spine a cut edge at head and tail instead of a hairline,
       so cover, spine and back read as one bent board rather than two boards
       with a skin between them. Shorter than the book by a hair at each end,
       which is what keeps its cut edge out of the boards' own plane -- see
       spine-geometry.js, where the rest of the reasoning lives. */
    inlay: {
      inset,
      thickness: BOARD,
      height: h - PROUD * 2,
      overlap: BOARD,
      x: -w / 2,
    },
    /* The woven band at head and tail.
     *
     * It PLUGS the spine, it does not sit on it. Seen from the head -- which is
     * the angle a stack shows -- an open spine is a pale tube with its inside
     * facing the reader. On a real book that opening is closed by the band. So
     * this is solid rather than a shell, and takes the spine's own profile at
     * 94% so it tucks inside the covering instead of splitting it.
     *
     * It STANDS ON THE BLOCK. Placed by its centre near the boards' own head
     * plane, it hung in the square with a ninth of an inch of daylight beneath
     * it -- at any zoom that reads as a band floating over the paper, which is
     * the one thing a headband never does: it is glued to the block, and the
     * block is what holds it up.
     *
     * So the foot is put a hair BELOW the block's head face rather than exactly
     * on it. Exactly on it is the coplanar case the spine comment above is
     * about; buried, the two solids simply intersect, and no gap can open at
     * any thickness. The top then stops half a square short of the boards, so
     * the covers still overhang the band as they overhang everything else they
     * enclose. */
    headband: {
      scale: 0.94,
      height: SQUARE * 0.56,
      x: -w / 2,
      /* Centre, so: foot at h/2 - SQUARE * 1.06 (a hair into the block, whose
         head face is at h/2 - SQUARE) and top at h/2 - SQUARE * 0.5. */
      y: h / 2 - SQUARE * 0.78,
    },
  };
}

/** BoxGeometry material order is [+X, -X, +Y, -Y, +Z, -Z]. */
export const FACES = ['pages', 'spine', 'pages', 'pages', 'cover', 'back'];

export const AXIS_X = new Vector3(1, 0, 0);
export const AXIS_Y = new Vector3(0, 1, 0);

/**
 * Which DOM dimension sizes the book.
 *
 * Lying flat, the head-to-foot dimension runs ACROSS the screen, so the slot's
 * width is what sizes it. Standing up, its height does.
 */
export const POSE = {
  stacked: {
    driver: 'width',
    /* How far a lying book tips toward the eye, in radians.
     *
     * At 0 the book is flat on: you see its spine square, and the cover -- face
     * up, edge on -- not at all. Every radian from there trades spine for
     * cover. That trade is the whole look of the stack, because the spine is
     * where the author, the title and the imprint are set, and the cover is a
     * photograph competing with them.
     *
     * Held low on purpose: at 0.30 the covers read as the subject and the
     * lettering as a caption under them, which is a bookshop table, not a
     * catalogue. Here the spine is what a reader meets and the cover is the
     * sliver of colour above it that says a book is a thing with a top.
     *
     * Measured rather than eyeballed, because the number is meaningless on its
     * own -- what matters is the height of the cover band against the spine
     * band, and that also depends on how thick the book is. Taken across all
     * seventeen with the real pose quaternion, the ratio runs at about 6.2x the
     * rake, so: 0.30 gave a mean of 1.90 (cover twice the spine, which is what
     * the old stack looked like) and this gives 0.31. */
    rake: 0.05,
    /* Mobile keeps proportionally more, as it always has -- the stack is
       narrower there and a spine alone at that width is a very thin band. Held
       at the same ~2x of desktop the old pair used. */
    rakeMobile: 0.11,
    /* How much steeper the rake sits away from the reading zone: a slab tips
       further open as it enters and settles as it arrives, so the stack
       breathes down the page instead of being 26 identical parallelograms.
       Scaled with the rake it modulates -- at the old 0.16 it would now be
       three times the angle itself, which would have made the breathing the
       dominant motion rather than an inflection of it. Kept at the same
       just-over-half of the rake that the old pair held. */
    transit: 0.03,
  },
  upright: {
    driver: 'height',
    yaw: 0.34,
    yawMobile: 0.24,
    pitch: -0.05,
    /* A small settle, not a wobble: reused from the same scroll-driven
       `progress` the stack's own `transit` reads (see BookVolume.jsx), so a
       reader row nods slightly as it arrives at and leaves the viewport's
       middle instead of holding a perfectly dead, unchanging rotation the
       entire time it's onscreen -- which, beside a shelf whose books
       visibly breathe, would read as broken rather than restrained. Held
       well under the stack's 0.03: this is a book someone is trying to
       read, not a pile catching the light. */
    transit: 0.012,
  },
};

const _flat = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
const _turn = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
const _rake = new Quaternion();

/**
 * The rotation that puts a book into a pose.
 *
 * STACKED is composed rather than written as one Euler, because the order is
 * the whole point and an Euler hides it: lay the book down so the cover faces
 * up (-90 about X), turn it so the spine faces the viewer (+90 about Y), then
 * rake the whole thing toward the eye. Raking further shows more cover and less
 * spine, which is the one number mobile changes.
 */
export function poseQuaternion(poseName, { mobile = false, transit = 0 } = {}, out = new Quaternion()) {
  if (poseName === 'upright') {
    const p = POSE.upright;
    return out.setFromEuler(new Euler(p.pitch + transit, mobile ? p.yawMobile : p.yaw, 0));
  }
  const p = POSE.stacked;
  const rake = (mobile ? p.rakeMobile : p.rake) + transit;
  out.copy(_flat).premultiply(_turn);
  _rake.setFromAxisAngle(AXIS_X, rake);
  return out.premultiply(_rake);
}

/* Warm paper for the page block. Never grey -- a neutral page block against the
 * warm ink ground reads as plastic. Matches --color-text's hue family. */
const PAGES = '#E4DACA';

/**
 * Per-face colour: the ALBEDO each face's material is given, before the room
 * lights and shades it. There is a real rig now (env.js's window, the
 * positional key, the fill -- see LIGHT_PLAN.md and DECISIONS.md) and real
 * PBR materials (components/three/materials.js), so the specular highlight
 * that travels across a cover as it turns is simulated, not authored.
 *
 * The base colour underneath it is still authored, and deliberately so: a
 * light rig scales what it's given, it doesn't invent it, so these
 * multipliers are what keep every surface predictable against the contrast
 * gate rather than at the mercy of wherever a book happens to sit relative
 * to the key. Applied in linear space, which is what a light would do anyway.
 *
 * The COVER carries the authored accent exactly (SHADE.cover = 1). It is the
 * face tools/render-check.mjs measures against its ground once lit, so its
 * albedo must not be shaded away from the value that was verified -- the
 * light rig is tuned around that constraint, not the other way round.
 */
const SHADE = { cover: 1, spine: 0.86, back: 0.46, pages: 1 };

export function faceColor(face, accent) {
  const c = new Color().setStyle(face === 'pages' ? PAGES : accent, SRGBColorSpace);
  const k = SHADE[face];
  if (face === 'pages') c.multiplyScalar(0.94);
  else if (k !== 1) c.multiplyScalar(k);
  return c;
}
