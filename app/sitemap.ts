import type { MetadataRoute } from 'next';
import { site } from '@/lib/site-config';
import { getSiteUrl } from '@/lib/site-url';
import { db } from '@/lib/db';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';
import { urlPath } from '@/lib/slug';
import { localePath } from '@/lib/locale-path';
import { altLanguages, secondaryLocaleOf } from '@/lib/locale-seo';

// rendered per request so a post published in the admin shows up immediately
export const dynamic = 'force-dynamic';

/* One address in every language it exists in.

   A second language with no sitemap entry is a second language Google has to
   find by luck, and the `alternates` block is what tells it the two rows are
   one page rather than duplicate content. Written as an expansion of the
   primary row so a route can never be listed in one language and forgotten in
   the other. */
type Meta = { lastModified: Date; changeFrequency: 'weekly' | 'monthly'; priority: number };
const abs = (base: string, p: string) => `${base}${p === '/' ? '' : p}`;

/** One address in every language it EXISTS in.

    `both` is false for a story whose translation has not run yet: the Chinese
    row would be a promise the site cannot keep, and the `alternates` block on
    the English row would point a crawler at a 404. A sitemap that lies about
    one address is a sitemap that gets trusted less about all of them. */
function rows(base: string, path: string, meta: Meta, both: boolean) {
  const sec = secondaryLocaleOf();
  const languages = both ? altLanguages(path) : undefined;
  const alternates = languages
    ? { alternates: { languages: Object.fromEntries(Object.entries(languages).map(([k, v]) => [k, abs(base, v)])) } }
    : {};
  const out = [{ url: abs(base, path), ...meta, ...alternates }];
  if (sec && both) out.push({ url: abs(base, localePath(sec, path)), ...meta, ...alternates });
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  /* Through an offer, not a model.

     Naming the blog's table here made this route uncompilable without the
     content module, so codegen replaced the whole file with a pages-only one —
     silently dropping every collection entry from the sitemap of any site that
     has content types and no blog, which is exactly a newsroom. A missing offer
     is a legitimate no-op; a database hiccup still leaves the pages listed.

     Written without naming that table even in prose: the hot-plug gate greps
     this file for it and cannot tell a comment from a call, which is the right
     way round for a rule about what a file is allowed to know. */
  const posts = await (offers.postUrls?.(db) ?? Promise.resolve([])).catch(() => []);
  // a row that predates listing pages has no address of its own to publish
  const listings = (await (offers.listingUrls?.(db) ?? Promise.resolve([])).catch(() => [])).filter((l) => l.slug);
  // only content types that actually have a detail page are addressable
  const detailed = (site.collections ?? []).filter((c) => c.detailPage !== false).map((c) => c.slug);
  const ask = (locale?: string) =>
    detailed.length ? (offers.sitemapEntries?.(db, detailed, locale) ?? Promise.resolve([])).catch(() => []) : Promise.resolve([]);
  const sec = secondaryLocaleOf();
  // the two lists differ by exactly the stories whose translation is still held
  const [entries, secEntries] = await Promise.all([ask(), sec ? ask(sec) : Promise.resolve([])]);
  const alsoSecond = new Set(secEntries.map((e) => `${e.collection}/${e.slug}`));
  return [
    ...site.pages.flatMap((p) =>
      rows(base, p.slug, { lastModified: new Date(), changeFrequency: 'weekly' as const, priority: p.slug === '/' ? 1 : 0.7 }, true),
    ),
    ...listings.flatMap((l) =>
      rows(base, urlPath('listings', l.slug!), { lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 0.8 }, true),
    ),
    ...posts.flatMap((p) =>
      rows(
        base,
        urlPath('posts', p.slug),
        { lastModified: p.publishedAt ?? new Date(), changeFrequency: 'monthly' as const, priority: 0.5 },
        true,
      ),
    ),
    // every published entry of every content type that has detail pages. Without
    // this a job board's roles and a catalog of courses exist only behind a
    // client-side list — Google never sees a single one of them.
    ...entries.flatMap((e) =>
      rows(
        base,
        urlPath(e.collection, e.slug),
        { lastModified: e.updatedAt, changeFrequency: 'weekly' as const, priority: 0.6 },
        alsoSecond.has(`${e.collection}/${e.slug}`),
      ),
    ),
  ];
}
