import Link from 'next/link';
import { t as dict } from '@/lib/i18n';
import { AUTHOR } from '@/lib/content';

/* The actual brand marks the user supplied (public/fb.png, ig.png, yt.png),
   not a hand-drawn abstraction -- recut by tools/social-marks.py so they
   carry the footer's own two tones instead of each platform's own
   blue/gradient/red, each keeping its OWN shape (Facebook's circle,
   YouTube's rounded rect) rather than being forced into a uniform chip --
   see the .foot__socialLink comment in the CSS for why that chip is gone.
   Real <img>, not a mask: the colour is already baked into the pixels, so
   there's no mask-size arithmetic left to get wrong (see the .foot__bleed
   comment for how that bit us once already). w/h below are each asset's own
   true intrinsic size -- rerun the script and copy its printed sizes here
   if the source PNGs are ever swapped. */
const SOCIAL = [
  { key: 'facebook', href: 'https://www.facebook.com/KeimenaBooks', src: '/fb-mark.webp', w: 2000, h: 2000, labelKey: 'facebookLabel' },
  { key: 'instagram', href: 'https://www.instagram.com/keimena.books', src: '/ig-mark.webp', w: 962, h: 962, labelKey: 'instagramLabel' },
  // A filled rounded rect reads heavier than a circle or a frame at the same
  // box height, so this one is dialled down a step -- see .foot__socialIcon--sm.
  { key: 'youtube', href: 'https://www.youtube.com/channel/UCul3dO85zADUeiTHe7i5c1w', src: '/yt-mark.webp', w: 962, h: 680, labelKey: 'youtubeLabel', small: true },
];

/**
 * The closing chapter, not a strip of small print.
 *
 * A catalogue with no shop has no call to action, so this does what the end of
 * a book does: states the imprint, the extent of the collection, and the terms
 * the material is here under. The cover licence line is the one piece of
 * genuinely load-bearing text on the page -- the artwork belongs to the
 * publisher, and the site says so plainly rather than burying it.
 *
 * The panel reads as folded OVER the page rather than parked beneath it: no
 * hard rule marks where the page ends and the footer begins, and the mark's
 * own glyph bleeds up across that seam as a held-back watermark (.foot__bleed,
 * see the CSS) -- an end-paper folding over the last leaf, not a strip glued
 * to the bottom of one.
 */
export default function Footer({ locale, count, from, to }) {
  const s = dict(locale);
  const langs = AUTHOR.languages_translated.count;

  return (
    <footer className="foot">
      {/* Decorative only -- the same elephant glyph as the corner mark (Nav.jsx),
          held far back in tone and scaled up past the footer's own top edge. */}
      <span className="foot__bleed" aria-hidden="true" />

      <div className="wrap foot__inner">
        <div className="foot__lockup">
          {/* The publisher's own wordmark artwork, not live type -- see the
              .foot__mark comment in globals.css for why. lang="el" travels
              with the accessible name since a screen reader still needs to
              know to read s.buyAt in Greek, even though there's no visible
              text node left to carry the attribute. */}
          <span className="foot__mark" role="img" aria-label={s.buyAt} lang="el" />
        </div>

        <div className="foot__row">
          <div className="foot__factsBlock">
            {/* The three numbers below are his: the byline attributes them
                before they're read, rather than leaving them to float free
                under the publisher's own mark. */}
            <p className="foot__byline">{AUTHOR.name_el}</p>
            <dl className="foot__facts">
              <div className="foot__fact">
                <dt className="meta">{s.titlesLabel}</dt>
                <dd>{count}+</dd>
              </div>
              <div className="foot__fact">
                <dt className="meta">{s.spanLabel}</dt>
                <dd>
                  {from}
                  <span aria-hidden="true"> - </span>
                  {to}
                </dd>
              </div>
              <div className="foot__fact">
                <dt className="meta">{s.languagesLabel}</dt>
                <dd>{langs}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="foot__fine">
          <nav className="foot__social" aria-label={s.socialLabel}>
            <ul className="foot__socialList">
              {SOCIAL.map(({ key, href, src, w, h, labelKey, small }) => (
                <li key={key}>
                  <a className="foot__socialLink" href={href} target="_blank" rel="noopener noreferrer">
                    <img
                      className={`foot__socialIcon${small ? ' foot__socialIcon--sm' : ''}`}
                      src={src}
                      width={w}
                      height={h}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                    />
                    <span className="visually-hidden">
                      <span lang="en">{s[labelKey]}</span> ({s.newTab})
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <p>{s.coverCredit}</p>
          <p>{s.footerNote}</p>
          {/* Set apart from the rule-of-the-house fine print above it -- a
              tagged notice, not another quiet sentence -- so it reads as
              deliberate rather than a stray line left in by accident. */}
          <p className="foot__test">
            <span className="foot__testTag">{s.testTag}</span>
            {s.testNotice}
          </p>

          {/* The only cross-links to the site's two static text pages --
              nowhere else on the site has a nav bar to hold them (see
              Nav.jsx's own reasoning for staying mark-only), and the
              footer's fine print is where a reader expects to find them. */}
          <nav aria-label={s.legalLabel}>
            <ul className="foot__legal">
              <li>
                <Link href="/privacy/">{s.privacyLabel}</Link>
              </li>
              <li>
                <Link href="/terms/">{s.termsLabel}</Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
