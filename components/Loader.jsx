'use client';

import { t as dict } from '@/lib/i18n';

/**
 * The load state: a book with its pages actually turning.
 *
 * Markup and keyframes are Uiverse.io's "Book" loader by anand_4957, kept
 * structurally as-is (five pages, each with its own flip delay, is what
 * reads as a shuffling stack rather than one card flipping). The colours are
 * not: the original is a generic purple, and every hue here is now pulled
 * from the site's own tokens (see loader-cover/loader-pg* in globals.css) so
 * it reads as this catalogue's book rather than a borrowed component.
 *
 * It replaces the row of spine bars that used to sit there. Those bars were the
 * no-WebGL fallback showing through before the canvas and its textures arrived,
 * which meant the first thing a reader saw was seventeen grey placeholders
 * pretending to be the thing they were waiting for. One drawn book, doing what
 * a book does, says "not ready yet" honestly and is worth looking at.
 *
 * DELIBERATE, SCOPED EXCEPTION TO D4, which bans perpetual loops. The ban
 * exists so nothing on a literary catalogue pulses for decoration. This loop
 * runs only while work is actually happening and stops the moment it finishes:
 * it reports, it does not ornament. Nothing else on the site may take this as
 * precedent.
 *
 * It renders on the server but is hidden by default and only revealed once
 * JavaScript sets `data-loading` on the document. Without JS it never appears
 * at all -- otherwise a reader with no JS would be trapped behind a loading
 * screen that could never finish, staring at a site that was in fact ready.
 */
export default function Loader({ locale }) {
  const s = dict(locale);

  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader__inner">
        <div className="book" aria-hidden="true">
          <div className="book__pg-shadow" />
          <div className="book__pg" />
          <div className="book__pg book__pg--2" />
          <div className="book__pg book__pg--3" />
          <div className="book__pg book__pg--4" />
          <div className="book__pg book__pg--5" />
        </div>

        <p className="visually-hidden">{s.loading}</p>
      </div>
    </div>
  );
}
