/* Cinema v5 — "Signature Sequences" (export runtime).
   Server components whose markup mirrors the editor defs 1:1 (same class names,
   same inline styles) so preview == export. Motion is class-only: `rv`,
   `rv-stagger`, `rv-left`, `rv-right` are picked up by the shared ls-motion
   runtime and degrade to fully-visible without JS / under reduced-motion.
   Countdown is a separate client island (./countdown). */

import type { CSSProperties } from 'react';
import { LocText, PlainLocText } from './loc-text';

type Sty = { className?: string; style?: CSSProperties };

function creditRows(entries: string): [string, string][] {
  return String(entries ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('|');
      return (i >= 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ['', l]) as [string, string];
    });
}

const RULE = 'color-mix(in srgb, var(--c-text) 16%, transparent)';

/* ── TitleCard ──────────────────────────────────────────── */
export function RtTitleCard({
  eyebrow,
  eyebrowZh,
  title,
  titleZh,
  meta,
  metaZh,
  align = 'center',
  className,
  style,
}: Sty & {
  eyebrow?: string; eyebrowZh?: string; title: string; titleZh?: string;
  meta?: string; metaZh?: string; align?: 'center' | 'left';
}) {
  const center = align !== 'left';
  const rule = <span aria-hidden style={{ display: 'block', width: 54, height: 1, background: RULE, margin: center ? '0 auto' : '0' }} />;
  return (
    <div className={`rv-stagger ${className ?? ''}`} style={{ textAlign: center ? 'center' : 'left', maxWidth: center ? 860 : undefined, margin: center ? '0 auto' : undefined, ...style }}>
      {rule}
      {eyebrow ? (
        <div style={{ marginTop: 22, fontSize: 12.5, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--c-accent)' }}>
          <LocText en={eyebrow} zh={eyebrowZh} />
        </div>
      ) : null}
      <h2 className="font-heading" style={{ margin: '18px 0 0', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.02, textWrap: 'balance', fontSize: 'clamp(2.4rem, 7vw, 6rem)' }}>
        <LocText en={title} zh={titleZh} />
      </h2>
      {meta ? (
        <div style={{ marginTop: 22, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          <LocText en={meta} zh={metaZh} />
        </div>
      ) : null}
      <div style={{ marginTop: 22 }}>{rule}</div>
    </div>
  );
}

/* ── PullQuote ──────────────────────────────────────────── */
export function RtPullQuote({
  quote,
  quoteZh,
  author,
  authorZh,
  role,
  roleZh,
  className,
  style,
}: Sty & { quote: string; quoteZh?: string; author?: string; authorZh?: string; role?: string; roleZh?: string }) {
  return (
    <figure className={`rv ${className ?? ''}`} style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center', ...style }}>
      <div aria-hidden className="pq-mark" style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(3.4rem, 8vw, 6rem)', lineHeight: 0.7, fontWeight: 800, color: 'var(--c-primary)', opacity: 0.26 }}>&#8220;</div>
      <blockquote style={{ margin: '6px 0 0', fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 'clamp(1.5rem, 3.4vw, 2.5rem)', lineHeight: 1.32, letterSpacing: '-0.01em', textWrap: 'balance' }}>
        <LocText en={quote} zh={quoteZh} />
      </blockquote>
      {(author || role) ? (
        <figcaption style={{ marginTop: 24, fontSize: 14, letterSpacing: '0.04em' }}>
          {author ? <span style={{ fontWeight: 700 }}><PlainLocText en={author} zh={authorZh} /></span> : null}
          {role ? (
            <span style={{ color: 'var(--c-text-muted)' }}>
              {author ? '  ·  ' : ''}
              <LocText en={role} zh={roleZh} />
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ── Diptych ────────────────────────────────────────────── */
export function RtDiptych({
  leftEyebrow, leftEyebrowZh, leftTitle, leftTitleZh, leftText, leftTextZh,
  rightEyebrow, rightEyebrowZh, rightTitle, rightTitleZh, rightText, rightTextZh,
  className, style,
}: Sty & {
  leftEyebrow?: string; leftEyebrowZh?: string; leftTitle: string; leftTitleZh?: string; leftText: string; leftTextZh?: string;
  rightEyebrow?: string; rightEyebrowZh?: string; rightTitle: string; rightTitleZh?: string; rightText: string; rightTextZh?: string;
}) {
  const panel = (
    filled: boolean, eyebrow: string | undefined, eyebrowZh: string | undefined,
    title: string, titleZh: string | undefined, text: string, textZh: string | undefined, reveal: string,
  ) => (
    <div
      className={`${reveal} dpx-panel${filled ? ' dpx-fill' : ''}`}
      style={{
        padding: 'clamp(30px, 4vw, 56px)',
        background: filled ? 'var(--c-primary)' : 'var(--c-surface)',
        color: filled ? 'var(--c-primary-fg)' : 'var(--c-text)',
        borderLeft: !filled ? '1px solid var(--c-border)' : undefined,
      }}
    >
      {eyebrow ? (
        <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: filled ? 0.8 : 1, color: filled ? undefined : 'var(--c-accent)' }}><PlainLocText en={eyebrow} zh={eyebrowZh} /></div>
      ) : null}
      <div className="font-heading" style={{ marginTop: 12, fontSize: 'clamp(1.4rem, 2.6vw, 2rem)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.12 }}>
        <LocText en={title} zh={titleZh} />
      </div>
      <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.62, opacity: filled ? 0.86 : 1, color: filled ? undefined : 'var(--c-text-muted)' }}>
        <LocText en={text} zh={textZh} />
      </p>
    </div>
  );
  return (
    <div className={`dpx ${className ?? ''}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', borderRadius: 16, ...style }}>
      {panel(true, leftEyebrow, leftEyebrowZh, leftTitle, leftTitleZh, leftText, leftTextZh, 'rv rv-left')}
      {panel(false, rightEyebrow, rightEyebrowZh, rightTitle, rightTitleZh, rightText, rightTextZh, 'rv rv-right')}
    </div>
  );
}

/* ── CreditsRoll ────────────────────────────────────────── */
export function RtCreditsRoll({
  heading,
  headingZh,
  entries,
  entriesZh,
  className,
  style,
}: Sty & { heading?: string; headingZh?: string; entries: string; entriesZh?: string }) {
  /* twin of creditRows in defs/cinema2.tsx: the EN list decides the row count,
     the zh list is matched BY INDEX — a half-done translation never changes how
     many credits a reader sees. */
  const rows = creditRows(entries);
  const rowsZh = creditRows(entriesZh ?? '');
  return (
    <div className={className} style={{ maxWidth: 620, margin: '0 auto', ...style }}>
      {heading ? (
        <div style={{ textAlign: 'center', fontSize: 12.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--c-accent)', marginBottom: 8 }}>
          <LocText en={heading} zh={headingZh} />
        </div>
      ) : null}
      <div className="rv-stagger" style={{ display: 'grid' }}>
        {rows.map(([role, name], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', alignItems: 'baseline', gap: 20, padding: '15px 0', borderTop: `1px solid ${RULE}` }}>
            <span style={{ textAlign: 'right', fontSize: 12.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}><PlainLocText en={role} zh={rowsZh[i]?.[0]} /></span>
            <span className="font-heading" style={{ fontSize: 'clamp(1.05rem, 2vw, 1.4rem)', fontWeight: 600, letterSpacing: '-0.01em' }}><PlainLocText en={name} zh={rowsZh[i]?.[1]} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Spotlight ──────────────────────────────────────────── */
export function RtSpotlight({
  eyebrow,
  eyebrowZh,
  statement,
  statementZh,
  sub,
  subZh,
  className,
  style,
}: Sty & { eyebrow?: string; eyebrowZh?: string; statement: string; statementZh?: string; sub?: string; subZh?: string }) {
  return (
    <div
      className={className}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--c-secondary)', color: '#f4f1ea', textAlign: 'center', padding: 'clamp(72px, 12vw, 150px) 24px', borderRadius: 16, ...style }}
    >
      <div aria-hidden className="sp-glow" style={{ position: 'absolute', inset: 0, opacity: 0.42, background: 'radial-gradient(circle at 50% 40%, var(--c-accent), transparent 62%)' }} />
      <div className="rv" style={{ position: 'relative', maxWidth: 760, margin: '0 auto' }}>
        {eyebrow ? (
          <div style={{ fontSize: 12.5, letterSpacing: '0.26em', textTransform: 'uppercase', color: 'var(--c-accent)' }}>
            <LocText en={eyebrow} zh={eyebrowZh} />
          </div>
        ) : null}
        <h2 className="font-heading" style={{ margin: '18px 0 0', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.08, textWrap: 'balance', fontSize: 'clamp(2rem, 5.2vw, 4rem)' }}>
          <LocText en={statement} zh={statementZh} />
        </h2>
        {sub ? (
          <p style={{ margin: '18px auto 0', maxWidth: 520, fontSize: 15.5, lineHeight: 1.7, color: 'rgba(244,241,234,0.66)' }}>
            <LocText en={sub} zh={subZh} />
          </p>
        ) : null}
      </div>
    </div>
  );
}
