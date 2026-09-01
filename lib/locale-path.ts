/* Where a page lives in each language.

   A site used to have one address and a button that swapped the words in
   place. That works for one person toggling back and forth and fails for
   everyone else: the second language has no URL, so it cannot be shared, it
   cannot be indexed, and the served HTML says `lang="en"` while the page reads
   Chinese. A merchant paid for a translation that search engines never saw.

   So the second language gets a prefix of its own — `/zh/menu` beside `/menu` —
   and this file is the ONE derivation of what that prefix does. Navigation,
   canonicals, hreflang, the sitemap and the language button all read from here,
   because the moment two of them disagree the pair stops being a pair.

   The prefix goes on the OUTSIDE. `urlPath()` still builds the address from the
   collection and the slug; this wraps the finished path. Route params therefore
   arrive at the server exactly as they always did, which is what keeps the slug
   redirect ledger comparing bare slugs against bare slugs. */

export type SiteLocale = 'en' | 'zh' | 'es';

/** The language the unprefixed tree speaks. */
export const PRIMARY_LOCALE: SiteLocale = 'en';

/** `<html lang>` per locale — a screen reader pronounces the page from this. */
export const HTML_LANG: Record<SiteLocale, string> = { en: 'en', zh: 'zh-TW', es: 'es' };
/** og:locale per locale (underscored, as Open Graph specifies). */
export const OG_LOCALE: Record<SiteLocale, string> = { en: 'en_US', zh: 'zh_TW', es: 'es_ES' };
/** the BCP-47 tag a `hreflang` carries */
export const HREF_LANG: Record<SiteLocale, string> = { en: 'en-US', zh: 'zh-TW', es: 'es-ES' };

/* Both possible prefixes, not just the one this site uses.

   stripLocale has to be pure — the parity harness and the client bundle both
   call it — and a merchant page can only collide with this by being named
   exactly `/zh` or `/es`. `/espresso` is safe: the test requires the segment
   boundary. */
const PREFIXES: readonly SiteLocale[] = ['zh', 'es'];

/** Split a site path into the language it declares and the address underneath. */
export function stripLocale(path: string): { locale: SiteLocale; path: string } {
  for (const p of PREFIXES) {
    if (path === `/${p}`) return { locale: p, path: '/' };
    if (path.startsWith(`/${p}/`)) return { locale: p, path: path.slice(p.length + 1) };
  }
  return { locale: PRIMARY_LOCALE, path: path || '/' };
}

/** The same page, addressed in `locale`.

    Idempotent, and that is load-bearing: a component cannot always tell whether
    the href it was handed is already prefixed (codegen bakes some, the runtime
    builds others from live data), so every internal link may pass through here
    and none of them can come out `/zh/zh/menu`.

    Anything that is not a site path — an anchor, `tel:`, `mailto:`, an absolute
    URL, a bare query string — is handed back untouched. */
export function localePath(locale: SiteLocale, path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return path ?? '';
  const bare = stripLocale(path).path;
  if (locale === PRIMARY_LOCALE) return bare;
  return bare === '/' ? `/${locale}` : `/${locale}${bare}`;
}
