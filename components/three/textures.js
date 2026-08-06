import {
  TextureLoader,
  SRGBColorSpace,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
} from 'three';

/**
 * A tiny shared texture cache.
 *
 * Loading is deliberately lazy and keyed on URL: BookVolume only mounts for
 * slots near the viewport, so a cover is fetched the first time its book is
 * actually about to be seen and then reused everywhere else it appears -- the
 * same book shows up on the shelf, in the trilogy set and on its own page.
 *
 * colorSpace matters here. A cover texture is authored sRGB, and leaving it as
 * the default would render every book measurably off its own accent -- the one
 * thing the whole per-book colour system is not allowed to get wrong.
 */
const loader = new TextureLoader();
const cache = new Map();

export function loadTexture(url) {
  let entry = cache.get(url);
  if (entry) return entry;

  entry = new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 4;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.generateMipmaps = true;
        resolve(tex);
      },
      undefined,
      reject
    );
  });

  /* A failed load must not be remembered. The cache is keyed on URL and hands
     back the same promise forever, so caching a rejection means one dropped
     request -- a connection reset while seventeen covers and seventeen spines
     queue behind six sockets -- permanently blanks that surface for the rest of
     the session, with no way back short of a reload. Forgetting it lets the
     next book that asks for the same sheet try again. */
  entry.catch(() => {
    if (cache.get(url) === entry) cache.delete(url);
  });

  cache.set(url, entry);
  return entry;
}

export const FOREDGE_URL = '/textures/foredge.webp';
export const CLOTH_URL = '/textures/cloth.webp';
export const BOARD_URL = '/textures/board.webp';
export const TOPEDGE_URL = '/textures/topedge.webp';
export const ENDPAPER_URL = '/textures/endpaper.webp';
export const HEADBAND_URL = '/textures/headband.webp';

/**
 * Surface sheets, prepared once and shared by every book.
 *
 * Unlike a cover, these carry no identity -- the same weave runs across the
 * whole shelf, tinted per book by the material's colour rather than by a
 * separate copy of the image. So they are cached with their repeat already
 * set, and seventeen books cost one texture each instead of seventeen.
 *
 * The repeats differ by role because the surfaces do: a back board is broad
 * and nearly square, a board edge is a long thin sliver, and a weave stretched
 * along one reads as smearing rather than as cloth.
 */
const surfaces = new Map();

export function surface(url, repeatX, repeatY) {
  const key = `${url}|${repeatX}x${repeatY}`;
  let entry = surfaces.get(key);
  if (entry) return entry;
  entry = loadTexture(url).then((tex) => {
    const t = tex.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.needsUpdate = true;
    return t;
  });
  /* Same reasoning as loadTexture: a rejection is not worth remembering. */
  entry.catch(() => {
    if (surfaces.get(key) === entry) surfaces.delete(key);
  });
  surfaces.set(key, entry);
  return entry;
}


export const coverUrl = (id) => `/covers/${id}/front.webp`;
/* The stacked pose's own front -- 320x480 against the full 683x1024, built by
 * tools/covers.mjs's buildLicensedFrontSmall. The stack shows a book raked
 * almost flat (POSE.stacked.rake in book-model.js), the cover a sliver a few
 * pixels deep, so the full photograph was resolution spent on nothing a
 * reader could see. See BookVolume.jsx for which pose gets which sheet. */
export const coverSmallUrl = (id) => `/covers/${id}/front-sm.webp`;
export const spineUrl = (id) => `/covers/${id}/spine.webp`;
