import { ImageResponse } from 'next/og';
import { site } from '@/lib/site-config';

/* Shared renderer for each language tree's file-based Open Graph route. The
   route files stay beside their root layouts so Next resolves them after that
   layout's metadataBase; keeping the artwork here avoids two drifting copies. */
export function SiteOpengraphImage() {
  const b = site.business;
  const brand = site.brand ?? { primary: '#1f2937', primaryFg: '#ffffff', accent: '#6366f1', secondary: '#0b1220' };
  const initial = (b.name.trim()[0] ?? 'L').toUpperCase();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 84,
          background: `linear-gradient(135deg, ${brand.secondary}, ${brand.primary})`,
          color: brand.primaryFg,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 54,
            fontWeight: 800,
            background: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})`,
            color: brand.primaryFg,
          }}
        >
          {initial}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.05 }}>{b.name}</div>
          <div style={{ fontSize: 36, opacity: 0.85 }}>{`${b.address.city}, ${b.address.state} · ${b.phone}`}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
