/**
 * The one place the site's real domain would go. `example.invalid` is the
 * RFC 2606 reserved placeholder (guaranteed to never resolve) -- app/layout.jsx's
 * `metadataBase`, app/robots.js and app/sitemap.js all resolve their absolute
 * URLs against this SAME constant, so pointing the site at a real domain is a
 * one-line change here instead of three separately-drifting literals.
 *
 * NEEDS A REAL DOMAIN before this site goes live: every canonical URL,
 * og:url and sitemap entry currently resolves against a fake host.
 */
export const SITE_URL = 'https://example.invalid';

/**
 * One key, shared by CookieConsent.jsx (writes it) and Analytics.jsx (reads
 * it) -- so "has this reader consented" has exactly one source of truth
 * instead of two string literals that could drift apart.
 */
export const CONSENT_KEY = 'markaris-press-consent';
