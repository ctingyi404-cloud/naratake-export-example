/* The SEO identity of one page, in one language.

   Layered on top of locale-path: that file knows only where an address lives,
   which is why the components and the server modules can both use it without
   dragging site.config into a pure path calculation. This file is the half that
   knows which languages THIS site actually publishes, and it is the single
   answer to canonical, hreflang and og:locale — the moment those are filled in
   by three different hands they stop describing the same pair of pages. */

import type { Metadata } from 'next';
import { site } from '@/lib/site-config';
import { HREF_LANG, localePath, OG_LOCALE, PRIMARY_LOCALE, stripLocale, type SiteLocale } from '@/lib/locale-path';

/** The site's configured second language, or null for a single-language site. */
export function secondaryLocaleOf(): 'zh' | 'es' | null {
  return (site.secondaryLocale as 'zh' | 'es' | undefined) ?? (site.bilingual ? 'zh' : null);
}



/** The hreflang map for one address, or undefined when the site speaks once.

    `x-default` names the address to serve someone whose language we do not
    have — the primary tree, which is also the canonical one. Omitting it is
    what makes Google pick for itself. */
export function altLanguages(barePath: string): Record<string, string> | undefined {
  const sec = secondaryLocaleOf();
  if (!sec) return undefined;
  return {
    [HREF_LANG[PRIMARY_LOCALE]]: barePath,
    [HREF_LANG[sec]]: localePath(sec, barePath),
    'x-default': barePath,
  };
}

/** One page's metadata, wearing `locale`'s identity.

    Every route builds its metadata once, in the primary language, and hands it
    through here — so the canonical, the hreflang pair and og:locale can never
    be filled in by three different hands. A single-language site gets its
    object back unchanged, which is what keeps a monolingual export free of
    alternate links it has no alternates for. */
export function localizeMetadata(m: Metadata, locale: SiteLocale): Metadata {
  if (!secondaryLocaleOf()) return m;
  const canonical = m.alternates?.canonical;
  /* No canonical means the route deliberately declined one — a draft under a
     preview token, or a 404. A page that refuses to be indexed must not be
     handed a self-referencing address here. */
  if (typeof canonical !== 'string') return m;
  const bare = stripLocale(canonical).path;
  const og = m.openGraph as Record<string, unknown> | undefined;
  return {
    ...m,
    alternates: { ...m.alternates, canonical: localePath(locale, bare), languages: altLanguages(bare) },
    ...(og ? { openGraph: { ...og, locale: OG_LOCALE[locale] } as Metadata['openGraph'] } : {}),
  };
}
