'use client';

/* GSAP cinema — a pinned, scroll-scrubbed horizontal reel of framed dish cards.
   Ships as a native horizontal-scroll row (works with no JS, on mobile, and
   under reduced motion); GSAP then *upgrades* it into a pinned stage whose track
   scrubs sideways with momentum (scrub:1) — the buttery scroll-driven feel a CSS
   `--p` var can't give. Mirrors the editor-preview twin in @localsite/components
   defs/gsap.tsx 1:1; the only surface differences are the scroller (window here,
   .preview-stage there) and the reduced-motion source (site.motion here). GSAP
   loads lazily via dynamic import — same discipline as the three.js hero. */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { site } from '@/lib/site-config';
import { LocText, PlainLocText } from './loc-text';

type Sty = { className?: string; style?: CSSProperties };

/* ── ReelCard — a framed dish card: photo (cover) or CJK glyph, number, bilingual
   name, price, description. Palette maps to the site theme so it adapts. Twin of
   PreviewReelCard in defs/gsap.tsx. ── */
export function RtReelCard({
  src,
  glyph,
  no,
  name,
  nameZh,
  price,
  desc,
  descZh,
  className,
  style,
}: Sty & {
  src?: string;
  glyph?: string;
  no?: string;
  name?: string;
  nameZh?: string;
  price?: string;
  desc?: string;
  descZh?: string;
}) {
  const hair = 'color-mix(in srgb, var(--c-accent) 26%, transparent)';
  const dim = 'color-mix(in srgb, var(--c-text) 64%, transparent)';
  return (
    <div className={`reel-card ${className ?? ''}`} style={{ width: '100%', ...style }}>
      <div
        style={{
          position: 'relative',
          aspectRatio: '4 / 5',
          borderRadius: 4,
          overflow: 'hidden',
          border: `1px solid ${hair}`,
          background: 'linear-gradient(160deg, var(--c-surface), color-mix(in srgb, var(--c-surface) 35%, #000))',
        }}
      >
        {no ? (
          <span
            style={{ position: 'absolute', top: 12, left: 14, zIndex: 2, fontFamily: 'var(--f-head)', fontSize: 14, color: 'var(--c-accent)', letterSpacing: '0.1em', background: 'rgba(10,9,8,0.72)', padding: '3px 10px', borderRadius: 999, lineHeight: 1.4, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}
          >
            {no}
          </span>
        ) : null}
        {src ? (
          <div className="ls-photo" style={{ position: 'absolute', inset: 0, backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'radial-gradient(70% 60% at 50% 42%, color-mix(in srgb, var(--c-accent) 22%, transparent), transparent 70%)',
            }}
          >
            <span style={{ fontFamily: '"Noto Serif TC","Songti SC","STSong",serif', fontWeight: 700, fontSize: 'clamp(90px, 16vw, 150px)', color: 'color-mix(in srgb, var(--c-accent) 42%, transparent)', lineHeight: 1 }}>
              {glyph ?? '味'}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16, gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--f-head)', fontWeight: 500, fontSize: 22, margin: 0, letterSpacing: '-0.01em', color: 'var(--c-text)' }}>
            <LocText en={name} zh={name} />
          </h3>
          {nameZh ? <span style={{ fontFamily: '"Noto Serif TC","Songti SC",serif', color: dim, fontSize: 14 }}>{nameZh}</span> : null}
        </div>
        {price ? (
          <span style={{ fontFamily: 'var(--f-body)', color: 'var(--c-accent)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{price}</span>
        ) : null}
      </div>
      {desc ? (
        <p style={{ color: dim, fontSize: 13.5, lineHeight: 1.6, marginTop: 8, maxWidth: '32ch' }}>
          <LocText en={desc} zh={descZh ?? desc} />
        </p>
      ) : null}
    </div>
  );
}

export function RtCinemaReel({
  children,
  heading,
  headingZh,
  label,
  labelZh,
  body,
  bodyZh,
  className,
  style,
}: Sty & { children?: ReactNode; heading?: string; headingZh?: string; label?: string; labelZh?: string; body?: string; bodyZh?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const kids = Array.isArray(children) ? children : children != null ? [children] : [];

  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const viewport = section.querySelector<HTMLElement>('[data-reel-viewport]');
    const track = section.querySelector<HTMLElement>('[data-reel-track]');
    if (!viewport || !track) return;

    const mode = (site as { motion?: string }).motion ?? 'lively';
    const noMotion =
      mode === 'off' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(max-width: 900px)').matches;
    if (noMotion) return;

    let disposed = false;
    let ctx: { revert: () => void } | undefined;
    let cleanupRefresh: (() => void) | undefined;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, s]) => {
      if (disposed || !ref.current) return;
      const gsap = (g as { gsap?: typeof import('gsap').gsap; default?: unknown }).gsap ?? (g as { default: typeof import('gsap').gsap }).default;
      const ScrollTrigger = (s as { ScrollTrigger?: unknown; default?: unknown }).ScrollTrigger ?? (s as { default: unknown }).default;
      gsap.registerPlugin(ScrollTrigger as object);
      const stage = section.closest('.preview-stage') as HTMLElement | null;
      const inStage = !!stage;

      viewport.style.overflowX = 'hidden';
      section.style.height = '100svh';
      viewport.style.height = '100svh';

      ctx = gsap.context(() => {
        const dist = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
        const drive = gsap.to(track, {
          x: () => -dist(),
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            scroller: stage || undefined,
            pinType: inStage ? 'transform' : 'fixed',
            start: 'top top',
            end: () => '+=' + dist(),
            pin: true,
            anticipatePin: 1,
            scrub: 1,
            invalidateOnRefresh: true,
          },
        });
        track.querySelectorAll<HTMLElement>('[data-reel-card]').forEach((card) => {
          gsap.fromTo(
            card,
            { scale: 0.9, autoAlpha: 0.5 },
            {
              scale: 1,
              autoAlpha: 1,
              ease: 'none',
              scrollTrigger: { trigger: card, containerAnimation: drive, scroller: stage || undefined, start: 'left 90%', end: 'left 50%', scrub: true },
            },
          );
        });
      }, section);

      // the pinned distance = track width; it must be measured AFTER cards/fonts/
      // images lay out, or the pin gets ~0 length. Refresh on the next frames, on
      // fonts.ready, and on window load — invalidateOnRefresh recomputes end().
      const st = ScrollTrigger as { refresh: () => void };
      const refresh = () => { if (!disposed) st.refresh(); };
      requestAnimationFrame(() => requestAnimationFrame(refresh));
      window.addEventListener('load', refresh);
      (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(refresh);
      cleanupRefresh = () => window.removeEventListener('load', refresh);
    });

    return () => {
      disposed = true;
      cleanupRefresh?.();
      ctx?.revert();
      viewport.style.overflowX = 'auto';
      section.style.height = '';
      viewport.style.height = '';
    };
  }, []);

  const dim = 'color-mix(in srgb, var(--c-text) 64%, transparent)';
  return (
    <div
      ref={ref}
      className={`cin-gsap-reel ${className ?? ''}`}
      data-cinema-reel
      // opaque by default so the pinned stage never shows the section behind it
      style={{ position: 'relative', background: 'var(--c-bg, #0b0a08)', color: 'var(--c-text)', ...style }}
    >
      <div data-reel-viewport style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' } as CSSProperties}>
        <div data-reel-track style={{ display: 'flex', gap: 40, width: 'max-content', alignItems: 'center', padding: '10vh 8vw', minHeight: '60vh' }}>
          {heading || label || body ? (
            <div data-reel-head style={{ flex: '0 0 auto', width: 'min(460px, 82vw)', paddingRight: '3vw' }}>
              {label ? (
                <div style={{ fontSize: 12, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--c-accent)', fontWeight: 600, marginBottom: 18 }}><PlainLocText en={label} zh={labelZh} /></div>
              ) : null}
              {heading ? (
                <div style={{ fontFamily: 'var(--f-head)', fontSize: 'clamp(40px, 5.5vw, 88px)', lineHeight: 0.98, fontWeight: 500, letterSpacing: '-0.02em', margin: 0 }}><PlainLocText en={heading} zh={headingZh} /></div>
              ) : null}
              {body ? <p style={{ color: dim, fontSize: 16, lineHeight: 1.7, maxWidth: '34ch', marginTop: 22 }}><PlainLocText en={body} zh={bodyZh} /></p> : null}
            </div>
          ) : null}
          {kids.map((k, i) => (
            <div key={i} data-reel-card style={{ flex: '0 0 auto', width: 'min(400px, 80vw)', willChange: 'transform' }}>
              {k}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── CinemaFocus — a pinned statement that scrubs a headline push-in as you pass
   through. Unlike the CSS FocalShot (which drops pinning on touch), this pins on
   EVERY size — the scrub is vertical, so it's mobile-safe. Twin of the preview
   PreviewCinemaFocus in defs/gsap.tsx. ── */
export function RtCinemaFocus({
  eyebrow,
  eyebrowZh,
  statement,
  statementZh,
  sub,
  subZh,
  className,
  style,
}: Sty & { eyebrow?: string; eyebrowZh?: string; statement?: string; statementZh?: string; sub?: string; subZh?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const mode = (site as { motion?: string }).motion ?? 'lively';
    // NOTE: no max-width gate — CinemaFocus is meant to pin on mobile too.
    if (mode === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let disposed = false;
    let ctx: { revert: () => void } | undefined;
    let cleanupRefresh: (() => void) | undefined;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, s]) => {
      if (disposed || !ref.current) return;
      const gsap = (g as { gsap?: typeof import('gsap').gsap; default?: unknown }).gsap ?? (g as { default: typeof import('gsap').gsap }).default;
      const ScrollTrigger = (s as { ScrollTrigger?: unknown; default?: unknown }).ScrollTrigger ?? (s as { default: unknown }).default;
      gsap.registerPlugin(ScrollTrigger as object);
      const stage = section.closest('.preview-stage') as HTMLElement | null;

      ctx = gsap.context(() => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: section,
              scroller: stage || undefined,
              pinType: stage ? 'transform' : 'fixed',
              start: 'top top',
              end: '+=110%',
              pin: true,
              anticipatePin: 1,
              scrub: 1,
              invalidateOnRefresh: true,
            },
          })
          .fromTo('[data-focus-statement]', { scale: 1.14, autoAlpha: 0.32 }, { scale: 1, autoAlpha: 1, ease: 'none' }, 0)
          .fromTo('[data-focus-sub]', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, ease: 'none' }, 0.25);
      }, section);

      const st = ScrollTrigger as { refresh: () => void };
      const refresh = () => { if (!disposed) st.refresh(); };
      requestAnimationFrame(() => requestAnimationFrame(refresh));
      window.addEventListener('load', refresh);
      (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(refresh);
      cleanupRefresh = () => window.removeEventListener('load', refresh);
    });

    return () => {
      disposed = true;
      cleanupRefresh?.();
      ctx?.revert();
    };
  }, []);

  const dim = 'color-mix(in srgb, var(--c-text) 66%, transparent)';
  return (
    <div
      ref={ref}
      className={`cin-gsap-focus ${className ?? ''}`}
      data-cinema-focus
      style={{ position: 'relative', minHeight: '100svh', display: 'grid', placeItems: 'center', overflow: 'hidden', background: 'var(--c-bg, #0b0a08)', color: 'var(--c-text)', padding: '10vh 8vw', textAlign: 'center', ...style }}
    >
      <div style={{ maxWidth: '18ch' }}>
        {eyebrow ? <div style={{ fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--c-accent)', fontWeight: 600, marginBottom: 26 }}><PlainLocText en={eyebrow} zh={eyebrowZh} /></div> : null}
        <div data-focus-statement style={{ fontFamily: 'var(--f-head)', fontSize: 'clamp(40px, 8vw, 132px)', lineHeight: 0.98, fontWeight: 500, letterSpacing: '-0.02em', willChange: 'transform', transformOrigin: '50% 50%' }}>
          <PlainLocText en={statement} zh={statementZh} />
        </div>
        {sub ? <p data-focus-sub style={{ color: dim, fontSize: 'clamp(15px, 1.6vw, 20px)', lineHeight: 1.6, maxWidth: '32ch', margin: '30px auto 0' }}><PlainLocText en={sub} zh={subZh} /></p> : null}
      </div>
    </div>
  );
}
