'use client';

import { site } from '@/lib/site-config';

/* Last-resort error boundary. A Neon cold start or a transient API hiccup would
   otherwise show the visitor Next's raw "Application error" screen; this keeps
   the business's name on it and offers a retry + a phone number. Because it
   replaces the root layout, it must render its own <html>/<body>. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const b = site.business;
  const brand = site.brand ?? { primary: '#1f2937', primaryFg: '#ffffff', accent: '#6366f1', secondary: '#0b1220' };
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 18,
          padding: '64px 24px',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#faf9f7',
          color: '#1a1a1a',
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: '0.24em', textTransform: 'uppercase', color: brand.accent, fontWeight: 700 }}>
          {b.name}
        </div>
        <h1 style={{ fontSize: 'clamp(26px, 5vw, 44px)', margin: 0 }}>Something went wrong</h1>
        <p style={{ color: '#667', maxWidth: '46ch', lineHeight: 1.6, margin: 0 }}>
          We hit a temporary problem loading this page. Please try again in a moment.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
          <button
            onClick={() => reset()}
            style={{
              background: brand.primary,
              color: brand.primaryFg,
              padding: '12px 22px',
              borderRadius: 8,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              fontSize: 15,
            }}
          >
            Try again
          </button>
          {b.phone ? (
            <a
              href={`tel:${b.phone}`}
              style={{
                border: `1.5px solid ${brand.primary}`,
                color: '#1a1a1a',
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
      </body>
    </html>
  );
}
