import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  RGBAFormat,
  LinearFilter,
} from 'three';

/**
 * The room the books are lit in, built in code rather than loaded.
 *
 * An HDR file would be the usual answer and is banned here (DESIGN.md section
 * 6: no HDR environment bling), and it would also be a megabyte of download
 * for an effect measured in millimetres.
 *
 * The first version of this room was a pure vertical gradient -- warm ceiling,
 * ink floor, no azimuthal variation at all. That meant `envMap` could only
 * ever answer "how far up does this normal point", so turning a book changed
 * nothing about its highlight and every surface was distinguished only by how
 * dark it was. This version cuts a warm rectangular softbox into the
 * equirect at the azimuth that reads as centre-right of the viewport, and a
 * dim cool wash opposite it, so the room itself now has a direction a
 * specular highlight can travel across. See LIGHT_PLAN.md section 3.
 */

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/* A soft-edged 1D window: 1 inside the half-width, eased to 0 across the
 * shoulder past it. `wrap` treats the axis as circular -- the u (azimuth)
 * axis needs that, the v (elevation) axis does not.
 */
function window1D(x, centre, halfWidth, shoulder, wrap) {
  let d = Math.abs(x - centre);
  if (wrap) d = Math.min(d, 1 - d);
  if (d <= halfWidth) return 1;
  if (d >= halfWidth + shoulder) return 0;
  return 1 - smooth((d - halfWidth) / shoulder);
}

/* u = atan2(dir.z, dir.x) / 2pi + 0.5, so screen-right is u=0.50 and centre
 * right / front-right-45deg -- where this key belongs -- is u=0.625. Tuned a
 * touch past that, toward the viewer, per LIGHT_PLAN.md section 3.
 *
 * Back at D16/D17's original brightness (D22) -- D20 had halved this on top
 * of a separate scene.environmentIntensity=0.5 (BookCanvas.jsx), which
 * compounded to a quarter and needed two numbers multiplied together to
 * know the real answer, which is exactly the confusion D20's own writeup
 * flagged as a problem. Collapsed to one lever: this file stays at the
 * original authored colour, and environmentIntensity alone now carries
 * "how much of the room reaches the eye" -- see that constant for the
 * current value. */
const KEY = { u: 0.63, v: 0.34, hu: 0.05, su: 0.04, hv: 0.08, sv: 0.06, color: [6.0, 4.9, 3.6] };
/* Opposite-ish, near screen-left (u=0/1), dim and blue-shifted: separates a
 * board's left edge from the ground without competing with the key.
 * Restored alongside KEY (D22) -- same one-lever reasoning above. */
const RIM = { u: 0.15, hu: 0.1, su: 0.12, color: [0.3, 0.32, 0.36] };

export function buildEnvironment() {
  /* 32 columns cannot resolve a window edge; 128 can, and it is still 32KB of
     float that never touches the network. */
  const w = 128;
  const h = 64;
  const data = new Float32Array(w * h * 4);

  /* Warm paper above, ink below, with the horizon a little above centre so the
     highlight lands where a reader expects a ceiling light to put it. This is
     the base the key window and the rim wash are cut into. */
  const top = [1.0, 0.96, 0.9];
  const horizon = [0.42, 0.39, 0.36];
  const bottom = [0.07, 0.06, 0.055];

  for (let y = 0; y < h; y++) {
    /* DataTexture has flipY = false, so row 0 of the array is the zenith --
       this v already runs ceiling (0) to floor (1), which is the convention
       the rest of this function assumes. */
    const v = y / (h - 1);
    let c;
    if (v < 0.55) {
      const k = v / 0.55;
      c = top.map((t, i) => t + (horizon[i] - t) * k * k);
    } else {
      const k = (v - 0.55) / 0.45;
      c = horizon.map((t, i) => t + (bottom[i] - t) * k);
    }

    /* The rim is a wash, not a window: it fades out at the ceiling and the
       floor rather than sitting in a box, strongest around the horizon. */
    const rimV = Math.sin(Math.PI * clamp01(v)) * 0.85;

    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const wKey = window1D(u, KEY.u, KEY.hu, KEY.su, true) * window1D(v, KEY.v, KEY.hv, KEY.sv, false);
      const wRim = window1D(u, RIM.u, RIM.hu, RIM.su, true) * rimV;

      let px = c[0];
      let py = c[1];
      let pz = c[2];
      if (wRim > 0) {
        px += (RIM.color[0] - px) * wRim;
        py += (RIM.color[1] - py) * wRim;
        pz += (RIM.color[2] - pz) * wRim;
      }
      if (wKey > 0) {
        px += (KEY.color[0] - px) * wKey;
        py += (KEY.color[1] - py) * wKey;
        pz += (KEY.color[2] - pz) * wKey;
      }

      const o = (y * w + x) * 4;
      data[o] = px;
      data[o + 1] = py;
      data[o + 2] = pz;
      data[o + 3] = 1;
    }
  }

  const tex = new DataTexture(data, w, h, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
