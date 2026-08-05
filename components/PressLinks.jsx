'use client';

import { t as dict } from '@/lib/i18n';
import { pressFor } from '@/lib/content';
import apospasma from '@/content/apospasma.json';

// A name in Latin script sitting inside otherwise-Greek text needs its own
// lang so a screen reader doesn't read "LIFO" as mangled Greek -- same
// reasoning as titleLang() in lib/content.js, applied to outlet names.
function isLatinName(s) {
  return !!s && /[A-Za-z]/.test(s) && !/[Ͱ-Ͽἀ-῿]/.test(s);
}

function mediumMarker(item, s) {
  if (item.medium === 'audio') return `(${s.audioMarker})`;
  if (item.medium === 'video') return `(${s.videoMarker})`;
  return null;
}

function Outlet({ item }) {
  const text = item.outlet || item.label_el;
  if (!text) return null;
  return <strong lang={isLatinName(text) ? 'en' : undefined}>{text}</strong>;
}

// A review quote never appears unattributed (praise_policy, content/books.json):
// only render it as a pulled quote when a named outlet or byline backs it.
//
// The link's accessible name is left to the browser to compute from its own
// visible content plus one trailing .visually-hidden span -- never a custom
// aria-label. An aria-label that *replaces* rather than extends the visible
// text fails WCAG 2.5.3 (Label in Name) the moment the visible text isn't
// the generic "Διαβάστε περισσότερα" the source site repeats -- and once a
// quote or an attribution is on screen, it never is.
function LinkItem({ item, s }) {
  const marker = mediumMarker(item, s);
  const showQuote = Boolean(item.quote) && Boolean(item.outlet || item.byline);
  const hasAttribution = Boolean(item.outlet || item.byline || item.label_el);
  return (
    <li className="pressLinks__item">
      <a href={item.url} target="_blank" rel="noopener noreferrer">
        {showQuote && <span className="pressLinks__quote">{item.quote}</span>}
        {hasAttribution && (
          <span className="pressLinks__attribution" aria-hidden={showQuote ? 'true' : undefined}>
            <Outlet item={item} />
            {item.byline && <span className="pressLinks__byline"> · {item.byline}</span>}
            {marker && <span className="pressLinks__marker"> {marker}</span>}
          </span>
        )}
        <span className="visually-hidden"> ({s.newTab})</span>
      </a>
    </li>
  );
}

/**
 * Press, interviews and the excerpt for one book -- everything pressFor()
 * hands back already has dead links and (by default) roundup listicles
 * filtered out, so the only decision left here is which of the three groups
 * have anything in them. Renders nothing at all for a book with none of the
 * three (content/README.md's rule: a sparse record still has to look like a
 * finished object, not a broken gap).
 *
 * `heading` is the tag ReaderRow used for this row's own title ('h1' for the
 * one row a book page actually served, 'h2' for every other row in the
 * expanded stack -- see ReaderRow.jsx). Group headings are one level below
 * that, never a hardcoded h3: a row titled h1 followed by h3 skips a level.
 */
export default function PressLinks({ book, locale, heading = 'h2' }) {
  const s = dict(locale);
  const data = pressFor(book.id);
  if (!data) return null;

  const { excerpt, links } = data;
  const interviews = links.filter((l) => l.kind === 'interview');
  const press = links.filter((l) => l.kind !== 'interview');
  const hasExcerpt = Boolean(excerpt && (excerpt.flipbook || excerpt.pdf));

  // The generated border/title button (tools/apospasma.mjs, D25) replaces
  // the plain PDF text link once a book's entry is both present AND
  // approved -- gated on approval, not just presence, so a book still
  // mid-review keeps the text link rather than linking to art that doesn't
  // exist yet or hasn't been signed off.
  const excerptArt = apospasma.byBook[book.id];
  const hasExcerptButton = Boolean(excerptArt?.approved && excerpt?.pdf);

  if (!hasExcerpt && interviews.length === 0 && press.length === 0) return null;

  const GroupHeading = heading === 'h1' ? 'h2' : 'h3';

  return (
    <section className="pressLinks" aria-label={s.pressLabel}>
      {hasExcerpt && (
        <div className="pressLinks__group">
          {/* The button already carries "Απόσπασμα από {title}" baked into
              its own artwork -- a group heading repeating "Απόσπασμα" above
              it would say the same thing twice. Only the plain-text fallback
              (no approved border yet) still needs the heading, since it has
              no visual label of its own. */}
          {!hasExcerptButton && <GroupHeading className="pressLinks__heading">{s.excerptLabel}</GroupHeading>}
          <ul className="pressLinks__list">
            {excerpt.flipbook && (
              <li className="pressLinks__item">
                <a href={excerpt.flipbook} target="_blank" rel="noopener noreferrer">
                  {s.excerptFlipbook}
                  <span className="visually-hidden"> ({s.newTab})</span>
                </a>
              </li>
            )}
            {excerpt.pdf && (
              <li className={hasExcerptButton ? undefined : 'pressLinks__item'}>
                {hasExcerptButton ? (
                  <a
                    className="pressLinks__excerptButton"
                    href={excerpt.pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${excerptArt.label_el} ${excerptArt.title_el} (${s.pdfMarker}, ${s.newTab})`}
                    style={{ '--apospasma-src': `url(/apospasma/${book.id}.webp)` }}
                  />
                ) : (
                  <a href={excerpt.pdf} target="_blank" rel="noopener noreferrer">
                    {s.excerptPdf}
                    <span className="visually-hidden"> ({s.newTab})</span>
                  </a>
                )}
              </li>
            )}
          </ul>
        </div>
      )}

      {interviews.length > 0 && (
        <div className="pressLinks__group">
          <GroupHeading className="pressLinks__heading">{s.interviewsLabel}</GroupHeading>
          <ul className="pressLinks__list">
            {interviews.map((item) => (
              <LinkItem key={item.url} item={item} s={s} />
            ))}
          </ul>
        </div>
      )}

      {press.length > 0 && (
        <div className="pressLinks__group">
          <GroupHeading className="pressLinks__heading">{s.pressLabel}</GroupHeading>
          <ul className="pressLinks__list">
            {press.map((item) => (
              <LinkItem key={item.url} item={item} s={s} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
