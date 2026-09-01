'use client';

/* Analytics consent notice (opt-out model, US-market default): shown once per
   browser when any analytics tag is configured. "OK" records acceptance and
   never shows again; "Decline" sets ls-consent=denied — the head scripts carry
   a guard that reads it before running on every later paint, and for the
   current visit GA's official ga-disable flag plus a Pixel/GTM no-op cover the
   already-loaded libraries. Sites with no analytics IDs never render this. */

import { useEffect, useState } from 'react';
import { site } from '@/lib/site-config';
import { LocText } from './loc-text';

export function ConsentNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('ls-consent')) setShow(true);
  }, []);
  if (!show) return null;

  const decide = (granted: boolean) => {
    localStorage.setItem('ls-consent', granted ? 'granted' : 'denied');
    if (!granted) {
      const w = window as unknown as Record<string, unknown>;
      const ga4 = site.analytics?.ga4Id;
      if (ga4) w[`ga-disable-${ga4}`] = true; // official GA opt-out for the loaded library
      if (typeof w.fbq === 'function') w.fbq = () => undefined; // silence the Pixel queue
      if (Array.isArray(w.dataLayer)) (w.dataLayer as unknown[]).length = 0;
    }
    setShow(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 90,
        maxWidth: 560, margin: '0 auto', padding: '13px 18px',
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        background: 'var(--c-surface, #fff)', color: 'var(--c-text, #222)',
        border: '1px solid var(--c-border, #ddd)', borderRadius: 12,
        boxShadow: '0 8px 30px rgba(0,0,0,0.18)', fontSize: 13.5, lineHeight: 1.5,
      }}
    >
      <span style={{ flex: 1, minWidth: 220 }}>
        <LocText en="We use analytics to understand how visitors use this site." zh="本站使用分析工具了解訪客如何使用網站。" />
      </span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => decide(false)}
          style={{ background: 'none', border: '1px solid var(--c-border, #ccc)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
        >
          <LocText en="Decline" zh="拒絕" />
        </button>
        <button
          onClick={() => decide(true)}
          style={{ background: 'var(--c-primary, #222)', color: 'var(--c-primary-fg, #fff)', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', font: 'inherit' }}
        >
          OK
        </button>
      </span>
    </div>
  );
}
