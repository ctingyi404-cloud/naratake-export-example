/* Cinema wave — premium scroll-driven components (ls-motion v2).
   All motion is authored as data-attributes + CSS var(--p) consumption so the
   runtime stays zero-dependency and the editor preview mirrors it 1:1. */

import type { CSSProperties, ReactNode } from 'react';
import { LocText, PlainLocText, SplitLocText } from './loc-text';
import { ctaZh } from '@/lib/cta-i18n';

type Sty = { className?: string; style?: CSSProperties };
const cssVars = (v: Record<string, string | number>) => v as CSSProperties;

/* ── KineticHeading — split-text display headline ─────────── */

const KH_WEIGHT: Record<string, { weight: number; tracking: string }> = {
  regular: { weight: 460, tracking: '-0.005em' },
  medium: { weight: 560, tracking: '-0.008em' },
  semibold: { weight: 660, tracking: '-0.013em' },
  heavy: { weight: 800, tracking: '-0.02em' },
};

export function RtKineticHeading({
  text,
  textZh,
  size = 'display',
  splitBy = 'chars',
  align = 'left',
  weight = 'heavy',
  animate = true,
  level = 'h2',
  className,
  style,
}: Sty & {
  text: string;
  textZh?: string | null;
  size?: 'xl' | 'display' | 'mega';
  splitBy?: 'chars' | 'words';
  align?: 'left' | 'center';
  weight?: 'regular' | 'medium' | 'semibold' | 'heavy';
  animate?: boolean;
  level?: string;
}) {
  // codegen passes level='h1' to the FIRST heading on a page (the hero) and 'h2'
  // to the rest, so each page has exactly one top-of-outline <h1>
  const Tag = (['h1', 'h2', 'h3'].includes(level) ? level : 'h2') as 'h2';
  const fs = size === 'mega' ? 'clamp(3rem, 9vw, 7.5rem)' : size === 'display' ? 'clamp(2.4rem, 6.5vw, 5rem)' : 'clamp(2rem, 4.5vw, 3.4rem)';
  const w = KH_WEIGHT[weight] ?? KH_WEIGHT.heavy;
  // React pre-splits the units (SplitLocText), so the cascade animates in EVERY
  // language — the old DOM-mutation split had to skip bilingual headings.
  return (
    <Tag
      className={`font-heading cin-kh ${animate ? 'rv-split' : ''} ${className ?? ''}`}
      style={{
        fontSize: fs,
        lineHeight: 1.04,
        fontWeight: w.weight,
        letterSpacing: w.tracking,
        margin: 0,
        textAlign: align,
        textWrap: 'balance',
        ...style,
      }}
    >
      {animate ? <SplitLocText en={text} zh={textZh} by={splitBy} /> : <LocText en={text} zh={textZh} />}
    </Tag>
  );
}

/* ── TextMarquee — display-size kinetic type band ─────────── */

export function RtTextMarquee({
  text,
  textZh,
  speed = 26,
  outline = true,
  dual = false,
  className,
  style,
}: Sty & { text: string; textZh?: string | null; speed?: number; outline?: boolean; dual?: boolean }) {
  /* the track is a JS-built repeat, not a text node — so BOTH languages are
     assembled here and PlainLocText picks one (no cjkNoWrap spans: the track is
     already white-space:nowrap, and spans would fork the markup from the canvas) */
  const band = (t: string) => `${t} · `.repeat(4);
  const row = (rev: boolean, solid: boolean) => (
    <div
      className={`font-heading mo-marquee-track${rev ? ' mo-marquee-rev' : ''}`}
      style={{
        fontSize: 'clamp(1.5rem, 5vw, 3.3rem)',
        fontWeight: 800,
        letterSpacing: '-0.01em',
        lineHeight: 1.15,
        whiteSpace: 'nowrap',
        ...(solid
          ? { color: 'var(--c-text)' }
          : {
              color: 'transparent',
              WebkitTextStroke: '1.5px color-mix(in srgb, var(--c-text) 55%, transparent)',
            }),
        ...cssVars({ '--marquee-s': `${speed}s` }),
      }}
    >
      <span><PlainLocText en={band(text)} zh={textZh ? band(textZh) : undefined} /></span>
      <span aria-hidden><PlainLocText en={band(text)} zh={textZh ? band(textZh) : undefined} /></span>
    </div>
  );
  return (
    <div className={className} style={{ overflow: 'hidden', padding: '10px 0', ...style }} aria-label={text}>
      {row(false, !outline)}
      {dual && row(true, outline)}
    </div>
  );
}

/* ── ParallaxHero — container whose layers drift at depths ── */

export function RtParallaxHero({
  height = 88,
  children,
  className,
  style,
}: Sty & { height?: number; children?: ReactNode }) {
  const kids = Array.isArray(children) ? children : children != null ? [children] : [];
  return (
    <div
      className={className}
      style={{ position: 'relative', minHeight: `${height}vh`, display: 'grid', placeItems: 'center', overflow: 'clip', ...style }}
    >
      {kids.map((k, i) => (
        <div
          key={i}
          data-depth={(0.06 + i * 0.09).toFixed(2)}
          style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center', width: '100%' }}
        >
          {k}
        </div>
      ))}
    </div>
  );
}

/* ── ScrollStory — pinned beats driven by pure CSS off --p ── */

export function RtScrollStory({ children, className, style }: Sty & { children?: ReactNode }) {
  const kids = Array.isArray(children) ? children : children != null ? [children] : [];
  const n = Math.max(1, kids.length);
  return (
    <div
      className={`cin-ss ${className ?? ''}`}
      data-scrub="pin"
      style={{ height: `${n * 100 + 60}vh`, position: 'relative', ...cssVars({ '--p': 0 }), ...style }}
    >
      <div className="mo-pin">
        {kids.map((k, i) => {
          // beat i is fully visible while --p sweeps its slice; min() of the
          // entry ramp and exit ramp — all linear in var(--p), pure CSS.
          const ramps = `min(clamp(0, calc((var(--p) * ${n} - ${i}) * 3 + 1), 1), clamp(0, calc((${i + 1} - var(--p) * ${n}) * 3 + 0.35), 1))`;
          return (
            <div
              key={i}
              className="cin-ss-beat"
              style={{
                gridArea: '1 / 1',
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                padding: '0 6vw',
                opacity: `calc(${ramps})` as never,
                transform: `translateY(calc((1 - ${ramps}) * 34px))`,
                pointerEvents: 'none',
              }}
            >
              <div style={{ pointerEvents: 'auto', maxWidth: 780, width: '100%' }}>{k}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── HorizontalScroller — vertical scroll drives a sideways track ── */

export function RtHorizontalScroller({
  children,
  className,
  style,
}: Sty & { children?: ReactNode }) {
  const kids = Array.isArray(children) ? children : children != null ? [children] : [];
  const n = Math.max(1, kids.length);
  return (
    <div
      className={`cin-hs ${className ?? ''}`}
      data-scrub="pin"
      style={{ height: `${Math.max(150, n * 62)}vh`, position: 'relative', ...cssVars({ '--p': 0 }), ...style }}
    >
      <div className="mo-pin" style={{ justifyContent: 'center' }}>
        <div
          className="cin-hs-track"
          style={{
            display: 'flex',
            gap: 28,
            width: 'max-content',
            padding: '0 8vw',
            transform: 'translateX(calc((100vw - 100%) * var(--p, 0)))',
            willChange: 'transform',
          }}
        >
          {kids.map((k, i) => (
            <div key={i} style={{ flex: '0 0 auto', width: 'min(420px, 78vw)' }}>
              {k}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── StickyShowcase — pinned copy beside a scrolling stream ── */

export function RtStickyShowcase({
  title,
  titleZh,
  body,
  bodyZh,
  side = 'left',
  children,
  className,
  style,
}: Sty & { title?: string; titleZh?: string | null; body?: string; bodyZh?: string | null; side?: 'left' | 'right'; children?: ReactNode }) {
  const kids = Array.isArray(children) ? children : children != null ? [children] : [];
  const copy = (
    <div style={{ position: 'sticky', top: '22vh', alignSelf: 'start' }}>
      {title && (
        <h3 className="font-heading" style={{ fontSize: 'clamp(1.8rem, 3.4vw, 2.8rem)', lineHeight: 1.12, fontWeight: 800, margin: 0, letterSpacing: '-0.015em' }}>
          <PlainLocText en={title} zh={titleZh} />
        </h3>
      )}
      {body && <p style={{ marginTop: 14, color: 'var(--c-text-muted)', fontSize: 16.5, lineHeight: 1.7, maxWidth: 420 }}><PlainLocText en={body} zh={bodyZh} /></p>}
    </div>
  );
  const stream = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
      {kids.map((k, i) => (
        <div key={i} className="rv">
          {k}
        </div>
      ))}
    </div>
  );
  return (
    <div
      className={`grid gap-12 md:grid-cols-2 max-md:!grid-cols-1 ${className ?? ''}`}
      style={{ alignItems: 'start', ...style }}
    >
      {side === 'left' ? copy : stream}
      {side === 'left' ? stream : copy}
    </div>
  );
}

/* ── CountUpBand — stats with count-up + fill bars ────────── */

export function RtCountUpBand({
  items,
  className,
  style,
}: Sty & { items: { value: string; label: string; labelZh?: string }[] }) {
  return (
    <div
      className={`rv-stagger grid gap-8 max-md:!grid-cols-2 ${className ?? ''}`}
      style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)`, ...style }}
    >
      {items.map((it, i) => {
        const m = it.value.match(/^([^0-9]*)([0-9]+(?:\.[0-9]+)?)(.*)$/);
        return (
          <div key={i} style={{ textAlign: 'center' }}>
            <div className="font-heading" style={{ fontSize: 'clamp(2.2rem, 4.6vw, 3.4rem)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
              {m ? (
                <span data-count-to={m[2]} data-count-prefix={m[1]} data-count-suffix={m[3]}>
                  {it.value}
                </span>
              ) : (
                it.value
              )}
            </div>
            <div
              aria-hidden
              style={{ height: 3, borderRadius: 2, margin: '12px auto 0', width: '56%', background: 'color-mix(in srgb, var(--c-text) 12%, transparent)', overflow: 'hidden' }}
            >
              <div className="mo-fill" style={{ height: '100%', width: '100%', background: 'var(--c-primary)', transformOrigin: 'left' }} />
            </div>
            <div style={{ marginTop: 10, fontSize: 13.5, color: 'var(--c-text-muted)' }}>
              <PlainLocText en={it.label} zh={it.labelZh} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── ScrollProgress — reading bar (CSS scroll-driven, degrades) ── */

export function RtScrollProgress({ className, style }: Sty) {
  return (
    <>
      <style>{`
        @keyframes mo-doc-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .mo-doc-bar { animation: mo-doc-progress linear both; animation-timeline: scroll(root); }
        @supports not (animation-timeline: scroll(root)) { .mo-doc-bar { display: none; } }
      `}</style>
      <div
        className={`mo-doc-bar ${className ?? ''}`}
        aria-hidden
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          zIndex: 90,
          background: 'linear-gradient(90deg, var(--c-primary), var(--c-accent))',
          transformOrigin: 'left',
          ...style,
        }}
      />
    </>
  );
}

/* ── MagneticCTA — pointer-magnet pill with shine sweep ───── */

export function RtMagneticCTA({
  label,
  labelZh,
  href,
  sub,
  subZh,
  className,
  style,
}: Sty & { label: string; labelZh?: string | null; href?: string; sub?: string; subZh?: string | null }) {
  const destination = href?.trim() || undefined;
  const ctaStyle = {
    display: 'inline-block',
    padding: '20px 52px',
    borderRadius: 999,
    background: 'var(--c-primary)',
    color: 'var(--c-primary-fg)',
    fontSize: 19,
    fontWeight: 700,
    letterSpacing: '0.01em',
    boxShadow: '0 18px 44px -14px color-mix(in srgb, var(--c-primary) 55%, transparent)',
  } as const;
  const content = <PlainLocText en={label} zh={ctaZh(label, labelZh)} />;
  return (
    <div className={className} style={{ textAlign: 'center', ...style }}>
      {destination ? (
        <a href={destination} data-magnetic="18" className="mo-shine font-heading" style={ctaStyle}>
          {content}
        </a>
      ) : (
        <span aria-disabled="true" className="font-heading" style={{ ...ctaStyle, cursor: 'default' }}>
          {content}
        </span>
      )}
      {sub && <div style={{ marginTop: 14, fontSize: 13.5, color: 'var(--c-text-muted)' }}><PlainLocText en={sub} zh={subZh} /></div>}
    </div>
  );
}

/* ── RevealImage — scroll-scrubbed clip reveal ────────────── */

export function RtRevealImage({
  src,
  alt = '',
  effect = 'curtain',
  ratio = '16/10',
  placeholder,
  className,
  style,
}: Sty & { src: string; alt?: string; effect?: 'curtain' | 'iris' | 'wipe'; ratio?: string; placeholder?: boolean }) {
  if (placeholder) {
    /* 沒有照片可放時,這一格仍然是版面的一部分 —— 純 var(--c-surface) 在淺色
       主題就是一塊白,看起來像壞掉。用主色淡染出一個有意圖的面板。 */
    return (
      <div
        className={className}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        style={{
          aspectRatio: ratio,
          borderRadius: 'var(--radius-lg, 16px)',
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--c-primary) 14%, var(--c-surface)), color-mix(in srgb, var(--c-accent, var(--c-primary)) 7%, var(--c-surface)) 60%, var(--c-surface))',
          border: '1px solid color-mix(in srgb, var(--c-primary) 12%, var(--c-border))',
          ...style,
        }}
      />
    );
  }
  const clip =
    effect === 'iris'
      ? 'inset(calc((1 - var(--k)) * 38%) round calc((1 - var(--k)) * 50% + 18px))'
      : effect === 'wipe'
        ? 'inset(0 calc((1 - var(--k)) * 100%) 0 0)'
        : 'inset(0 calc((1 - var(--k)) * 50%) 0 calc((1 - var(--k)) * 50%))';
  return (
    <div
      className={`cin-ri ${className ?? ''}`}
      data-scrub="self"
      style={{ ...cssVars({ '--p': 0, '--k': 'clamp(0, calc(var(--p) * 2.6 - 0.35), 1)' }), ...style }}
    >
      <div className="cin-ri-frame" style={{ aspectRatio: ratio, overflow: 'hidden', clipPath: clip as never, borderRadius: 'var(--radius-lg, 16px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="ls-photo"
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(calc(1.16 - var(--k) * 0.16))' }}
        />
      </div>
    </div>
  );
}

/* ── TimelineFlow — journey line that draws itself ────────── */

export function RtTimelineFlow({
  steps,
  className,
  style,
}: Sty & { steps: { title: string; titleZh?: string; body?: string; bodyZh?: string; tag?: string }[] }) {
  const n = Math.max(1, steps.length);
  const ROW = 210;
  const H = n * ROW;
  // river geometry (viewBox 0..1000 wide; non-scaling strokes keep lines crisp)
  const nodeY = (i: number) => i * ROW + 46;
  const stem = `M 500 8 ${Array.from({ length: n }, (_, i) => `L 500 ${nodeY(i)}`).join(' ')} L 500 ${H - 8}`;
  return (
    // overflow-x clip lets cards slide in from off-screen without a scrollbar
    <div className={className} style={{ position: 'relative', overflowX: 'clip', ...style }}>
      {/* the connecting line draws itself in as the section enters view (rv gives
          the svg its is-in trigger; a CSS override keeps it from fading — draw only).
          No JS / reduced-motion → the line stays static and visible (safe). */}
      <svg
        aria-hidden
        className="cin-tl-river rv"
        data-draw="reveal"
        viewBox={`0 0 1000 ${H}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
      >
        {/* main stem only — a straight line is stretch-immune, so it stays glued
            to the row-anchored dots no matter how tall any card grows */}
        <path d={stem} fill="none" stroke="var(--c-primary)" strokeOpacity="0.4" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {steps.map((s, i) => {
          return (
            <div key={i} className="cin-tl-row" style={{ position: 'relative', minHeight: ROW - 56 }}>
              <span
                aria-hidden
                className="cin-tl-dot"
                style={{
                  position: 'absolute',
                  left: 'calc(50% - 8px)',
                  top: 34,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: 'var(--c-primary)',
                  boxShadow: '0 0 0 5px color-mix(in srgb, var(--c-primary) 20%, transparent), 0 0 18px color-mix(in srgb, var(--c-primary) 55%, transparent)',
                }}
              />
              {/* tributary — anchored to THIS row, so it always grows straight out
                  of the node above (fixed px geometry, no viewBox stretch drift) */}
              <span
                aria-hidden
                className={`cin-tl-branch rv ${i % 2 ? 'cin-tl-b-r' : 'cin-tl-b-l'}`}
                style={{
                  position: 'absolute',
                  top: 41,
                  height: 30,
                  ...(i % 2
                    ? { left: '50%', right: 'calc(min(46%, 460px) - 2px)', borderTop: '1.8px solid color-mix(in srgb, var(--c-primary) 30%, transparent)', borderRight: '1.8px solid color-mix(in srgb, var(--c-primary) 30%, transparent)', borderTopRightRadius: 26 }
                    : { right: '50%', left: 'calc(min(46%, 460px) - 2px)', borderTop: '1.8px solid color-mix(in srgb, var(--c-primary) 30%, transparent)', borderLeft: '1.8px solid color-mix(in srgb, var(--c-primary) 30%, transparent)', borderTopLeftRadius: 26 }),
                }}
              />
              <div
                className={i % 2 ? 'cin-tl-card cin-tl-right rv rv-right' : 'cin-tl-card rv rv-left'}
                style={{
                  ...cssVars({ '--mo-dist': '46px' }), // bigger, clearly-visible slide-in (mobile stays put via cinema.css)
                  background: 'var(--c-surface)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 'var(--radius-lg, 16px)',
                  padding: '22px 24px',
                }}
              >
                {s.tag && (
                  <div className="font-heading" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-primary)' }}>
                    {s.tag}
                  </div>
                )}
                <div className="font-heading" style={{ fontSize: 20, fontWeight: 700, marginTop: s.tag ? 6 : 0 }}>
                  <PlainLocText en={s.title} zh={s.titleZh} />
                </div>
                {s.body && <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.65, color: 'var(--c-text-muted)' }}><PlainLocText en={s.body} zh={s.bodyZh} /></p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── VideoScrollScrub — scroll drives video time (scroll-world) ── */

export function RtVideoScrollScrub({
  src,
  poster,
  title,
  titleZh,
  sub,
  subZh,
  travel = 260,
  className,
  style,
}: Sty & { src: string; poster?: string; title?: string; titleZh?: string | null; sub?: string; subZh?: string | null; travel?: number }) {
  // photo-first: no real video → don't pin a full-screen black box. Show a clean
  // title/sub band, or nothing at all if there's no copy either.
  if (!src) {
    if (!title && !sub) return null;
    return (
      <div style={{ background: '#000', color: '#fff', padding: 'clamp(56px, 11vw, 110px) 7vw', textAlign: 'center', ...style }}>
        {title && <div className="font-heading" style={{ fontSize: 'clamp(1.9rem, 5vw, 3.4rem)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.08, maxWidth: '18ch', margin: '0 auto', textWrap: 'balance' }}><PlainLocText en={title} zh={titleZh} /></div>}
        {sub && <div style={{ marginTop: 14, fontSize: 16, opacity: 0.8, maxWidth: '40ch', margin: '14px auto 0', lineHeight: 1.6 }}><PlainLocText en={sub} zh={subZh} /></div>}
      </div>
    );
  }
  return (
    <div
      className={`cin-vs ${className ?? ''}`}
      data-scrub="pin"
      style={{ height: `${travel}vh`, position: 'relative', ...cssVars({ '--p': 0 }), ...style }}
    >
      <div className="mo-pin" style={{ background: '#000' }}>
        <video
          data-scrub-video
          muted
          playsInline
          preload="metadata"
          poster={poster}
          src={src}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {(title || sub) && (
          <div
            style={{
              position: 'relative',
              zIndex: 2,
              textAlign: 'center',
              padding: '0 6vw',
              color: '#fff',
              textShadow: '0 2px 26px rgba(0,0,0,0.55)',
              opacity: 'calc(1 - clamp(0, calc(var(--p) * 2.4), 1) * 0.001 - clamp(0, calc((var(--p) - 0.72) * 4), 1))' as never,
            }}
          >
            {title && (
              <div className="font-heading" style={{ fontSize: 'clamp(2.2rem, 6vw, 4.6rem)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                <PlainLocText en={title} zh={titleZh} />
              </div>
            )}
            {sub && <div style={{ marginTop: 12, fontSize: 17, opacity: 0.9 }}><PlainLocText en={sub} zh={subZh} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── WideShot — letterboxed establishing shot with a slug line ──
   The prestige-TV wide: cinema bars, a slow push-in as you scroll, and a
   screenplay-style scene slug ("EXT. THE KITCHEN — 5 AM") burned into the
   corner. One image becomes a scene. */

export function RtWideShot({
  src,
  slug,
  title,
  titleZh,
  ratio = '21/9',
  placeholder,
  className,
  style,
  bars = true,
}: Sty & { src: string; slug?: string; title?: string; titleZh?: string | null; ratio?: string; placeholder?: boolean; bars?: boolean }) {
  // photo-first: no real photo → a clean slug/title band, not a gradient banner
  if (placeholder) {
    return (
      <div className={className} style={{ background: '#0a0908', color: '#f3efe6', padding: 'clamp(44px, 9vw, 88px) 7vw', textAlign: 'center', ...style }}>
        {slug && <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--c-accent)', marginBottom: 14 }}>{slug}</div>}
        {title && <div className="font-heading" style={{ fontSize: 'clamp(1.6rem, 4.4vw, 3rem)', fontWeight: 800, lineHeight: 1.12, maxWidth: '20ch', margin: '0 auto', textWrap: 'balance' }}><PlainLocText en={title} zh={titleZh} /></div>}
      </div>
    );
  }
  return (
    <div
      className={className}
      data-scrub="self"
      style={{
        /* 電影上下黑邊是刻意設計,但在淺底變體(veil/fresh…)就是一條突兀
           的黑條(花店 mid2,目檢抓到)—— 淺底由 variants 傳 bars:false。 */
        background: bars ? '#0a0908' : 'transparent',
        padding: bars ? 'clamp(18px, 3vw, 34px) 0' : 0,
        ...cssVars({ '--p': 0, '--k': 'clamp(0, calc(var(--p) * 2.2 - 0.2), 1)' }),
        ...style,
      }}
    >
      <div style={{ position: 'relative', aspectRatio: ratio, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title ?? slug ?? ''}
          className="ls-photo"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scale(calc(1.14 - var(--k) * 0.12))',
            willChange: 'transform',
          }}
        />
        {/* vignette for that graded-film weight */}
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 45%, transparent 58%, rgba(0,0,0,0.42) 100%)' }} />
        {/* unconditional bottom band — slug/title stay legible on any photo */}
        <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%', background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.32) 55%, rgba(0,0,0,0) 100%)' }} />
        {slug && (
          <div
            style={{
              position: 'absolute',
              left: 'clamp(16px, 3vw, 36px)',
              bottom: 'clamp(14px, 2.6vw, 30px)',
              color: '#f3efe6',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 'clamp(11px, 1.2vw, 13.5px)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              textShadow: '0 1px 14px rgba(0,0,0,0.8)',
              borderLeft: '2px solid var(--c-accent)',
              paddingLeft: 12,
            }}
          >
            {slug}
          </div>
        )}
        {title && (
          <div
            style={{
              position: 'absolute',
              right: 'clamp(16px, 3vw, 36px)',
              bottom: 'clamp(14px, 2.6vw, 30px)',
              color: 'rgba(243,239,230,0.85)',
              fontSize: 'clamp(12px, 1.3vw, 15px)',
              textShadow: '0 1px 14px rgba(0,0,0,0.8)',
            }}
            className="font-heading"
          >
            <PlainLocText en={title} zh={titleZh} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ChapterCard — an episode title card between acts ──
   Near-black band, quiet serif, act rules. Turns a page into chapters and a
   visit into a story arc. */

export function RtChapterCard({
  act,
  actZh,
  title,
  titleZh,
  sub,
  subZh,
  className,
  style,
}: Sty & { act?: string; actZh?: string | null; title: string; titleZh?: string | null; sub?: string; subZh?: string | null }) {
  return (
    <div
      className={className}
      style={{
        background: '#0c0b09',
        color: '#f2ede1',
        textAlign: 'center',
        padding: 'clamp(64px, 10vw, 128px) 24px',
        ...style,
      }}
    >
      {act && (
        <div className="rv" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 22 }}>
          <span aria-hidden style={{ display: 'block', width: 'min(90px, 12vw)', height: 1, background: 'color-mix(in srgb, var(--c-accent) 75%, transparent)' }} />
          <span style={{ fontSize: 12.5, letterSpacing: '0.34em', textTransform: 'uppercase', color: 'var(--c-accent)' }}><PlainLocText en={act} zh={actZh} /></span>
          <span aria-hidden style={{ display: 'block', width: 'min(90px, 12vw)', height: 1, background: 'color-mix(in srgb, var(--c-accent) 75%, transparent)' }} />
        </div>
      )}
      <div
        className="font-heading rv mo-track-in"
        style={{ fontSize: 'clamp(2rem, 4.6vw, 3.6rem)', fontWeight: 700, lineHeight: 1.15, textWrap: 'balance' }}
      >
        <PlainLocText en={title} zh={titleZh} />
      </div>
      {sub && (
        <p className="rv" style={{ margin: '18px auto 0', maxWidth: 560, fontSize: 15.5, lineHeight: 1.7, color: 'rgba(242,237,225,0.62)' }}>
          <PlainLocText en={sub} zh={subZh} />
        </p>
      )}
    </div>
  );
}

/* ── FocalShot — the camera pull (extreme close-up → wide reveal) ──
   BCS focal control: open TIGHT on the one thing that matters, scope
   letterbox bars on; scrolling pulls the camera back, the bars retract,
   and the statement lands. `mode: 'push'` runs the move in reverse. */

export function RtFocalShot({
  src,
  eyebrow,
  eyebrowZh,
  statement,
  statementZh,
  sub,
  subZh,
  slug,
  mode = 'pull',
  travel = 230,
  placeholder,
  className,
  style,
}: Sty & {
  src: string;
  eyebrow?: string;
  eyebrowZh?: string | null;
  statement?: string;
  statementZh?: string | null;
  sub?: string;
  subZh?: string | null;
  slug?: string;
  mode?: 'pull' | 'push';
  travel?: number;
  placeholder?: boolean;
}) {
  // Photo-first: with no real photo, the cinematic close-up would just blow up a
  // placeholder into a big empty box. Degrade to a clean, compact statement band —
  // the camera drama returns the moment a real photo is added.
  if (placeholder) {
    return (
      <div
        className={`cin-fs-lite ${className ?? ''}`}
        style={{ background: '#0a0908', color: '#f3efe6', padding: 'clamp(56px, 11vw, 110px) 7vw', textAlign: 'center', ...style }}
      >
        {eyebrow && (
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--c-accent)', marginBottom: 18 }}>
            <PlainLocText en={eyebrow} zh={eyebrowZh} />
          </div>
        )}
        {statement && (
          <div className="font-heading" style={{ fontSize: 'clamp(1.7rem, 4.6vw, 3.1rem)', fontWeight: 800, lineHeight: 1.12, maxWidth: '18ch', margin: '0 auto', textWrap: 'balance' }}>
            <PlainLocText en={statement} zh={statementZh} />
          </div>
        )}
        {sub && <div style={{ marginTop: 16, fontSize: 15, opacity: 0.6, maxWidth: '40ch', margin: '16px auto 0', lineHeight: 1.6 }}><PlainLocText en={sub} zh={subZh} /></div>}
      </div>
    );
  }
  const pull = mode !== 'push';
  // camera: eased progress drives subject scale; bars + copy ride the same clock
  const scale = pull ? 'calc(3.1 - var(--pe, 0) * 2.1)' : 'calc(1 + var(--pe, 0) * 2.2)';
  const copyOn = pull ? 'clamp(0, calc((var(--pe, 0) - 0.52) * 3.2), 1)' : 'clamp(0, calc((0.42 - var(--pe, 0)) * 3.2), 1)';
  const slugOn = pull ? 'clamp(0, calc((0.4 - var(--pe, 0)) * 3.4), 1)' : 'clamp(0, calc((var(--pe, 0) - 0.62) * 3.4), 1)';
  return (
    <div
      className={`cin-fs ${className ?? ''}`}
      data-scrub="pin"
      style={{ height: `${travel}vh`, position: 'relative', ...cssVars({ '--p': 0, '--pe': 0 }), ...style }}
    >
      <div className="mo-pin" style={{ background: '#0a0908', color: '#f3efe6' }}>
        {/* subject — the one thing the camera is about */}
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          <div className="cin-fs-subject" style={{ transform: `scale(${scale})`, willChange: 'transform' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={statement ?? ''} loading="lazy" decoding="async" className="ls-photo" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
          </div>
          {/* vignette opens as the shot widens — floor: never below 0.5 while
             the statement is on, so copy holds on any photo */}
          <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(0,0,0,0.78) 100%)', opacity: `calc(0.9 - var(--pe, 0) * 0.4)` as never }} />
        </div>
        {/* scope letterbox bars — retract as the wide reveals. Fixed 13% slabs
           squashed by scaleY (solid black, so the squash is invisible): the
           scrub clock only ever touches compositor transforms, never height */}
        <div aria-hidden className="cin-fs-bar" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '13%', transformOrigin: '50% 0', transform: 'scaleY(calc(1 - var(--pe, 0) * 0.8462))', background: '#000', zIndex: 3, willChange: 'transform' }} />
        <div aria-hidden className="cin-fs-bar" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '13%', transformOrigin: '50% 100%', transform: 'scaleY(calc(1 - var(--pe, 0) * 0.8462))', background: '#000', zIndex: 3, willChange: 'transform' }} />
        {/* scene slug — alive during the close-up; rides the bar edge via a
           full-height layer whose translateY% is container-relative */}
        {slug && (
          <div className="cin-fs-ride" style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', transform: 'translateY(calc(var(--pe, 0) * -11%))', willChange: 'transform' }}>
            <div
              className="cin-fs-slug"
              style={{
                position: 'absolute',
                left: 'clamp(18px, 3.4vw, 44px)',
                top: 'calc(13% + 26px)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 'clamp(11px, 1.2vw, 13.5px)',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                opacity: slugOn as never,
                textShadow: '0 1px 14px rgba(0,0,0,0.8)',
                borderLeft: '2px solid var(--c-accent)',
                paddingLeft: 12,
              }}
            >
              {slug}
            </div>
          </div>
        )}
        {/* the statement — lands when the wide lands; same container-relative
           mover trick keeps the ride on the compositor */}
        <div className="cin-fs-ride" style={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none', transform: 'translateY(calc(var(--pe, 0) * 11%))', willChange: 'transform' }}>
        <div
          className="cin-fs-copy"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(13% + 5vh)',
            textAlign: 'center',
            padding: '0 6vw',
            opacity: copyOn as never,
            transform: `translateY(calc((1 - ${copyOn}) * 26px))`,
          }}
        >
          {eyebrow && (
            <div style={{ fontSize: 12.5, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--c-accent)', textShadow: '0 2px 30px rgba(0,0,0,0.6)', marginBottom: 12 }}><PlainLocText en={eyebrow} zh={eyebrowZh} /></div>
          )}
          {statement && (
            <div className="font-heading" style={{ fontSize: 'clamp(1.9rem, 4.6vw, 3.6rem)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.015em', textShadow: '0 2px 30px rgba(0,0,0,0.6)', textWrap: 'balance' }}>
              <PlainLocText en={statement} zh={statementZh} />
            </div>
          )}
          {/* no-motion 滿幅後副標壓在照片上:跟陳述句同款影地,不再是
             深灰壓黑的隱形字(第六輪長條圖) */}
          {sub && <div style={{ marginTop: 12, fontSize: 15.5, opacity: 0.92, textShadow: '0 2px 24px rgba(0,0,0,0.75)' }}><PlainLocText en={sub} zh={subZh} /></div>}
        </div>
        </div>
      </div>
    </div>
  );
}

/* ── MenuPalace — the menu as a mind palace ──
   Sherlock's memory palace, realized: each category is a chamber in a long
   corridor; scrolling walks the camera forward through real CSS-3D depth.
   Dishes hang on the corridor walls like annotated paintings. Pure CSS off
   --p — the camera position is one translateZ per chamber. */

/* RtMenuPalace receives the shared catalog item (from codegen's catalogInitial),
   which carries more fields than the palace renders — declare the full shape so
   the emitted data type-checks (the palace only reads name/nameZh/description/price) */
interface PalaceItem {
  id?: string;
  name: string;
  nameZh?: string | null;
  description?: string | null;
  descriptionZh?: string | null;
  priceCents?: number;
  durationMin?: number;
  depositCents?: number;
  imageUrl?: string | null;
  badges?: string[];
  modifiers?: unknown[];
}
interface PalaceCat { name: string; nameZh?: string; items: PalaceItem[] }

export function RtMenuPalace({
  initialData = [],
  heading = 'Walk the menu',
  headingZh,
  sub,
  subZh,
  ctaLabel,
  ctaLabelZh,
  href = '/order',
  className,
  style,
}: Sty & {
  initialData?: PalaceCat[]; heading?: string; headingZh?: string | null; sub?: string; subZh?: string | null;
  ctaLabel?: string; ctaLabelZh?: string | null; href?: string;
}) {
  const cats = initialData.filter((c) => c.items?.length);
  // no menu items → render nothing rather than a 90vh empty corridor
  if (cats.length === 0) return null;
  const n = cats.length;
  // the 3D corridor is a showcase for a tight menu (≤4 dishes/chamber). A real,
  // large menu can't live in a 3D hall — it flattens to the readable full list
  // (which shows every dish and scales to hundreds). `.cin-mp-big` drives that.
  const big = cats.some((c) => c.items.length > 4);
  const D = 1500; // corridor depth per chamber (px)
  const money = (c?: number) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);
  return (
    <div
      className={`cin-mp ${big ? 'cin-mp-big' : ''} ${className ?? ''}`}
      data-scrub="pin"
      style={{ height: `${n * 105 + 90}vh`, position: 'relative', ...cssVars({ '--p': 0, '--pe': 0 }), ...style }}
    >
      <div className="mo-pin" style={{ background: '#0b0a09', color: '#f3efe6' }}>
        {/* corridor atmosphere: floor grid + vignette */}
        <div
          aria-hidden
          className="cin-mp-atmo"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at 50% 42%, transparent 40%, rgba(0,0,0,0.66) 100%), linear-gradient(to top, color-mix(in srgb, var(--c-primary) 9%, transparent), transparent 42%)',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
        {/* perspective floor — the corridor ground plane. The grid lives on an
           oversized child driven by translateY (background-position would
           repaint the layer every scrub frame — same rule as fx-blinds) */}
        <div
          aria-hidden
          className="cin-mp-floor"
          style={{
            position: 'absolute',
            left: '-24%',
            right: '-24%',
            bottom: '-6%',
            height: '52%',
            transform: 'perspective(900px) rotateX(72deg)',
            transformOrigin: '50% 100%',
            overflow: 'hidden',
            maskImage: 'linear-gradient(to top, black 22%, transparent 88%)',
            WebkitMaskImage: 'linear-gradient(to top, black 22%, transparent 88%)',
            opacity: 0.5,
            zIndex: 1,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: -510,
              backgroundImage:
                'linear-gradient(color-mix(in srgb, var(--c-accent) 16%, transparent) 1.5px, transparent 1.5px), linear-gradient(90deg, color-mix(in srgb, var(--c-accent) 16%, transparent) 1.5px, transparent 1.5px)',
              backgroundSize: '90px 90px',
              transform: `translateY(calc(var(--pe, 0) * -420px))`,
              willChange: 'transform',
            }}
          />
        </div>
        <div className="cin-mp-3d" style={{ position: 'absolute', inset: 0, perspective: '1150px', perspectiveOrigin: '50% 44%', overflow: 'hidden', zIndex: 2 }}>
          {cats.map((c, i) => {
            // camera walks the corridor as --p sweeps; chamber i sits at depth i*D
            const z = `calc(${-i * D}px + var(--pe, 0) * ${(n - 1) * D}px)`;
            const focus = n === 1 ? 0 : i / (n - 1);
            const w = 0.5 / n + 0.32 / n; // visibility half-window in p-space
            const on =
              n === 1
                ? '1'
                : `min(clamp(0, calc((var(--pe, 0) - ${(focus - 0.62 / n).toFixed(4)}) * ${(n * 2.4).toFixed(1)}), 1), clamp(0, calc((${(focus + 0.62 / n).toFixed(4)} - var(--pe, 0)) * ${(n * 2.4).toFixed(1)}), 1))`;
            const four = c.items; // full chamber (3D only renders when the menu is small)
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  // anchor content just under the top HUD — centering left a tall
                  // dead band between the kicker and 'MENU 01/0N'
                  placeItems: 'start center',
                  paddingTop: 'clamp(88px, 14vh, 140px)',
                  // per-chamber progression: the backdrop warms as you walk deeper
                  background: `color-mix(in srgb, var(--c-accent) ${4 + Math.min(i, 3) * 2}%, transparent)`,
                  transform: `translateZ(${z})`,
                  opacity: on as never,
                  pointerEvents: 'none',
                  willChange: 'transform, opacity',
                }}
              >
                <div style={{ textAlign: 'center', maxWidth: 1060, width: '100%', padding: '0 5vw', transform: `scale(calc(0.94 + ${typeof on === 'string' ? on : '1'} * 0.06))` as never }}>
                  <div style={{ fontSize: 12, letterSpacing: '0.32em', textTransform: 'uppercase', color: 'var(--c-accent)' }}>
                    {`Menu ${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`}
                  </div>
                  <div className="font-heading" style={{ fontSize: 'clamp(2rem, 4.4vw, 3.6rem)', fontWeight: 800, marginTop: 10, lineHeight: 1.08, textShadow: '0 2px 30px rgba(0,0,0,0.6)' }}>
                    {c.name}
                    {c.nameZh && <span style={{ display: 'block', fontSize: '0.44em', fontWeight: 600, opacity: 0.62, marginTop: 6 }}>{c.nameZh}</span>}
                  </div>
                  <div className="cin-mp-grid" style={{ display: 'grid', gap: 'clamp(14px, 2.2vw, 26px)', marginTop: 'clamp(48px, 7vh, 64px)', textAlign: 'left' }}>
                    {four.map((it, j) => (
                      <div
                        key={j}
                        className="cin-mp-item"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.14)',
                          borderRadius: 'var(--r-md)',
                          padding: '20px 24px',
                          backdropFilter: 'blur(6px)',
                          transform: `rotateY(${j % 2 ? -7 : 7}deg)`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                          <div className="font-heading" style={{ fontSize: 17.5, fontWeight: 700 }}>
                            {it.name}
                            {it.nameZh && <span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 8, fontSize: 14 }}>{it.nameZh}</span>}
                          </div>
                          <div style={{ color: 'color-mix(in srgb, #f3efe6 92%, transparent)', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(it.priceCents)}</div>
                        </div>
                        {it.description && (
                          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: 'rgba(243,239,230,0.62)' }}>{it.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* wayfinding + exit CTA */}
        <div className="cin-mp-hud" style={{ position: 'absolute', top: 'clamp(18px, 4vh, 40px)', left: 0, right: 0, textAlign: 'center', zIndex: 3 }}>
          <div style={{ fontSize: 12.5, letterSpacing: '0.3em', textTransform: 'uppercase', opacity: 0.72 }}><PlainLocText en={heading} zh={headingZh} /></div>
        </div>
        {/* scroll hint rides the bottom edge and yields to the CTA at the end */}
        {sub && (
          <div
            className="cin-mp-hud"
            style={{
              position: 'absolute',
              bottom: 'clamp(16px, 3.5vh, 32px)',
              left: 0,
              right: 0,
              textAlign: 'center',
              zIndex: 3,
              fontSize: 12,
              letterSpacing: '0.08em',
              color: 'rgba(243,239,230,0.72)',
              opacity: 'clamp(0, calc((0.82 - var(--pe, 0)) * 6), 1)' as never,
            }}
          >
            <PlainLocText en={sub} zh={subZh} />
          </div>
        )}
        {ctaLabel && (
          <div
            className="cin-mp-hud"
            style={{
              position: 'absolute',
              bottom: 'clamp(20px, 5vh, 46px)',
              left: 0,
              right: 0,
              textAlign: 'center',
              zIndex: 3,
              opacity: 'clamp(0, calc((var(--pe, 0) - 0.82) * 6), 1)' as never,
            }}
          >
            <a
              href={href}
              data-magnetic="16"
              className="mo-shine font-heading"
              style={{ display: 'inline-block', padding: '15px 42px', borderRadius: 999, background: 'var(--c-primary)', color: 'var(--c-primary-fg)', fontSize: 16.5, fontWeight: 700, pointerEvents: 'auto' }}
            >
              <PlainLocText en={ctaLabel} zh={ctaZh(ctaLabel, ctaLabelZh)} />
            </a>
          </div>
        )}
        {/* phones: the palace flattens into a chamber-by-chamber walk —
            same ritual (Menu 01/0N), zero 3D cost, nothing off-screen */}
        {/* flat 清單只會在「舞台被攤平成透明」的情境顯示(big/行動版/no-motion)
            —— 字色必須用主題 token:原本寫死給深色舞台的 #f3efe6 系,在淺色頁上
            隱形(四家餐飲的長條圖抓到,菜單價格與描述全看不見)。 */}
        <div className="cin-mp-flat" style={{ maxWidth: 620, margin: '0 auto', padding: '0 18px' }}>
          <div style={{ textAlign: 'center', padding: '30px 0 4px' }}>
            <div style={{ fontSize: 12, letterSpacing: '0.32em', textTransform: 'uppercase', opacity: 0.72 }}><PlainLocText en={heading} zh={headingZh} /></div>
          </div>
          {cats.map((c, i) => (
            <section key={i} style={{ padding: '34px 0 4px' }}>
              {/* each chamber 'arrives' as you scroll to it — the mind-palace walk,
                  lightweight (IntersectionObserver reveals, no 3D pin) so it runs
                  smoothly on phones and tablets */}
              <div className="rv" style={{ textAlign: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', color: 'var(--c-accent)' }}>
                  {`Menu ${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`}
                </div>
                <div className="font-heading" style={{ fontSize: 27, fontWeight: 800, marginTop: 7, lineHeight: 1.12 }}>
                  {c.name}
                  {c.nameZh && <span style={{ opacity: 0.72, fontWeight: 600, marginLeft: 9, fontSize: 15 }}>{c.nameZh}</span>}
                </div>
                <span aria-hidden style={{ display: 'block', width: 34, height: 2, borderRadius: 2, background: 'var(--c-accent)', margin: '12px auto 0', opacity: 0.8 }} />
              </div>
              <div className="rv-stagger" style={{ display: 'flex', flexDirection: 'column' }}>
                {c.items.map((it, j) => (
                  <div key={j} style={{ padding: '15px 2px', borderTop: j === 0 ? 'none' : '1px solid var(--c-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                      <div className="font-heading" style={{ fontSize: 16.5, fontWeight: 700 }}>
                        {it.name}
                        {it.nameZh && <span style={{ opacity: 0.72, fontWeight: 500, marginLeft: 8, fontSize: 13 }}>{it.nameZh}</span>}
                      </div>
                      <div style={{ color: 'var(--c-text)', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(it.priceCents)}</div>
                    </div>
                    {it.description && <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.5, color: 'var(--c-text-muted)' }}>{it.description}</div>}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {ctaLabel && (
            <div style={{ textAlign: 'center', padding: '26px 0 40px' }}>
              <a href={href} className="mo-shine font-heading" style={{ display: 'inline-block', padding: '14px 38px', borderRadius: 999, background: 'var(--c-primary)', color: 'var(--c-primary-fg)', fontSize: 16, fontWeight: 700 }}>
                <PlainLocText en={ctaLabel} zh={ctaZh(ctaLabel, ctaLabelZh)} />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
