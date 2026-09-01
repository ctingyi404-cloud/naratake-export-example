'use client';

/* Visitor-facing language state (en / zh / es).

   The language is decided by the ADDRESS, not by a click. `/zh/menu` is the
   Chinese menu for everyone who opens it — the server already knows which tree
   it is rendering, so the first paint is right, `<html lang>` is right, and the
   page can be shared with somebody who does not share your localStorage.

   The provider is handed that answer by its root layout and does not go looking
   for another one. The stored preference this used to read overrode the server
   render on mount, which is precisely how a document could serve `lang="en"`
   and then display Chinese. */

import { createContext, useContext, type ReactNode } from 'react';
import { PRIMARY_LOCALE, type SiteLocale } from '@/lib/locale-path';
import { secondaryLocaleOf } from '@/lib/locale-seo';

export type { SiteLocale };

interface SiteLang {
  lang: SiteLocale;
  /** pick a localized value (es/zh fall back to en) */
  pick: (en: string | null | undefined, zh?: string | null, es?: string | null) => string;
}

const Ctx = createContext<SiteLang>({
  lang: PRIMARY_LOCALE,
  pick: (en) => en ?? '',
});

export function SiteLangProvider({
  initial = PRIMARY_LOCALE,
  children,
}: {
  initial?: SiteLocale;
  children: ReactNode;
}) {
  const pick = (en: string | null | undefined, zh?: string | null, es?: string | null) =>
    (initial === 'es' ? es : initial === 'zh' ? zh : en) ?? en ?? '';
  return <Ctx.Provider value={{ lang: initial, pick }}>{children}</Ctx.Provider>;
}

export function useSiteLang(): SiteLang {
  return useContext(Ctx);
}

/** the site's configured secondary language, if any (drives the language toggle) */
export function secondaryLocale(): 'zh' | 'es' | null {
  return secondaryLocaleOf();
}
