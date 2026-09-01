/* Marketing analytics: inject GA4 / Meta Pixel / GTM tags into <head>, and fire
   standard conversion events from the storefront. The whole point is that a
   merchant who configures a GA4 ID in Naratake can see purchases and leads
   land in their dashboard — without any of this being present, the ad spend they
   pour into the site is completely unmeasured. Every tag is opt-in: nothing is
   emitted unless an ID is configured. */

import { site } from '@/lib/site-config';
import { inlineScriptString } from '@/lib/inline-script';

const a = site.analytics ?? {};

/** Head markup for GA4 + Meta Pixel + GTM + a Search-Console verification blob.
    Returned as a string so layout.tsx can drop it via dangerouslySetInnerHTML —
    Next's <Script> and next/third-parties aren't used to keep the export
    dependency-free and framework-version-stable. */
/** One head tag as structured data so layout.tsx can render it as a REAL React
    element (a bare `<script>`/`<script src>` — never a `<div>` in `<head>`, which
    the parser re-parents into `<body>` and breaks hydration on every page). */
export interface AnalyticsScript {
  id: string;
  /** external src (async) — mutually exclusive with `inline` */
  src?: string;
  /** inline JS body */
  inline?: string;
}

/** Inline scripts run only while consent is not declined (opt-out model — the
    US-market default: track by default, honor an explicit decline. The banner
    below writes the flag; GA's official ga-disable flag covers the already-
    loaded library on the same visit). */
const GUARD = "if(typeof localStorage!=='undefined'&&localStorage.getItem('ls-consent')==='denied')return;";
const guarded = (js: string) => `(function(){${GUARD}${js}})();`;

/** GA4 / Meta Pixel / GTM as structured script tags (no wrapper element). */
export function analyticsScripts(): AnalyticsScript[] {
  const out: AnalyticsScript[] = [];
  if (a.gtmId) {
    out.push({ id: 'gtm', inline: guarded(`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${inlineScriptString(a.gtmId)});`) });
  }
  if (a.ga4Id) {
    out.push({ id: 'ga4-src', src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(a.ga4Id)}` });
    out.push({ id: 'ga4', inline: guarded(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${inlineScriptString(a.ga4Id)});`) });
  }
  if (a.metaPixelId) {
    out.push({ id: 'meta-pixel', inline: guarded(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${inlineScriptString(a.metaPixelId)});fbq('track','PageView');`) });
  }
  return out;
}

/** Arbitrary operator-pasted head HTML (e.g. a Search Console verification meta).
    Injected client-side into <head> so it never corrupts the SSR head tree. */
export function customHeadHtml(): string | undefined {
  return a.customHeadHtml || undefined;
}

/** True when at least one analytics tag is active — lets callers skip the
    injection point entirely. */
export function hasAnalytics(): boolean {
  return !!(a.gtmId || a.ga4Id || a.metaPixelId || a.customHeadHtml);
}

type W = typeof window & {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
};

/** Fire a conversion to every configured platform at once. Safe no-op on the
    server and when nothing is configured. `value` is in the store's currency
    (major units, e.g. dollars). Standard GA4 + Meta event names are mapped so a
    merchant's dashboards light up without any per-platform setup. */
export function trackConversion(
  kind: 'purchase' | 'schedule' | 'lead',
  params: { value?: number; currency?: string; items?: { name: string; quantity?: number }[]; label?: string } = {},
): void {
  if (typeof window === 'undefined') return;
  const w = window as W;
  const currency = params.currency ?? 'USD';

  const ga4Name = kind === 'purchase' ? 'purchase' : kind === 'schedule' ? 'schedule' : 'generate_lead';
  const metaName = kind === 'purchase' ? 'Purchase' : kind === 'schedule' ? 'Schedule' : 'Lead';

  // GA4 (also feeds GTM via dataLayer)
  if (w.gtag) {
    w.gtag('event', ga4Name, {
      value: params.value,
      currency,
      items: params.items?.map((it) => ({ item_name: it.name, quantity: it.quantity ?? 1 })),
    });
  }
  if (w.dataLayer) {
    w.dataLayer.push({ event: ga4Name, value: params.value, currency });
  }
  // Meta Pixel
  if (w.fbq) {
    w.fbq('track', metaName, { value: params.value, currency });
  }
}
