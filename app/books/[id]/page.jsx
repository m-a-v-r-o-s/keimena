import Nav from '@/components/Nav';
import BookGround from '@/components/BookGround';
import Reader from '@/components/Reader';
import Footer from '@/components/Footer';
import { DEFAULT_LOCALE } from '@/lib/i18n';
import { bookById, catalogueYears, describe, shelfOrder, title as bookTitle } from '@/lib/content';
import { SITE_URL } from '@/lib/site';
import grounds from '@/content/grounds.json';

/* 17 real pages, decided at build time -- no id outside shelfOrder() is ever
   a route. See DECISIONS.md D23 and HANDOFF-book-pages.md decision 1. */
export function generateStaticParams() {
  return shelfOrder().map((b) => ({ id: b.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const book = bookById(id);
  const locale = DEFAULT_LOCALE;
  const desc = describe(book, locale);
  const title = bookTitle(book, locale);
  return {
    title,
    description: desc,
    alternates: { canonical: `/books/${id}/` },
    /* metadataBase (app/layout.jsx) now resolves against the real SITE_URL
       constant (lib/site.js), so these resolve absolute against that --
       still a placeholder domain until the site has a real one, but a
       single one, not three that could drift. Every title already has an
       og.png (tools/covers.mjs), licensed or not. `type: 'book'` is a real
       Open Graph object type (the protocol's own book vertical); `url` is
       repeated here rather than inherited from the root layout's own
       openGraph because Next replaces, not merges, a page's openGraph
       object against its parent's. */
    openGraph: {
      title,
      description: desc,
      type: 'book',
      url: `${SITE_URL}/books/${id}/`,
      images: [`/covers/${id}/og.png`],
    },
  };
}

/* The room's colour in the browser chrome itself, matching the page's own
   first paint (BookGround.jsx) rather than the shelf's fixed #1B1714 (see
   app/layout.jsx's `viewport`). */
export async function generateViewport({ params }) {
  const { id } = await params;
  return { themeColor: grounds[id]?.reading ?? '#1B1714' };
}

export default async function BookPage({ params }) {
  const { id } = await params;
  const locale = DEFAULT_LOCALE;
  const books = shelfOrder();
  const { oldest, newest } = catalogueYears(books);

  return (
    <>
      <Nav />
      <BookGround id={id} />
      <main id="main">
        <Reader key={id} books={books} locale={locale} currentId={id} />
      </main>
      <Footer locale={locale} count={books.length} from={oldest} to={newest} />
    </>
  );
}
