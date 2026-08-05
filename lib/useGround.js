'use client';

import { useEffect } from 'react';
import grounds from '@/content/grounds.json';

/**
 * The room a book gets when it is opened, and the text that reads in it.
 *
 * The GROUND is a dark (or, for two books, light -- see `polarity`) tint of
 * the accent's COMPLEMENT -- the opposite side of the wheel, which is what
 * makes a cover sit forward off its background instead of sinking into it.
 *
 * The TEXT is three contrast tiers -- `text` / `muted` / `faint` -- carrying
 * the book's own accent HUE rather than a global token, so the words read as
 * that book's colour and not a generic cream. The nav mark and imprint in
 * the corner read off the same variables, so they recolour the moment the
 * room does.
 *
 * `data-polarity` lets CSS key off whether the room is dark or light -- two
 * books (see COLOR-REDESIGN.md) open onto a LIGHT room, and anything painted
 * over the reading ground with a hardcoded light colour needs that hook to
 * invert.
 *
 * All of it is derived and gated in tools/contrast.py (text >= 7:1, muted
 * >= 4.5:1, faint >= 3:1, cover >= 1.5:1, all against `reading`) and emitted
 * to content/grounds.json, so nothing here computes colour in the browser.
 *
 * Set on the document rather than on an element: the ground has to sit
 * behind the canvas, and the canvas is a sibling of everything a page
 * renders. `id` is whichever book the caller currently considers "active" --
 * a book being turned on the shelf, or the reader row nearest the viewport's
 * middle on a book page -- so this hook takes that answer rather than
 * computing it, and is shared by Shelf.jsx and Reader.jsx for exactly that
 * reason.
 */
export function useGround(id) {
  useEffect(() => {
    const root = document.documentElement;
    const active = grounds[id];
    const set = (k, v) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));

    set('--reading-ground', active?.reading);
    set('--book-text', active?.text);
    set('--book-muted', active?.muted);
    set('--book-faint', active?.faint);
    if (active?.polarity) root.setAttribute('data-polarity', active.polarity);
    else root.removeAttribute('data-polarity');

    return () => {
      for (const k of ['--reading-ground', '--book-text', '--book-muted', '--book-faint']) {
        root.style.removeProperty(k);
      }
      root.removeAttribute('data-polarity');
    };
  }, [id]);
}
