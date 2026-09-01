'use client';

/* Countdown — the one Cinema v5 block that needs a heartbeat. Client island so
   it ticks live on the published site; the editor renders a static snapshot of
   the same layout via the def. Starts null to keep the first client paint equal
   to the server HTML (no hydration mismatch), then fills in on mount. */

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useSiteLang } from '@/lib/site-i18n';

type Sty = { className?: string; style?: CSSProperties };

function parts(target: string): { d: number; h: number; m: number; s: number; done: boolean } {
  const t = Date.parse(target);
  if (Number.isNaN(t)) return { d: 0, h: 0, m: 0, s: 0, done: true };
  let ms = t - Date.now();
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0, done: true };
  const d = Math.floor(ms / 86400000); ms -= d * 86400000;
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  return { d, h, m, s, done: false };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function RtCountdown({
  target,
  heading,
  headingZh,
  sub,
  subZh,
  expired,
  expiredZh,
  className,
  style,
}: Sty & {
  target: string; heading?: string; headingZh?: string; sub?: string; subZh?: string;
  expired?: string; expiredZh?: string;
}) {
  const { pick, lang } = useSiteLang();
  const [p, setP] = useState<ReturnType<typeof parts> | null>(null);

  useEffect(() => {
    const tick = () => setP(parts(target));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  // unit labels follow the visitor's language like every other string here
  const labels =
    lang === 'zh'
      ? ['天', '時', '分', '秒']
      : lang === 'es'
        ? ['Días', 'Horas', 'Min', 'Seg']
        : ['Days', 'Hours', 'Mins', 'Secs'];
  const cells: [string, string][] = [
    [labels[0], p ? pad2(p.d) : '--'],
    [labels[1], p ? pad2(p.h) : '--'],
    [labels[2], p ? pad2(p.m) : '--'],
    [labels[3], p ? pad2(p.s) : '--'],
  ];

  return (
    <div className={`rv ${className ?? ''}`} style={{ textAlign: 'center', ...style }}>
      {heading ? (
        <div className="font-heading" style={{ fontSize: 'clamp(1.6rem, 3.4vw, 2.4rem)', fontWeight: 700, letterSpacing: '-0.02em' }}>{pick(heading, headingZh)}</div>
      ) : null}
      {sub ? (
        <p style={{ margin: '10px auto 0', maxWidth: 520, fontSize: 14.5, lineHeight: 1.6, color: 'var(--c-text-muted)' }}>{pick(sub, subZh)}</p>
      ) : null}
      {p?.done ? (
        <div style={{ marginTop: 22, fontFamily: 'var(--font-heading)', fontSize: 'clamp(1.3rem, 3vw, 2rem)', fontWeight: 700, color: 'var(--c-primary)' }}>{pick(expired ?? '', expiredZh)}</div>
      ) : (
        <div className="cd-row" style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 24, flexWrap: 'wrap' }}>
          {cells.map(([label, v]) => (
            <div key={label} className="cd-cell" style={{ minWidth: 92, padding: '20px 14px', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 14 }}>
              <div className="font-heading cd-num" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'clamp(2rem, 5vw, 3.4rem)', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>
                <span key={v} className="cd-flip">{v}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
