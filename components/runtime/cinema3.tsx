/* Cinema v7 — "Photo Cinema" (export runtime).
   Server components mirroring the editor defs 1:1 — same class names, same
   layout. Colors via var(--c-*) (theme.css), fonts via var(--font-*). Motion is
   class-only (rv / rv-stagger) so everything degrades to fully visible without
   JS and under reduced-motion. Responsive sizing that the def does via ctx.bp
   lives in cinema.css media queries (.cin-fstrip-frame / .cin-comic-*). */

import type { CSSProperties } from 'react';
import { LocText, PlainLocText } from './loc-text';

type Sty = { className?: string; style?: CSSProperties };
type Frame = { src?: string; caption?: string; captionZh?: string };

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const FILM_BG = '#0c0b09';
const FILM_INK = '#f2ede1';

/* ── FilmStrip ──────────────────────────────────────────── */
export function RtFilmStrip({
  title,
  titleZh,
  frames = [],
  className,
  style,
}: Sty & { title?: string; titleZh?: string; frames?: Frame[] }) {
  const sprocket = (
    <div
      aria-hidden
      style={{
        height: 12,
        margin: '0 24px',
        borderRadius: 3,
        backgroundImage: 'repeating-linear-gradient(90deg, rgba(244,241,234,0.22) 0 14px, transparent 14px 30px)',
      }}
    />
  );
  return (
    <div className={`cin-fstrip rv ${className ?? ''}`} style={{ background: FILM_BG, color: FILM_INK, borderRadius: 16, overflow: 'hidden', padding: '16px 0 18px', ...style }}>
      {title ? (
        <div style={{ padding: '2px 24px 12px', fontFamily: MONO, fontSize: 11.5, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--c-accent)' }}>
          <LocText en={title} zh={titleZh} />
        </div>
      ) : null}
      {sprocket}
      <div className="rv-stagger cin-fstrip-row" style={{ display: 'flex', gap: 14, padding: '12px 24px', overflowX: 'auto' }}>
        {frames.map((fr, i) => (
          <figure key={i} className="cin-fstrip-frame" style={{ flex: '0 0 auto', margin: 0 }}>
            {/* .cin-fstrip-frame is 258px wide and its img 186px tall in
                app/cinema.css, so the frame is settled before the photo arrives.
                Inline dimensions would beat the 620px mobile override and trade
                a shift that cannot happen for one that would: cls-ok */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fr.src || ''}
              alt={fr.caption ?? ''}
              loading="lazy"
              className="ls-photo"
              style={{ display: 'block', width: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(244,241,234,0.16)' }}
            />
            <figcaption style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(242,237,225,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {`FR.${String(i + 1).padStart(2, '0')}`}
              {fr.caption ? (
                <>
                  {' · '}
                  <LocText en={fr.caption} zh={fr.captionZh} />
                </>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
      {sprocket}
    </div>
  );
}

/* ── ComicPanels ────────────────────────────────────────── */
export function RtComicPanels({
  burst,
  burstZh,
  panels = [],
  className,
  style,
}: Sty & { burst?: string; burstZh?: string; panels?: Frame[] }) {
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: 16,
          backgroundImage: 'radial-gradient(circle, var(--c-text-muted) 1px, transparent 1.6px)',
          backgroundSize: '13px 13px',
          opacity: 0.28,
        }}
      />
      {burst ? (
        <div
          className="cin-comic-burst"
          style={{
            position: 'absolute',
            top: -16,
            right: 10,
            zIndex: 2,
            transform: 'rotate(6deg)',
            background: 'var(--c-primary)',
            color: 'var(--c-primary-fg)',
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: '0.02em',
            padding: '12px 30px',
            fontFamily: 'var(--font-heading)',
            clipPath: 'polygon(50% 0%, 61% 12%, 78% 5%, 80% 22%, 98% 26%, 92% 40%, 100% 50%, 92% 60%, 98% 74%, 80% 78%, 78% 95%, 61% 88%, 50% 100%, 39% 88%, 22% 95%, 20% 78%, 2% 74%, 8% 60%, 0% 50%, 8% 40%, 2% 26%, 20% 22%, 22% 5%, 39% 12%)',
          }}
        >
          <LocText en={burst} zh={burstZh} />
        </div>
      ) : null}
      <div className="cin-comic-grid rv-stagger" style={{ position: 'relative', display: 'grid', gap: 16 }}>
        {panels.map((p, i) => (
          <figure
            key={i}
            className="cin-comic-panel"
            style={{
              margin: 0,
              border: '3px solid var(--c-text)',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--c-surface)',
              boxShadow: '6px 6px 0 rgba(0,0,0,0.14)',
            }}
          >
            {/* app/cinema.css fixes every panel img at 200px — 270px for the
                establishing shot, 170px on phones — so the grid is laid out
                before any photo loads: cls-ok */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src || ''} alt={p.caption ?? ''} loading="lazy" className="ls-photo" style={{ display: 'block', width: '100%', objectFit: 'cover' }} />
            {p.caption ? (
              <figcaption style={{ background: 'var(--c-bg)', borderTop: '3px solid var(--c-text)', padding: '10px 14px', fontWeight: 700, fontSize: 14.5, lineHeight: 1.35, fontFamily: 'var(--font-heading)' }}>
                <LocText en={p.caption} zh={p.captionZh} />
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </div>
  );
}

/* ── Collage — a zine scrapbook of tilted polaroids ─────── */
const COLLAGE_ROT = [-4, 2.5, -2, 3.5, -1.5];

export function RtCollage({
  arrow = true,
  photos = [],
  className,
  style,
}: Sty & { arrow?: boolean; photos?: Frame[] }) {
  return (
    <div className={`cin-collage rv-stagger ${className ?? ''}`} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', padding: '18px 0 10px', ...style }}>
      {photos.map((p, i) => (
        <figure
          key={i}
          className="cin-collage-card"
          style={{
            margin: 0,
            background: '#ffffff',
            padding: '10px 10px 30px',
            boxShadow: '0 14px 34px rgba(15,15,20,0.18)',
            transform: `rotate(${COLLAGE_ROT[i % COLLAGE_ROT.length]}deg)`,
          }}
        >
          {/* .cin-collage-card is 250px wide and its img 184px tall in
              app/cinema.css — the polaroid holds its shape empty: cls-ok */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src || ''} alt={p.caption ?? ''} loading="lazy" className="ls-photo" style={{ display: 'block', width: '100%', objectFit: 'cover' }} />
          {p.caption ? (
            <figcaption style={{ marginTop: 10, textAlign: 'center', fontSize: 12.5, color: '#41403c' }}>
              <LocText en={p.caption} zh={p.captionZh} />
            </figcaption>
          ) : null}
        </figure>
      ))}
      {arrow ? (
        <svg aria-hidden viewBox="0 0 120 60" style={{ position: 'absolute', top: -20, right: 4, width: 92, transform: 'rotate(9deg)', overflow: 'visible' }}>
          <path d="M6 52 C 32 12, 72 6, 96 24" fill="none" stroke="var(--c-accent)" strokeWidth="4" strokeLinecap="round" />
          <path d="M96 24 L 80 22 M96 24 L 90 38" fill="none" stroke="var(--c-accent)" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}

/* ── RoundBadge — a circular rotating-text sticker ──────── */
export function RtRoundBadge({
  text = '',
  textZh,
  center = '✦',
  centerZh,
  size = 110,
  className,
  style,
}: Sty & { text?: string; textZh?: string; center?: string; centerZh?: string; size?: number }) {
  const rid = `rb-${text.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'x'}`;
  return (
    <div className={`cin-rbadge ${className ?? ''}`} style={{ width: size, height: size, ...style }} aria-hidden>
      <svg viewBox="0 0 100 100" style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}>
        <defs>
          <path id={rid} d="M 50 12 a 38 38 0 1 1 -0.01 0" fill="none" />
        </defs>
        <circle cx="50" cy="50" r="49" fill="var(--c-surface)" stroke="var(--c-primary)" strokeWidth="1.6" />
        <text style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', fill: 'var(--c-primary)' }}>
          <textPath href={`#${rid}`} textLength="236" lengthAdjust="spacingAndGlyphs">
            {/* SVG text may not contain HTML spans — PlainLocText picks the
                string without LocText's cjkNoWrap wrappers */}
            <PlainLocText en={`${text} · ${text} · ${text} · `} zh={textZh ? `${textZh} · ${textZh} · ${textZh} · ` : undefined} />
          </textPath>
        </text>
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 26, fill: 'var(--c-primary)' }}>
          {/* SVG text: no HTML spans allowed — PlainLocText, like the ring above */}
          <PlainLocText en={center} zh={centerZh} />
        </text>
      </svg>
    </div>
  );
}
