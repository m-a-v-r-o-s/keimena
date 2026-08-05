import { BufferGeometry, BufferAttribute } from 'three';

/**
 * The spine, as a bracket rather than a half-moon.
 *
 * A half-cylinder is the obvious way to round a spine and it is the wrong
 * shape. Its radius is half the book's thickness, so the entire spine is one
 * continuous curve -- seen end-on from the head that reads as a tube lying
 * against the pages, which is exactly what it is. A case-bound spine is a FLAT
 * panel that turns through a tight radius at each joint and then laps onto the
 * boards, and that flat panel is what carries the title.
 *
 *      half-cylinder            bracket
 *          _                    ____
 *        /   \                 /
 *       (     )               |
 *        \ _ /                 \____
 *
 * So the profile is drawn by hand -- a run over the back board, a quarter turn
 * at the joint, the flat panel, the second turn, the run onto the front board
 * -- and extruded along the book's height as ONE mesh. Every seam between two
 * parts here is a seam that flickers, which is why this is not three pieces.
 *
 * Both joints are kept OUTBOARD of the boards' bound edge (the profile clamps
 * `radius` to `depth`, which puts the joint centre at x <= 0). If a turn curled
 * back over a board the shell would cut through it, and an open shell
 * intersecting a solid is the shimmer this shape was drawn to get rid of.
 *
 * Local frame: the origin sits on the boards' bound edge, +X into the book,
 * +Z toward the front cover, Y along the height.
 *
 * UVs match CylinderGeometry's convention on purpose -- u runs 0..1 back to
 * front, v is 0 at the tail and 1 at the head -- so the spine sheets, which are
 * authored landscape and turned a quarter turn at load, map exactly as they did
 * on the cylinder and did not have to be regenerated.
 */

/**
 * The bracket outline itself, from explicit numbers.
 *
 * Split out from `profile` because the spine board below needs outlines this
 * shape that no `wrap` and no clamp could produce: its inner face is the OUTER
 * one eroded by a board's thickness, and eroding a bracket whose relief is
 * thinner than the board being eroded gives a panel at POSITIVE x -- a valid
 * outline, and one `profile`'s clamps would refuse to build.
 *
 * `radius` is used as given. At 0 the two arc sweeps collapse onto the corner
 * they turn around, which is exactly the sharp inner crease a tight bend makes
 * in a thick material, and costs a run of degenerate triangles to say so.
 */
function ring({ halfT, radius, depth, xEnd, segments }) {
  const r = Math.max(radius, 0);
  const cx = r - depth;
  const cz = halfT - r;

  const pts = [];
  /* [x, z, nx, nz] -- the outward normal is the angle itself, which is the one
     good reason to sweep these by angle rather than by point. */
  const turn = (a, side) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([cx + r * c, side * cz + r * s, c, s]);
  };

  pts.push([xEnd, -halfT, 0, -1]);
  for (let i = 0; i <= segments; i++) turn(-Math.PI / 2 - (i / segments) * (Math.PI / 2), -1);
  for (let i = 0; i <= segments; i++) turn(Math.PI - (i / segments) * (Math.PI / 2), 1);
  pts.push([xEnd, halfT, 0, 1]);

  /* The two arcs end and begin on the flat panel at (-depth, -+cz), so the
     straight run between them needs no point of its own. */
  return pts;
}

function profile({ halfT, radius, depth, wrap, segments }) {
  /* Clamped, not asserted: `depth` is the bound that keeps the turns clear of
     the boards, and `halfT` the one that keeps the flat panel from inverting. */
  const r = Math.min(radius, depth, halfT);
  /* cx = r - depth, the joint centre, is always <= 0; xEnd is where the
     covering stops on the board. */
  return ring({ halfT, radius: r, depth, xEnd: r - depth + wrap, segments });
}

/**
 * @param spec      { halfT, radius, depth, wrap, height } in book-height units
 * @param scale     shrinks the profile toward the spine's axis, for the plug
 * @param capped    close head and tail -- a solid, rather than a shell
 */
export function spineGeometry(spec, { scale = 1, capped = false, segments = 7 } = {}) {
  const pts = profile({ ...spec, segments }).map(([x, z, nx, nz]) => [x * scale, z * scale, nx, nz]);
  const n = pts.length;
  const half = spec.height / 2;

  /* u by arc length, so the title is not stretched across the turns. */
  const arc = [0];
  for (let i = 1; i < n; i++)
    arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = arc[n - 1] || 1;

  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];

  for (let i = 0; i < n; i++) {
    const [x, z, nx, nz] = pts[i];
    for (let top = 0; top < 2; top++) {
      pos.push(x, top ? half : -half, z);
      nor.push(nx, 0, nz);
      uv.push(arc[i] / total, top);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }

  if (capped) {
    /* The profile plus the chord closing it at xEnd is convex, so a fan from
       any interior point triangulates it -- no ear clipping needed. */
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const hubX = (minX + maxX) / 2;

    for (const top of [true, false]) {
      const y = top ? half : -half;
      const hub = pos.length / 3;
      pos.push(hubX, y, 0);
      nor.push(0, top ? 1 : -1, 0);
      uv.push((0 - minZ) / (maxZ - minZ), (hubX - minX) / (maxX - minX));

      const first = pos.length / 3;
      for (const [x, z] of pts) {
        pos.push(x, y, z);
        nor.push(0, top ? 1 : -1, 0);
        uv.push((z - minZ) / (maxZ - minZ), (x - minX) / (maxX - minX));
      }
      /* Wrapping past the last point closes the chord. Winding flips with the
         face: (hub, i, i+1) faces +Y, the reverse faces -Y. */
      for (let i = 0; i < n; i++) {
        const a = first + i;
        const b = first + ((i + 1) % n);
        if (top) idx.push(hub, a, b);
        else idx.push(hub, b, a);
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The spine board, as a bent slab.
 *
 * A case is three boards under one covering, and the third one is the reason a
 * spine has an edge at all. Without it the covering is a membrane: the front
 * and back show a board's thickness where they are cut at the head, the spine
 * shows a hairline, and the case reads as two boards with a skin stretched
 * between them rather than as one continuous thing.
 *
 * So this is a ribbon following the bracket, and it is built the way the real
 * one is: INSET from the covering by the same PROUD the boards are, and given
 * its thickness INWARD, so it lands in the boards' own plane at the lap and the
 * three cut edges line up as one band across the head.
 *
 *      covering  ~~~~~~~~~~~~~~~~~~~~~~   membrane, stands PROUD
 *      inlay     [######]        [#####]  BOARD, in the boards' plane
 *      board             [######]         BOARD
 *
 * Two things keep it from flickering against the boards it butts into, and both
 * are geometric rather than lucky:
 *
 *   It runs PAST the boards' bound edge by `overlap` and simply buries itself
 *   there. A ribbon stopped exactly at the edge shares that plane with the
 *   board's own; a ribbon stopped short leaves a gap the head can see through.
 *   Buried, it does neither -- opaque solids may interpenetrate all they like.
 *
 *   Its cut edges are pulled back from the boards' by a hair (`height` is short
 *   of the book's), so the one pair of faces that WOULD have shared the head
 *   plane no longer does. Where the ribbon runs under a board, the board's own
 *   edge is nearer the eye and hides it; where it does not, the ribbon's edge is
 *   what shows. The join draws itself.
 *
 * @param spec      the covering's own { halfT, radius, depth } -- the inlay is
 *                  always derived from it, never specified beside it
 * @param inset     how far inside the covering the slab's outer face sits
 * @param thickness the board's thickness
 * @param overlap   how far past the boards' bound edge it buries itself
 */
export function inlayGeometry(spec, { inset, thickness, height, overlap, segments = 7 }) {
  const eroded = (d) =>
    ring({
      halfT: spec.halfT - d,
      radius: Math.max(spec.radius - d, 0),
      /* May go NEGATIVE, and must be allowed to: a relief thinner than the
         board eroding it puts the inner panel past the boards' bound edge,
         which is a real place for it to be and the reason the text block is
         pulled back to meet it. */
      depth: spec.depth - d,
      xEnd: overlap,
      segments,
    });

  const outer = eroded(inset);
  const inner = eroded(inset + thickness);
  const n = outer.length;
  const half = height / 2;

  /* u by arc length along the outer face, so the board's grain runs the length
     of the edge rather than bunching at the turns. */
  const arc = [0];
  for (let i = 1; i < n; i++)
    arc.push(arc[i - 1] + Math.hypot(outer[i][0] - outer[i - 1][0], outer[i][1] - outer[i - 1][1]));
  const total = arc[n - 1] || 1;

  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];

  /* Both walls, same sweep, opposite facings. */
  for (const [pts, out] of [
    [outer, 1],
    [inner, -1],
  ]) {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [x, z, nx, nz] = pts[i];
      for (let top = 0; top < 2; top++) {
        pos.push(x, top ? half : -half, z);
        nor.push(nx * out, 0, nz * out);
        uv.push(arc[i] / total, top);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      if (out === 1) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /* The cut edges at head and tail -- the whole point of the part. A strip
     between the two walls rather than a fan: it is a band, not a disc, and v
     runs across the thickness so the board sheet is not stretched along it. */
  for (const top of [true, false]) {
    const base = pos.length / 3;
    const y = top ? half : -half;
    const ny = top ? 1 : -1;
    for (let i = 0; i < n; i++) {
      for (const pts of [outer, inner]) {
        pos.push(pts[i][0], y, pts[i][1]);
        nor.push(0, ny, 0);
        uv.push(arc[i] / total, pts === outer ? 0 : 1);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      if (top) idx.push(a + 1, a, a + 2, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }

  /* The two ends, buried in the boards. Never seen, and closed anyway: an open
     solid is a solid that lies to every later reader of this file. */
  for (const [i, flip] of [
    [0, false],
    [n - 1, true],
  ]) {
    const base = pos.length / 3;
    for (const pts of [outer, inner])
      for (let top = 0; top < 2; top++) {
        pos.push(overlap, top ? half : -half, pts[i][1]);
        nor.push(1, 0, 0);
        uv.push(top, pts === outer ? 0 : 1);
      }
    /* base+0,1 = outer bottom/top; base+2,3 = inner bottom/top. */
    if (flip) idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    else idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
