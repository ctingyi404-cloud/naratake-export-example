/* The document every visitor page is served inside.

   There is one of these per language tree, because `<html lang>` lives on the
   root layout and a root layout cannot vary by request without making the whole
   site dynamic. Next allows more than one root layout — one per top-level
   branch — so `/` and `/zh` each get their own, and each declares its language
   in the HTML a crawler and a screen reader actually read.

   Everything else about the document is identical, so it is written once here
   rather than copied into each tree. A second copy is a second thing to forget
   to change. */

import type { Metadata } from 'next';
import { jsonLdScript } from '@/lib/jsonld';
import { site } from '@/lib/site-config';
import { getSiteUrl } from '@/lib/site-url';
import { SiteLangProvider } from '@/lib/site-i18n';
import { HTML_LANG, localePath, OG_LOCALE, type SiteLocale } from '@/lib/locale-path';
import { altLanguages } from '@/lib/locale-seo';
import { MotionProvider } from '@/lib/motion';
import { SmoothScroll } from '@/lib/smooth-scroll';
import { RtCartProvider } from '@/components/runtime/ordering';
import { analyticsScripts, customHeadHtml, hasAnalytics } from '@/lib/track';
import { ConsentNotice } from '@/components/runtime/ConsentNotice';
import { HeadInjector } from '@/components/HeadInjector';
import { ConciergeBubble } from '@/components/runtime/concierge';
import { fontsAttachScript, fontsHref } from '@/lib/fonts';

// one shared, persistent cart for the whole site — only when ordering is on, so
// view-only menus stay view-only (no add-to-cart controls appear)
const ordersOn = site.enabledModules.includes('orders');

// deployed URL — shared with sitemap.ts + robots.ts so they never disagree
const siteUrl = getSiteUrl();
const b = site.business;
const description = `${b.name} · ${b.address.city}, ${b.address.state}. ${b.phone}`;

/** The metadata each language tree's root layout exports. */
export function siteMetadata(locale: SiteLocale): Metadata {
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: b.name,
      template: `%s · ${b.name}`,
    },
    description,
    /* The home page of THIS tree, and the pair it belongs to. Inner pages
       declare their own; this is the answer for `/` and the fallback for
       anything that never speaks up. */
    alternates: { canonical: localePath(locale, '/'), languages: altLanguages('/') },
    openGraph: { title: b.name, description, type: 'website', siteName: b.name, locale: OG_LOCALE[locale] },
    twitter: { card: 'summary_large_image', title: b.name, description },
  };
}

/* schema.org LocalBusiness — helps the site show up in Google local search /
   the map pack with correct name, address, phone, hours and social profiles. */
const DAY_URL: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  /* A brokerage told Google it was a LocalBusiness, which is true and useless:
     RealEstateAgent, LegalService and the rest are what the rich results are
     keyed to. Defaults to LocalBusiness so every existing site is unchanged. */
  '@type': (b as { schemaType?: string }).schemaType || 'LocalBusiness',
  name: b.name,
  telephone: b.phone,
  email: b.email,
  url: siteUrl,
  address: {
    '@type': 'PostalAddress',
    streetAddress: b.address.line1,
    addressLocality: b.address.city,
    addressRegion: b.address.state,
    postalCode: b.address.zip,
    addressCountry: 'US',
  },
  ...(() => {
    const sameAs = Object.values(b.socials ?? {}).filter(Boolean);
    return sameAs.length ? { sameAs } : {};
  })(),
  // one spec PER span so split lunch+dinner hours both publish — mapping only
  // spans[0] told Google a restaurant was closed all evening
  openingHoursSpecification: Object.entries(b.hours ?? {})
    .filter(([, spans]) => spans && spans.length)
    .flatMap(([day, spans]) =>
      spans!.map((span) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: DAY_URL[day] ?? day,
        opens: span[0],
        closes: span[1],
      })),
    ),
  // aggregate rating → the star snippet under the search result (big CTR lift)
  ...(site.seo && site.seo.ratingCount > 0
    ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: site.seo.ratingValue,
          reviewCount: site.seo.ratingCount,
        },
      }
    : {}),
};

export function SiteShell({ locale, children }: { locale: SiteLocale; children: React.ReactNode }) {
  return (
    <html lang={HTML_LANG[locale]}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Load the webfont without blocking first paint: preload the CSS, then
            attach it via a tiny inline script (bypasses React's stylesheet
            hoisting so `media` is honored). <noscript> covers JS-off clients. */}
        <link rel="preload" as="style" href={fontsHref} />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link rel="stylesheet" href={fontsHref} />
        </noscript>
        <script dangerouslySetInnerHTML={{ __html: fontsAttachScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(localBusinessJsonLd) }} />
        {/* opt-in marketing tags as real <script> children — never a <div> in <head> */}
        {analyticsScripts().map((s) =>
          s.src ? (
            <script key={s.id} async src={s.src} />
          ) : (
            <script key={s.id} dangerouslySetInnerHTML={{ __html: s.inline ?? '' }} />
          ),
        )}
      </head>
      <body>
        <HeadInjector html={customHeadHtml()} />
        {/* renders nothing unless the deployment has ANTHROPIC_API_KEY */}
        <ConciergeBubble />
        {/* opt-out cookie notice — only when a tag is actually configured */}
        {hasAnalytics() && <ConsentNotice />}
        <MotionProvider />
        <SmoothScroll />
        <SiteLangProvider initial={locale}>
          {ordersOn ? <RtCartProvider>{children}</RtCartProvider> : children}
        </SiteLangProvider>
      </body>
    </html>
  );
}
