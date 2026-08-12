import Nav from '@/components/Nav';
import Shelf from '@/components/Shelf';
import Footer from '@/components/Footer';
import AuthorPoster from '@/components/AuthorPoster';
import { DEFAULT_LOCALE, t as dict } from '@/lib/i18n';
import { AUTHOR, catalogueYears, shelfBooks } from '@/lib/content';
import { SITE_URL } from '@/lib/site';

export function generateMetadata() {
  const s = dict(DEFAULT_LOCALE);
  const description = AUTHOR.bio_short_el;
  return {
    title: s.worksTitle,
    description,
    alternates: { canonical: '/' },
    /* A full, self-contained openGraph object -- Next replaces rather than
       deep-merges a page's `openGraph` against the root layout's, so title/
       description/url/type/image all have to be repeated here even though
       the root layout already sets its own defaults (see app/layout.jsx). */
    openGraph: {
      title: s.worksTitle,
      description,
      url: SITE_URL,
      type: 'website',
      images: [{ url: '/og-home.jpg', width: 1200, height: 630, alt: s.worksTitle }],
    },
  };
}

/**
 * The shelf. Every book in one stack, browsable and draggable -- and, since
 * D23, a real front door: each spine is a `<Link>` to that book's own page
 * at `/books/<id>/`, not a control that opens an overlay in place. A book is
 * a destination you navigate to now; the shelf is where that journey starts,
 * not the whole of the site.
 *
 * It lives at `/`, and that is the whole of the address. This used to be
 * `/[locale]/`, with `/` a stub that bounced every visitor to `/el/`. The
 * segment never earned its keep: LOCALES has only ever held `el`, so the site
 * spent its root on a redirect to its only language. A second language, if it
 * comes, is better solved then -- against real English copy -- than paid for
 * now with a longer URL for everyone.
 *
 * The components still take a `locale`; they and the content helpers are
 * written to switch on it and there is no reason to tear that out. It is simply
 * sourced from DEFAULT_LOCALE now rather than from the URL.
 *
 * Order is chronological by FIRST publication, newest first. Never sort on
 * reissue years: the publisher's author page lists those, and sorting on them
 * collapses a thirty-year arc into a five-year one. See content/README.md.
 */
export default function CataloguePage() {
  const locale = DEFAULT_LOCALE;
  const books = shelfBooks();
  const { oldest, newest } = catalogueYears(books);

  return (
    <>
      <Nav />
      <main id="main">
        <Shelf books={books} locale={locale} />

        {/* The standing text sits AFTER the stack.
            Above it, it was a paragraph to be got past before the catalogue
            began; below it, it is what the catalogue arrives at -- the reader
            has already met the books by the time they are told whose they are.
            A <section>, not a <header>: it introduces nothing that follows it,
            and calling it a header while it sits at the foot of the page would
            be a lie told only to markup. */}
        {/* The bio arrives as a folded sheet and opens as it is scrolled up.
            The publisher's own text, verbatim -- see bio_el_source. The short
            bio is still what the page's meta description carries: a search
            result wants a sentence, not a career. */}
        <section className="wrap intro">
          <AuthorPoster
            name={AUTHOR.name_el}
            bio={AUTHOR.bio_el}
            photo="/author.webp"
            photoAlt={AUTHOR.name_el}
          />
        </section>
      </main>

      <Footer locale={locale} count={books.length} from={oldest} to={newest} />
    </>
  );
}

