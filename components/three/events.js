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

/**
 * Which tracked slot is nearest the viewport's middle, as an index into
 * BookCanvas's own `slotsRef` (which on the shelf page is the `books` array
 * in DOM order, one to one). `detail.index`.
 *
 * Published from `place()` in BookCanvas.jsx, which already measures every
 * slot's rect every frame for its own layout purposes and already computes
 * this exact quantity as `s.progress`. Shelf.jsx used to run a second,
 * independent rAF-throttled scroll listener doing its own
 * `getBoundingClientRect` pass over the same elements to answer the same
 * question -- "one tracker, multiple consumers" (plan.md Phase 2.5) is the
 * fix: compute it once, here, and let every consumer read the broadcast
 * instead of re-deriving it.
 */
export const SHELF_CURRENT = 'bookshelf:current';
