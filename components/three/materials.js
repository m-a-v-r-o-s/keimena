/**
 * The book's physical description, as one table, so a reader of this file can
 * see all six materials answer the room differently at a glance instead of
 * hunting nine JSX blocks for the one number that makes two parts look alike.
 * See LIGHT_PLAN.md section 5 -- the spread between these values is the whole
 * point: cover clearcoat next to greyboard roughness 0.96 is what makes a
 * reader see two materials instead of one plastic object shaded two colours.
 *
 * meshPhysicalMaterial compiles a heavier shader, so it is spent only where
 * it earns its keep. Each mesh keeps ONE material type always; only texture
 * presence (map: null vs loaded) ever changes, which is what the
 * `key={maps ? 'tex' : 'flat'}` pattern at each call site is for.
 *
 * BACK_BOARD and SPINE were physical (sheen, anisotropy, a thin clearcoat)
 * in the first pass, and dropped to meshStandardMaterial per the plan's own
 * fallback: frame time under drag measured +16-19% against the Phase 0
 * baseline, over the +15% budget, in this session's software-rendered
 * headless Chrome. The cover carries the effect -- FRONT_BOARD keeps its
 * clearcoat -- and HEADBAND stays physical too (it is a few triangles at
 * head and tail, not a full-size panel). Re-measure before reversing this;
 * a faster renderer may not need the downgrade at all.
 *
 * D21: every material here is patched via `onBeforeCompile` so the room
 * (env.js, `scene.environment`) never shows up as a reflection -- only the
 * key spotLight does. `envMapIntensity` cannot do this alone: three's
 * physical shader scales BOTH the environment's diffuse fill (`iblIrradiance`,
 * from `getIBLIrradiance`) and its specular reflection (`radiance`, from
 * `getIBLRadiance`) by the same uniform, so turning one down always turns
 * the other down with it. The patch below zeroes `radiance` (and
 * `clearcoatRadiance`) right after `#include <lights_fragment_maps>` computes
 * them and before `lights_fragment_end` consumes them -- `iblIrradiance` is
 * left alone, so the room's ambient fill still reaches every material, it
 * just never appears as a mirrored highlight. The key spotLight is untouched
 * by this: its highlight is computed per-light in `RE_Direct_Physical`, a
 * completely separate code path from the indirect/IBL one this patches.
 *
 * SPINE and BACK_BOARD get a second patch on top: real cloth barely
 * specularly reflects anything, from any source, not just the room -- so
 * for those two `material.specularColor` (the fixed 4% dielectric
 * reflectance three assumes for every non-metal, direct light included) is
 * also cut to near zero. This is the only lever available for that on
 * meshStandardMaterial: it has no `specularIntensity` prop the way
 * meshPhysicalMaterial does, and roughness cannot substitute -- D16 already
 * established that raising roughness spreads the same reflected energy into
 * a wider wash rather than removing it. Both patches share one
 * `customProgramCacheKey` per group deliberately: three does not fold
 * `onBeforeCompile`'s own content into its default program cache key, so
 * two materials with different injected GLSL but coincidentally identical
 * defines can silently share a compiled program and one of them renders
 * wrong. Giving each group an explicit key rules that out.
 */

function killEnvRadiance(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_fragment_maps>',
    `#include <lights_fragment_maps>
    radiance = vec3( 0.0 );
    #ifdef USE_CLEARCOAT
    clearcoatRadiance = vec3( 0.0 );
    #endif`
  );
}

function killEnvRadianceAndSpecular(shader) {
  killEnvRadiance(shader);
  /* Only the non-IOR branch of lights_physical_fragment -- the one every
     material here actually compiles, since none set `ior`/`specularIntensity`.
     If SPINE or BACK_BOARD ever gain that prop, this stops matching and
     silently no-ops; re-check this string then. */
  shader.fragmentShader = shader.fragmentShader.replace(
    'material.specularColor = vec3( 0.04 );',
    'material.specularColor = vec3( 0.004 );'
  );
}

const ENV_REFLECTION_ONLY = {
  onBeforeCompile: killEnvRadiance,
  customProgramCacheKey: () => 'env-radiance-killed',
};
const NO_SPECULAR_REFLECTION = {
  onBeforeCompile: killEnvRadianceAndSpecular,
  customProgramCacheKey: () => 'env-radiance-and-specular-killed',
};

/* Front board, outward: laminated printed art paper. The clearcoat is the
 * cover's whole job here -- a thin lacquer over the print.
 *
 * Tightened (D17): this is the face the landing view shows largest -- most
 * of the page height before any scroll -- and at the old clearcoatRoughness
 * (0.26) its highlight was a soft blob wide enough to pale a third of the
 * board, on every accent colour, dark ones worst since they have the least
 * diffuse signal to compete with a spread-out colourless coat reflection.
 * Roughness and clearcoatRoughness both cut so the coat reads as one glint
 * riding over a print that stays saturated everywhere else, the same lobe
 * logic as SPINE below, applied to the face that actually carries it here. */
export const FRONT_BOARD = {
  roughness: 0.55,
  clearcoat: 0.5,
  clearcoatRoughness: 0.12,
  envMapIntensity: 0.4,
  ...ENV_REFLECTION_ONLY,
};

/* Back board, outward: book cloth. meshStandardMaterial (see file header) --
 * the bump map still carries the weave, it just has no sheen grazing
 * highlight on top of it.
 *
 * Tightened alongside FRONT_BOARD and SPINE (D17), same reasoning: a rough
 * dielectric's own colourless reflectance is a wash, not a highlight, at
 * this size of panel. Kept clearly softer than the other two -- no coat, no
 * foil -- cloth is still the most matte surface on the book, just no longer
 * matte enough to grey out a dark cover.
 *
 * D21: `NO_SPECULAR_REFLECTION`, not just `ENV_REFLECTION_ONLY` -- this is
 * cloth, and real cloth does not throw a specular highlight from anything,
 * the key light included, the way a laminate or a lacquer does. See the file
 * header for what that spread actually does. */
export const BACK_BOARD = {
  roughness: 0.4,
  bumpScale: 0.35,
  envMapIntensity: 0.1,
  ...NO_SPECULAR_REFLECTION,
};

/* Spine covering: cloth with a foil title printed into the map.
 * meshStandardMaterial (see file header) -- no anisotropy, no clearcoat.
 * roughness tightened well below the plan's 0.8 starting spec (see
 * DECISIONS.md D16): a non-metal's colourless ~4% specular reflectance
 * spreads into a broad soft lobe at high roughness, and on a flat panel
 * that reads as the whole face veiled pale rather than as one highlight
 * travelling across it. envMapIntensity cut alongside it for the same
 * reason -- less of that veil coming from the environment too.
 *
 * Tightened again (D17), for the same higher-contrast pass as the two
 * boards above.
 *
 * D18: asked for less reflective AND more contrasty, which pull opposite
 * ways on roughness alone -- lower roughness sharpens the highlight (more
 * contrast) but also reads as glossier (more reflective). Split the two
 * asks onto different levers instead of fighting that tradeoff: roughness
 * left alone, envMapIntensity cut hard (that is the room literally
 * mirroring in the cloth, which is what "reflective" means to an eye, and
 * cutting it also stops it lifting the dark base the way D16/D17 already
 * showed), and bumpScale raised so the weave's own shadowing carries more
 * of the contrast instead of the specular lobe having to.
 *
 * D21: `NO_SPECULAR_REFLECTION` -- same cloth reasoning as BACK_BOARD. This
 * makes `roughness` above almost entirely vestigial for how this face looks
 * (there is no specular lobe left for it to shape), but it is left at 0.08
 * rather than cleaned up, since the diffuse term still reads it in principle
 * and re-tuning it now, with no reflection left to tune it against, would be
 * guessing. */
export const SPINE = {
  roughness: 0.08,
  bumpScale: 0.65,
  envMapIntensity: 0.02,
  ...NO_SPECULAR_REFLECTION,
};

/* Board cut edges, and the spine's inlay -- the binding seen end-on. Must
 * stay the dullest thing on the book, so every other surface reads against
 * it. */
export const EDGE = {
  roughness: 0.96,
  envMapIntensity: 0.22,
  ...ENV_REFLECTION_ONLY,
};

/* The page block, on its three exposed edges: cut paper. Almost no specular,
 * but it takes a lot of bounce off the room. */
export const PAGES = {
  roughness: 0.62,
  envMapIntensity: 0.85,
  ...ENV_REFLECTION_ONLY,
};

/* The headband, at head and tail: silk braid, the brightest small part of
 * the book. */
export const HEADBAND = {
  sheen: 0.6,
  sheenRoughness: 0.4,
  roughness: 0.55,
  envMapIntensity: 0.8,
  ...ENV_REFLECTION_ONLY,
};

/* The spine hollow, seen through the gap between headband and covering: the
 * unlit inside of a case. Must stay a hole -- unchanged from the first
 * calibration. */
export const HOLLOW = {
  roughness: 0.98,
  envMapIntensity: 0.05,
  ...ENV_REFLECTION_ONLY,
};

/* Endpaper, on the two boards' inner faces: printed paper, plain. */
export const ENDPAPER = {
  roughness: 0.85,
  envMapIntensity: 0.3,
  ...ENV_REFLECTION_ONLY,
};
