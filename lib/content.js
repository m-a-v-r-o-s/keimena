import books from '@/content/books.json';
import author from '@/content/author.json';
import press from '@/content/press.json';
import { t as dict } from '@/lib/i18n';

export const AUTHOR = author;

/**
 * Every record we hold, including titles that are not currently shown.
 * Use `shelfOrder()` for anything user-facing.
 */
export const ALL_BOOKS = books.books;

/**
 * A book reaches the site only if the publisher has licensed its cover.
 *
 * This is a filter rather than a deletion on purpose: the bibliography in
 * content/books.json was sourced and verified, and throwing records away to
 * hide them would destroy work that is hard to recover. Drop a cover into
 * tools/covers-src/<id>.webp, re-run tools/accents.mjs and tools/covers.mjs,
 * and that title reappears on its own.
 */
export const LICENSED_BOOKS = ALL_BOOKS.filter((b) => b.cover_licensed);

/**
 * Shelf order is chronological by FIRST publication, newest first.
 * Never sort on `reissue_year` -- Keimena's author page lists reissue years,
 * and sorting on those collapses a 30-year arc into a 5-year one.
 * See content/README.md.
 */
export function shelfOrder() {
  /* Undated titles sort last rather than to the top: `null - 2026` is NaN,
     which leaves the comparator's result undefined and the order arbitrary. */
  return [...LICENSED_BOOKS].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
}

/**
 * `shelfOrder()`, projected to what the shelf page's own client component
 * tree actually reads off each book -- plan.md Phase 5.1.
 *
 * `Shelf.jsx` (`id`, `year`, `title_el`/`title_en` via `title()`/`titleLang()`,
 * `teaser_el`/`teaser_en` via `teaser()`) and `Rail.jsx` (`id` only) are the
 * only consumers of the array this feeds -- neither reads a synopsis, the
 * characters list, praise quotes, or any of books.json's other fields, all
 * of which `shelfOrder()`'s full records still carry. Passing the full
 * records as `<Shelf books={...}>` props means Next serialises every one of
 * those unused fields into the RSC flight payload (the inlined data a
 * client component hydrates from) for all 17 books, on every load of `/`.
 *
 * Does NOT touch `bookById()` or the plain `books.json` import elsewhere in
 * this module -- `BookCanvas.jsx` imports `bookById` directly (a client
 * component reaching past props into this module), and it needs the FULL
 * record for whichever single book a drag or a slot's dataset id names, not
 * a projection sized for the shelf's own list rendering. That is a separate
 * question from what one page passes down as props, and shrinking one must
 * not shrink the other.
 */
export function shelfBooks() {
  return shelfOrder().map((b) => ({
    id: b.id,
    year: b.year,
    title_el: b.title_el,
    title_en: b.title_en,
    teaser_el: b.teaser_el,
    teaser_en: b.teaser_en,
  }));
}

export function bookById(id) {
  return ALL_BOOKS.find((b) => b.id === id);
}

/** Locale-aware field access. Falls back to Greek -- never renders `undefined`. */
export function field(book, key, locale) {
  const suffix = locale === 'en' ? '_en' : '_el';
  return book[key + suffix] ?? book[key + '_el'] ?? null;
}

export function title(book, locale) {
  return field(book, 'title', locale) ?? book.title_el;
}

/**
 * Which language a title is actually rendered in.
 *
 * Most books have no English title, so an EN page still shows the Greek one --
 * and that element must carry lang="el" or a screen reader reads Greek as
 * mangled Latin. This has to be derived from the data rather than the page
 * locale, which is why it lives here and not in each component.
 */
export function titleLang(book, locale) {
  return locale === 'en' && book.title_en ? 'en' : 'el';
}

export function synopsis(book, locale) {
  if (book.synopsis_status !== 'publisher') return null;
  return field(book, 'synopsis', locale);
}

/** The publisher's one-line note about a book, shown while it's held and
    turned, not yet opened. Empty string counts as missing. */
export function teaser(book, locale) {
  const t = field(book, 'teaser', locale);
  return t && t.trim() ? t : null;
}

/**
 * A description, never an invented one.
 *
 * Only two of twenty-seven titles have a sourced publisher synopsis (D3), and
 * nothing here writes one. Where there is no blurb the record states what is
 * actually known -- series position, first publication, imprint -- which is a
 * complete description of a catalogue entry rather than an apology for a
 * missing one.
 *
 * Shared by ReaderRow.jsx (the reading view's own description) and
 * `generateMetadata` in app/books/[id]/page.jsx (the fallback for titles with
 * no sourced synopsis) -- one definition of "what this catalogue entry says
 * about itself" rather than two that could drift apart.
 */
export function describe(book, locale) {
  const s = dict(locale);
  const syn = synopsis(book, locale);
  if (syn) return syn;
  const bits = [];
  if (book.series === 'charitos' && book.series_order) {
    bits.push(`${s.seriesLabel} · ${book.series_order}`);
  }
  bits.push(`${s.published} ${book.year}`);
  if (book.publisher) bits.push(book.publisher);
  return bits.join(' - ') + '.';
}

// Roundup listicles ("100 βιβλία για το καλοκαίρι") mention a title once
// among dozens of others -- real provenance, but they pad the block and
// dilute the interviews and reviews that are actually about this book.
// Harvested and kept in press.json either way (tools/press.mjs); this is
// the one flag that decides whether they render. Flip to true to include
// them site-wide.
const RENDER_ROUNDUPS = false;

/**
 * A book's press coverage: the excerpt (flipbook/PDF) and its interview and
 * press links, already stripped of dead links and (by default) roundups --
 * once, here, so PressLinks.jsx's "there's nothing to show" branch is a
 * single check rather than re-deriving the filter in the component.
 */
export function pressFor(id) {
  const rec = press.byBook[id];
  if (!rec) return null;
  const links = rec.links.filter((l) => !l.dead && (RENDER_ROUNDUPS || l.kind !== 'roundup'));
  if (!rec.excerpt && links.length === 0) return null;
  return { excerpt: rec.excerpt, links };
}

/**
 * The years the shelf spans -- shared by `/` and every book page's footer
 * (both render the same `<Footer count from to>`). Two titles carry no
 * sourced year (see year_status in books.json), so the span is taken from
 * the years that exist rather than from the ends of the array.
 */
export function catalogueYears(books) {
  const years = books.map((b) => b.year).filter(Boolean);
  return { oldest: Math.min(...years), newest: Math.max(...years) };
}
