import type { Metadata } from 'next';
import '../globals.css';
import { fontsAttachScript, fontsHref } from '@/lib/fonts';
import { getSiteUrl } from '@/lib/site-url';

/* The back office's document.

   It is a root layout of its own because the storefront now has one per
   language, and a tree without one has no <html> to render into. What it is
   NOT is the storefront's shell: no cart, no smooth scroll, no consent notice,
   no LocalBusiness JSON-LD — an operator's console is not a page a crawler
   reads. The webfonts stay so the panels look exactly as they did when this
   was one shared root. */

/* Keep this root's URL resolution explicit for any present or future relative
   metadata. The admin tree is private product UI, so also keep it out of search
   results independently of the storefront's robots policy. */
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preload" as="style" href={fontsHref} />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link rel="stylesheet" href={fontsHref} />
        </noscript>
        <script dangerouslySetInnerHTML={{ __html: fontsAttachScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
