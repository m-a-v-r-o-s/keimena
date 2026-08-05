/**
 * The one event the page and the canvas share.
 *
 * It lives in its own module on purpose. Importing it from BookCanvas would
 * pull three and react-three-fiber into whatever imported it -- including the
 * server-rendered page -- which defeats the `ssr: false` boundary the canvas
 * depends on. A constant should not cost a 3D engine.
 */
export const SLOTS_CHANGED = 'bookslots:changed';

/**
 * Which book is currently being turned in the reader's hand, or null.
 * `detail.id`. The canvas owns the gesture; the page owns the room's colour,
 * and this is how the one tells the other.
 */
export const DRAG_BOOK = 'bookdrag:change';

/**
 * Fired once the renderer exists and is drawing. The loader waits for this as
 * well as for the covers: clearing on the covers alone let the loader come
 * down while the canvas was still starting, and what showed underneath was the
 * row of fallback spine bars the loader exists to replace.
 */
export const CANVAS_READY = 'bookcanvas:ready';
