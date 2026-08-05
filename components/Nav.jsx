import Link from 'next/link';
import { t as dict } from '@/lib/i18n';

/**
 * The mark, and nothing else.
 *
 * One language, and the only real navigation is a book page's own rail back
 * control (see Rail.jsx) -- so a bar with links, a running title and a
 * locale toggle would still be chrome pretending to be navigation this small
 * a site doesn't need. What is left is the publisher's mark in the top-left
 * corner: enough to say whose catalogue this is, and to get back to the
 * shelf from anywhere, on every page (D23).
 */
export default function Nav() {
  const s = dict();

  return (
    <header className="head">
      {/* The catalogue is at the root, so the mark points there. It used to
          build the href from the locale segment; with the segment gone, that
          would have kept linking to a page that no longer exists.

          Same asset and mask technique as .foot__glyph (Footer.jsx): the webp
          ships white-on-alpha with no colour baked in, so the one file serves
          both the footer's own mark and this corner, recoloured live to
          --book-text via mask rather than painted as an <img>. */}
      <Link className="head__mark" href="/" aria-label={s.siteName}>
        <span aria-hidden="true" className="head__mark-glyph" />
      </Link>
    </header>
  );
}
