import Link from 'next/link';
import './globals.css';
import { site } from '@/lib/site-config';
import { fontsHref } from '@/lib/fonts';

/* Branded 404 — a stray URL should still look like the business's site (with a
   way back and the phone number), not Next's stark default page.

   It imports the stylesheet itself because an address that matches no tree has
   no root layout to inherit one from: each language tree owns its own root, and
   Next renders this one inside a bare document. Without the import the 404 was
   the only unstyled page on the site. */
export default function NotFound() {
  const b = site.business;
  const brand = site.brand ?? { primary: '#1f2937', primaryFg: '#ffffff', accent: '#6366f1', secondary: '#0b1220' };
  return (
    <>
      {/* An address matching no language tree has no layout to have loaded the
          webfont for it, and React hoists a stylesheet carrying a precedence
          into <head>. Without this the branded 404 was the one page on the site
          set in somebody else's typeface. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={fontsHref} precedence="default" />
    <main
      style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 18,
        padding: '64px 24px',
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: '0.24em', textTransform: 'uppercase', color: brand.accent, fontWeight: 700 }}>
        {b.name}
      </div>
      <h1 style={{ fontFamily: 'var(--font-heading, inherit)', fontSize: 'clamp(28px, 6vw, 52px)', margin: 0 }}>
        Page not found
      </h1>
      <p style={{ color: 'var(--c-text-muted, #667)', maxWidth: '46ch', lineHeight: 1.6, margin: 0 }}>
        The page you were looking for isn&apos;t here. It may have moved, or the link may be out of date.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
        <Link
          href="/"
          style={{
            background: brand.primary,
            color: brand.primaryFg,
            padding: '12px 22px',
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Back to home
        </Link>
        {b.phone ? (
          <a
            href={`tel:${b.phone}`}
            style={{
              border: `1.5px solid ${brand.primary}`,
              color: 'var(--c-text, inherit)',
              padding: '12px 22px',
              borderRadius: 8,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Call {b.phone}
          </a>
        ) : null}
      </div>
    </main>
    </>
  );
}
