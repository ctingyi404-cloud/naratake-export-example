/* The webfont stylesheet this site asks Google for.

   Read by every root layout — the storefront's two language trees and the back
   office — so a change to how the family list is built cannot reach one
   document and miss another. */

import { site } from '@/lib/site-config';

// weight-accurate query is precomputed by the studio (per-family real weights);
// legacy configs fall back to the old fixed-weight pattern
const googleFamilies =
  (site as { fontsQuery?: string }).fontsQuery ??
  [site.fonts.heading, site.fonts.body]
    .map((f) => `family=${encodeURIComponent(f).replaceAll('%20', '+')}:wght@400;500;600;700;800`)
    .join('&');

export const fontsHref = `https://fonts.googleapis.com/css2?${googleFamilies}&display=swap`;

/** The non-blocking loader: preload the CSS, attach it from a tiny inline
    script (React hoists a plain <link rel=stylesheet>, which would ignore the
    `media` trick), and a <noscript> copy for JS-off clients. */
export const fontsAttachScript = `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href=${JSON.stringify(
  fontsHref,
)};l.media='print';l.onload=function(){l.media='all'};document.head.appendChild(l);})();`;
