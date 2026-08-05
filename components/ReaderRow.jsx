'use client';

import { t as dict } from '@/lib/i18n';
import { title as bookTitle, titleLang, describe } from '@/lib/content';
import PressLinks from '@/components/PressLinks';

/**
 * One book's turn in the reader: its WebGL stage and its text, full width, at
 * least one screen tall (see .readerRow in globals.css). `heading` is 'h1' for
 * the one row a book page actually served -- the reader owns that book's
 * heading permanently, even once the reader has scrolled past it, because
 * heading levels must not mutate under a reader. Every other row is 'h2':
 * what comes next in the catalogue, not the page's own subject.
 */
export default function ReaderRow({ book, locale, heading: Heading = 'h2' }) {
  const s = dict(locale);

  return (
    <section className="readerRow">
      <div className="readerRow__text" role="region" aria-label={bookTitle(book, locale)}>
        <p className="meta detail__eyebrow">
          {book.featured ? s.outNow : s.published} · {book.year}
        </p>

        <Heading className="detail__title" lang={titleLang(book, locale)}>
          {bookTitle(book, locale)}
        </Heading>

        <p className="detail__desc">{describe(book, locale)}</p>

        <PressLinks book={book} locale={locale} heading={Heading} />
      </div>

      {/* Visually first (see .readerRow__stageWrap's `order` in globals.css)
          but second in the DOM: a screen reader hits the title and synopsis
          before the colophon, not after a page-count and ISBN it has no
          reason to expect first. */}
      <div className="readerRow__stageWrap">
        <div
          className="readerRow__stage"
          data-book-slot={book.id}
          data-slot-key="read"
          data-pose="upright"
          aria-hidden="true"
        />

        {/* The publisher's own colophon, one fact per line in the order they
            give them -- moved under the object it actually describes rather
            than the prose beside it. See DESIGN in app/globals.css
            .detail__edition. Each line is authored "Label: value"; split once
            at the first colon so the row can set the two apart (label,
            value) the way the rest of the site treats a fact rather than a
            sentence. */}
        <ul className="detail__edition" aria-label={s.editionLabel}>
          {book.edition_el.map((line) => {
            const i = line.indexOf(':');
            const label = line.slice(0, i);
            const value = line.slice(i + 1).trim();
            return (
              <li key={line}>
                <span className="detail__editionLabel">{label}</span>
                <span className="detail__editionValue">{value}</span>
              </li>
            );
          })}
        </ul>

        {/* Directly under the colophon and flush with its left edge (see
            .detail__buy in globals.css) -- ordinary block flow, no special
            alignment needed since both are plain-width siblings starting at
            the same left edge. */}
        <div className="detail__buy">
          <a className="btn--buy" href={book.buy_url} target="_blank" rel="noopener noreferrer">
            {s.buyLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
