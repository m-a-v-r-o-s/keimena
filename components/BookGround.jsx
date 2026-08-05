import grounds from '@/content/grounds.json';

/**
 * The room's colour, on the very first paint -- a server component, no
 * 'use client'. Without this, a cold load of a book page would paint the
 * shelf's near-black and only transition into the book's own room once
 * lib/useGround.js's client effect runs, a visible 1.2s wrong-colour flash
 * that a book page (unlike the shelf, which really does start near-black)
 * has no reason to show.
 *
 * A `<style>` tag targeting `:root`, not an inline style on some element:
 * the ground has to be set on `documentElement`, which this component does
 * not render and cannot ref from a server component.
 *
 * `useGround` writes the same variables as INLINE styles on `documentElement`
 * once it runs client-side, and an inline style always beats a stylesheet
 * rule -- so this and the client hook never fight, and the scroll-driven
 * recolour (the room changing as the reader scrolls from book to book) still
 * works exactly as before. `data-polarity` stays client-set: it is an
 * attribute, not a variable, and no CSS keys off it yet.
 */
export default function BookGround({ id }) {
  const g = grounds[id];
  return g ? (
    <style>{`:root{--reading-ground:${g.reading};--book-text:${g.text};` +
      `--book-muted:${g.muted};--book-faint:${g.faint}}`}</style>
  ) : null;
}
