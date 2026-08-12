import { SITE_URL } from '@/lib/site';

/* Next's metadata-route convention -- works under `output: 'export'`, and
 * `next build` renders this to a static robots.txt. Nothing on this site is
 * gated behind auth or meant to stay out of an index, so the rule is the
 * simplest true one: everything is allowed.
 *
 * `dynamic = 'force-static'` is required under `output: 'export'` --
 * without it `next build` refuses to prerender this route at all (it can't
 * tell a metadata route apart from one that might read the request). */
export const dynamic = 'force-static';

export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
