import { SITE_URL } from '@/lib/site';
import { shelfOrder } from '@/lib/content';

/* No `lastModified`/`changeFrequency`/`priority` -- this project tracks no
 * real per-page edit dates or update cadence, and inventing one is worse
 * than leaving the (optional) field out. `trailingSlash: true` in
 * next.config.mjs is why every URL here ends in `/`, matching the actual
 * routes (`/books/<id>/`, not `/books/<id>`).
 *
 * `dynamic = 'force-static'` is required under `output: 'export'` -- see
 * app/robots.js for why. */
export const dynamic = 'force-static';

export default function sitemap() {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/privacy/`,
    `${SITE_URL}/terms/`,
    ...shelfOrder().map((b) => `${SITE_URL}/books/${b.id}/`),
  ];
  return urls.map((url) => ({ url }));
}
