import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { DEFAULT_LOCALE, t as dict } from '@/lib/i18n';
import { shelfOrder, catalogueYears } from '@/lib/content';

export const metadata = {
  title: 'Η σελίδα δεν βρέθηκε',
};

/**
 * The App Router's own 404 -- rendered for any path outside `generateStaticParams`'s
 * 17 book ids (see app/books/[id]/page.jsx's `dynamicParams = false`) and for
 * every other unknown path. `next build` with `output: 'export'` turns this
 * into a static 404.html.
 *
 * Same Nav/Footer as every real page, not a bare error screen: a reader who
 * lands here from a dead link is still on the catalogue, and the footer's own
 * facts and links are exactly as true here as anywhere else.
 */
export default function NotFound() {
  const locale = DEFAULT_LOCALE;
  const s = dict(locale);
  const books = shelfOrder();
  const { oldest, newest } = catalogueYears(books);

  return (
    <>
      <Nav />
      <main id="main">
        <section className="wrap section">
          <p className="meta detail__eyebrow">{s.notFoundEyebrow}</p>
          <h1 className="intro__title">{s.notFoundTitle}</h1>
          <p>{s.notFoundBody}</p>
          <p>
            <Link className="btn--buy notFound__cta" href="/">
              {s.notFoundCta}
            </Link>
          </p>
        </section>
      </main>
      <Footer locale={locale} count={books.length} from={oldest} to={newest} />
    </>
  );
}
