/* Public signup capture page — /join. Made for table tents and QR codes:
   one tap puts a customer on the merchant's marketing list. */

import type { Metadata } from 'next';
import { site } from '@/lib/site-config';
import { PRIMARY_LOCALE } from '@/lib/locale-path';
import { localizeMetadata } from '@/lib/locale-seo';
import { RtNewsletterSignup } from '@/components/runtime/forms';
import { SiteBottomChrome, SiteTopChrome } from '@/components/site-chrome';

export const metadata: Metadata = localizeMetadata(
  {
    title: 'Join the list',
    description: `Offers and news from ${site.business.name}, straight to your inbox.`,
    alternates: { canonical: '/join' },
  },
  PRIMARY_LOCALE,
);

export default function JoinPage() {
  return (
    <>
      <SiteTopChrome />
      <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 20px',
        background: 'var(--c-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <p
          className="font-heading"
          style={{
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--c-text-muted)',
            margin: '0 0 14px',
          }}
        >
          {site.business.name}
        </p>
        <RtNewsletterSignup heading="Join the list" sub="Offers and news, straight to your inbox." buttonLabel="Join" />
        <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13.5 }}>
          <a href="/" style={{ color: 'var(--c-text-muted)', textDecoration: 'none', fontWeight: 600 }}>
            ← {site.business.name}
          </a>
        </p>
      </div>
    </main>
      <SiteBottomChrome />
    </>
  );
}
