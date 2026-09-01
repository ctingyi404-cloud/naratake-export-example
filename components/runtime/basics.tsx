/* Basic + layout runtime components. Server-renderable. */

import type { CSSProperties, ReactNode } from 'react';
import { LocText } from './loc-text';
import { renderInlineMarkup } from '../richtext';
import { ctaZh } from '@/lib/cta-i18n';

export interface RtProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** render text, switching to a zh/es variant live when one is provided */
function loc(text: string, zh?: string | null): ReactNode {
  return zh ? <LocText en={text} zh={zh} /> : text;
}

/** body copy: the same live switch, but the string carries the three inline
    marks (**bold** *italic* [link](url)) — renderInlineMarkup on both paths,
    which also keeps the cjkNoWrap guarantee on every plain fragment */
function locMarkup(text: string, zh?: string | null): ReactNode {
  return zh ? <LocText en={text} zh={zh} markup /> : renderInlineMarkup(text);
}

export function RtHeading({
  text,
  textZh,
  level = 'h2',
  gradient,
  className,
  style,
}: RtProps & { text: string; textZh?: string | null; level?: string; gradient?: boolean }) {
  const Tag = (['h1', 'h2', 'h3', 'h4'].includes(level) ? level : 'h2') as 'h2';
  return (
    <Tag className={`${gradient ? 'text-gradient ' : ''}${className ?? ''}`} style={{ margin: 0, lineHeight: 1.12, ...style }}>
      {locMarkup(text, textZh)}
    </Tag>
  );
}

export function RtText({ text, textZh, className, style }: RtProps & { text: string; textZh?: string | null }) {
  return (
    <p className={className} style={{ margin: 0, whiteSpace: 'pre-wrap', ...style }}>
      {locMarkup(text, textZh)}
    </p>
  );
}

/* Button-in-button trailing arrow (twin: BtnArrowShell in components shared.tsx).
   The .ls-btn-ic shell + hover nudge live in globals.css. */
export function RtBtnArrow() {
  return (
    <span aria-hidden className="ls-btn-ic">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

export function RtButton({
  label,
  labelZh,
  href,
  variant = 'solid',
  size = 'md',
  newTab,
  arrow,
  className,
  style,
}: RtProps & { label: string; labelZh?: string | null; href?: string; variant?: string; size?: string; newTab?: boolean; arrow?: boolean }) {
  const cls = [
    'ls-btn',
    variant === 'outline' ? 'ls-btn-outline' : variant === 'ghost' ? 'ls-btn-ghost' : '',
    size === 'sm' ? '!px-4 !py-2 !text-[13px]' : size === 'lg' ? '!px-8 !py-[14px] !text-[16px]' : '',
    'self-start',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const destination = href?.trim() || undefined;
  const content = (
    <>
      {loc(label, ctaZh(label, labelZh))}
      {arrow ? <RtBtnArrow /> : null}
    </>
  );
  if (!destination) {
    return (
      <span aria-disabled="true" className={cls} style={{ ...style, cursor: 'default' }}>
        {content}
      </span>
    );
  }
  return (
    <a href={destination} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener' : undefined} className={cls} style={style}>
      {content}
    </a>
  );
}

export function RtImage({
  src,
  alt,
  ratio = '4:3',
  fit = 'cover',
  frame,
  lcp,
  className,
  style,
}: RtProps & { src: string; alt: string; ratio?: string; fit?: string; frame?: boolean; lcp?: boolean }) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      {...(lcp ? { fetchPriority: 'high' as const } : {})}
      className={frame ? 'ls-photo' : `ls-photo ${className ?? ''}`}
      style={{
        display: 'block',
        width: '100%',
        objectFit: fit as 'cover',
        aspectRatio: ratio === 'auto' ? undefined : ratio.replace(':', ' / '),
        borderRadius: 'calc(var(--r-lg) * 1.2)',
        ...(frame ? {} : style),
      }}
    />
  );
  if (!frame) return img;
  return (
    <div className={`ls-frame ${className ?? ''}`} data-tilt style={style}>
      {img}
    </div>
  );
}

export function RtVideo({ url, className, style }: RtProps & { url: string }) {
  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--c-surface)', ...style }}
    >
      {url ? (
        <iframe
          src={url}
          title="Video"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          allowFullScreen
          loading="lazy"
        />
      ) : (
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--c-muted)' }}>
          Video unavailable
        </span>
      )}
    </div>
  );
}

export function RtDivider({ className, style }: RtProps) {
  return <hr className={className} style={{ border: 'none', borderTop: '1px solid var(--c-border)', width: '100%', margin: 0, ...style }} />;
}

export function RtSpacer({ size = 40, className, style }: RtProps & { size?: number }) {
  return <div aria-hidden className={className} style={{ height: size, ...style }} />;
}

export function RtBadge({ text, textZh, tone = 'accent', className, style }: RtProps & { text: string; textZh?: string | null; tone?: string }) {
  const bg = tone === 'accent' ? 'var(--c-accent)' : tone === 'primary' ? 'var(--c-primary)' : 'var(--c-border)';
  const color = tone === 'primary' ? 'var(--c-primary-fg)' : 'var(--c-text)';
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: bg,
        color,
        alignSelf: 'flex-start',
        ...style,
      }}
    >
      {loc(text, textZh)}
    </span>
  );
}

const GLYPHS: Record<string, string> = {
  check: 'M4 12.5l5 5L20 6.5',
  star: 'M12 3l2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.4 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z',
  phone: 'M5 4h4l2 5-2.5 1.5a12 12 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  clock: 'M12 7v5l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  pin: 'M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11zM14.6 10a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0z',
  spark: 'M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4',
  mail: 'M3 7l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
  car: 'M4 15l1.5-5A2 2 0 017.4 8.5h9.2a2 2 0 011.9 1.5L20 15M3 15h18v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3z',
  leaf: 'M4 20C4 10 10 4 20 4c0 10-6 16-16 16zM4 20c4-6 8-10 12-12',
  scissors: 'M8.2 7.6L20 19M8.2 16.4L20 5M8.5 6a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM8.5 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6L6 18',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  cart: 'M6 6h15l-1.7 8.5a2 2 0 01-2 1.5H9.3a2 2 0 01-2-1.6L5 3H2M9.5 21a1 1 0 100-2 1 1 0 000 2zM17.5 21a1 1 0 100-2 1 1 0 000 2z',
};

export function RtGlyph({ name, size = 18, color = 'var(--c-primary)' }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={GLYPHS[name] ?? GLYPHS.check} />
    </svg>
  );
}

export function RtListBlock({
  items,
  className,
  style,
}: RtProps & { items: { icon: string; title: string; desc: string; titleZh?: string; descZh?: string }[] }) {
  return (
    <ul className={className} style={{ display: 'flex', flexDirection: 'column', gap: 18, margin: 0, padding: 0, listStyle: 'none', ...style }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span
            style={{
              flexShrink: 0,
              width: 38,
              height: 38,
              borderRadius: 'var(--r-md)',
              background: 'var(--c-surface)',
              border: '1px solid var(--c-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RtGlyph name={it.icon} />
          </span>
          <span>
            <strong style={{ display: 'block', color: 'var(--c-text)', fontSize: 15.5 }}>
              {it.titleZh ? <LocText en={it.title} zh={it.titleZh} /> : it.title}
            </strong>
            <span style={{ color: 'var(--c-text-muted)', fontSize: 14 }}>
              {it.descZh ? <LocText en={it.desc} zh={it.descZh} /> : it.desc}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── layout ── */

/* Curated overlay tints + scrim builder — MUST match packages/components
   defs/layout.tsx sectionScrim() exactly so the canvas preview and this exported
   runtime render the identical text-on-image composition. */
const OVERLAY_TINTS: Record<string, [number, number, number]> = {
  dark: [10, 10, 10],
  espresso: [36, 22, 16],
  wine: [42, 13, 20],
  forest: [22, 36, 27],
  navy: [12, 22, 34],
  plum: [28, 16, 32],
  cream: [244, 240, 230],
};

/** the full-frame tint mobile substitutes for a directional scrim */
function mobileScrim(tintKey: string, strength: number): string {
  const [r, g, b] = OVERLAY_TINTS[tintKey] ?? OVERLAY_TINTS.dark;
  const s = Math.max(0, Math.min(1, strength / 100));
  const rgba = (a: number) => `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
  return `linear-gradient(to top, ${rgba(s)} 0%, ${rgba(s * 0.72)} 45%, ${rgba(s * 0.4)} 100%)`;
}

function sectionScrim(overlayStyle: string, tintKey: string, strength: number, contain: boolean): string | null {
  if (overlayStyle === 'none') return null;
  if (!overlayStyle || overlayStyle === 'auto') {
    return contain
      ? 'linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.4) 52%, rgba(0,0,0,0.62))'
      : 'linear-gradient(100deg, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.62) 26%, rgba(0,0,0,0.30) 50%, rgba(0,0,0,0.05) 72%, rgba(0,0,0,0) 88%), linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 34%, rgba(0,0,0,0) 56%), linear-gradient(to bottom, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 24%)';
  }
  const [r, g, b] = OVERLAY_TINTS[tintKey] ?? OVERLAY_TINTS.dark;
  const s = Math.max(0, Math.min(1, strength / 100));
  const rgba = (a: number) => `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
  switch (overlayStyle) {
    case 'full':
      return `linear-gradient(${rgba(s)}, ${rgba(s)})`;
    case 'soft':
      return `linear-gradient(${rgba(s * 0.5)}, ${rgba(s * 0.5)})`;
    case 'bottom':
      return `linear-gradient(to top, ${rgba(s)} 0%, ${rgba(s * 0.55)} 34%, ${rgba(0)} 78%)`;
    case 'top':
      // top-anchored copy needs a longer throw than 'bottom' (title stacks hang
      // down from the top) — hold near-full strength through the copy zone
      return `linear-gradient(to bottom, ${rgba(s)} 0%, ${rgba(s * 0.78)} 56%, ${rgba(0)} 92%)`;
    case 'left':
      // like 'top', the horizontal throws learned this the hard way: 40% 腰斬
      // + 82% 歸零讓桌機上跨到 ~53% 的文案欄外緣只剩 0.25s,亮照片上的眉標
      // 直接被洗掉(coffee-shop,目檢抓到)。撐滿文案區、留 0.12s 地板,再疊
      // 一層底部漸層保護低處的內文與按鈕。
      return `linear-gradient(to right, ${rgba(s)} 0%, ${rgba(s * 0.78)} 42%, ${rgba(s * 0.3)} 68%, ${rgba(s * 0.12)} 100%), linear-gradient(to top, ${rgba(s * 0.55)} 0%, ${rgba(0)} 38%)`;
    case 'right':
      return `linear-gradient(to left, ${rgba(s)} 0%, ${rgba(s * 0.78)} 42%, ${rgba(s * 0.3)} 68%, ${rgba(s * 0.12)} 100%), linear-gradient(to top, ${rgba(s * 0.55)} 0%, ${rgba(0)} 38%)`;
    default:
      return `linear-gradient(${rgba(s)}, ${rgba(s)})`;
  }
}

/** Translucent content panel — mirrors panelCss in defs/layout.tsx verbatim. */
function panelCss(kind: string): CSSProperties | null {
  if (kind !== 'glass' && kind !== 'dark') return null;
  const glass = kind === 'glass';
  return {
    background: glass ? 'rgba(255,255,255,0.55)' : 'rgba(12,12,12,0.55)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    color: glass ? '#141210' : '#fff',
    border: `1px solid rgba(255,255,255,${glass ? 0.6 : 0.14})`,
    borderRadius: 16,
    padding: '36px 40px',
  };
}

export function RtSection({
  contentWidth = 1160,
  fx,
  toneVars,
  bgImage,
  imageFit = 'cover',
  overlayStyle = 'auto',
  focal = '50% 42%',
  overlayColor = 'dark',
  overlayStrength = 68,
  textTone = 'light',
  contentPanel = '',
  reveal = true,
  lcp = false,
  className,
  style,
  children,
  id,
}: RtProps & {
  contentWidth?: number;
  id?: string;
  fx?: string;
  toneVars?: Record<string, string>;
  bgImage?: string;
  imageFit?: 'cover' | 'contain';
  overlayStyle?: string;
  /** cover-crop anchor ('x% y%') — faces and dishes stop getting chopped */
  focal?: string;
  overlayColor?: string;
  overlayStrength?: number;
  textTone?: string;
  contentPanel?: string;
  reveal?: boolean;
  /** codegen marks the page's FIRST photo section — its image IS the LCP */
  lcp?: boolean;
}) {
  const hasBg = !!bgImage;
  const contain = imageFit === 'contain';
  const scrim = sectionScrim(overlayStyle, overlayColor, overlayStrength, contain);
  // 'auto' opens with a 100deg directional sweep — below md it fails the same
  // way 'left'/'right' do (full-width copy runs onto the bright side). Its
  // mobile substitute is its own contain recipe: full-frame, heavy at both
  // ends, already designed for copy that may sit anywhere.
  const directionalScrim = overlayStyle === 'left' || overlayStyle === 'right';
  const autoScrim = !contain && (!overlayStyle || overlayStyle === 'auto');
  const textColor = textTone === 'dark' ? '#141210' : '#fff';
  return (
    <section
      id={id}
      className={className}
      style={{
        width: '100%',
        position: 'relative',
        overflow: fx || hasBg ? 'hidden' : undefined,
        ...(hasBg ? { color: textColor } : {}),
        ...(toneVars as CSSProperties | undefined),
        ...style,
      }}
    >
      {hasBg && (
        <>
          {/* contain-mode: a blurred zoom of the same photo fills the frame so a
              whole (uncropped) image never leaves ugly letterbox bars */}
          {contain && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bgImage} alt="" aria-hidden decoding="async" loading={lcp ? undefined : 'lazy'} className="ls-photo" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'var(--photo-grade) blur(28px) brightness(0.6)', transform: 'scale(1.12)', zIndex: 0 }} />
          )}
          {/* the photo itself — cover fills+crops; contain shows it whole (等比例).
              LCP section: high fetch priority; everything below the fold: lazy */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bgImage} alt="" decoding="async" {...(lcp ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })} className="ls-photo" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: contain ? 'contain' : 'cover', objectPosition: contain ? undefined : focal, zIndex: contain ? 1 : 0 }} />
          {/* customizable scrim so overlaid text stays legible; matches the canvas.

              Directional scrims ('left'/'right') protect the side the copy is
              anchored to — and below md the copy collapses to a full-width
              stack, so the darkened side and the text no longer share a side.
              A screenshot found a hero whose subtext sat on the photo's bright
              sky, unreadable, exactly there. On mobile the directional layer
              hides and a full bottom-weighted tint takes over. */}
          {scrim && (
            <div
              aria-hidden
              className={directionalScrim || autoScrim ? 'max-md:hidden' : undefined}
              style={{ position: 'absolute', inset: 0, background: scrim, zIndex: contain ? 2 : 1 }}
            />
          )}
          {(directionalScrim || autoScrim) && (
            <div aria-hidden className="md:hidden" style={{ position: 'absolute', inset: 0, background: autoScrim ? sectionScrim(overlayStyle, overlayColor, overlayStrength, true)! : mobileScrim(overlayColor, overlayStrength), zIndex: contain ? 2 : 1 }} />
          )}
        </>
      )}
      {/* fx as the background when there's no photo, or as an atmospheric overlay
          above the photo's scrim (zIndex 2, still under the content at zIndex 3) */}
      {fx && <RtFxBackground variant={fx} style={hasBg ? { zIndex: 2 } : undefined} />}
      <div
        className={reveal ? 'rv-stagger' : undefined}
        style={{ maxWidth: contentWidth, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, position: 'relative', zIndex: 3, ...panelCss(contentPanel) }}
      >
        {children}
      </div>
    </section>
  );
}

/** Decorative backdrop layer — aurora blobs, dot grid, film grain, noir light. */
export function RtFxBackground({ variant = 'aurora', className, style }: RtProps & { variant?: string }) {
  const layers: ReactNode[] = [];
  if (variant.includes('aurora')) layers.push(<div key="a" className="fx-layer fx-aurora" />);
  if (variant.includes('grid')) layers.push(<div key="g" className="fx-layer fx-grid" />);
  if (variant.includes('noise')) layers.push(<div key="n" className="fx-layer fx-noise" />);
  if (variant.includes('blinds')) layers.push(<div key="b" className="fx-layer fx-blinds" />);
  if (variant.includes('dusk')) layers.push(<div key="k" className="fx-layer fx-dusk" />);
  // cinematic backdrops
  if (variant.includes('starfield')) layers.push(<div key="sf" className="fx-layer fx-starfield" />);
  if (variant.includes('eventhorizon')) layers.push(<div key="eh" className="fx-layer fx-eventhorizon" />);
  if (variant.includes('scanlines')) layers.push(<div key="sl" className="fx-layer fx-scanlines" />);
  if (variant.includes('halftone')) layers.push(<div key="ht" className="fx-layer fx-halftone" />);
  if (variant.includes('speedlines')) layers.push(<div key="sp" className="fx-layer fx-speedlines" />);
  if (variant.includes('splitbeam')) layers.push(<div key="sb" className="fx-layer fx-splitbeam" />);
  if (variant.includes('heathaze')) layers.push(<div key="hz" className="fx-layer fx-heathaze" />);
    if (variant.includes('inkwash')) layers.push(<div key="inkwash" className="fx-layer fx-inkwash" />);
  if (variant.includes('rain')) layers.push(<div key="rn" className="fx-layer fx-rain" />);
  if (layers.length === 0) layers.push(<div key="d" className="fx-layer fx-aurora" />);
  return (
    <div aria-hidden className={`fx-wrap ${className ?? ''}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}>
      {layers}
    </div>
  );
}

export function RtContainer({ className, style, children }: RtProps) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function RtGridBox({ className, style, children }: RtProps) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function RtColumns({
  ratio = '1:1',
  align = 'start',
  className,
  style,
  children,
}: RtProps & { ratio?: string; align?: 'start' | 'center' | 'stretch' }) {
  const [a, b] = ratio.split(':').map(Number);
  return (
    <div
      className={`rt-columns ${className ?? ''}`}
      style={{
        display: 'grid',
        alignItems: align === 'center' ? 'center' : align === 'stretch' ? 'stretch' : 'start',
        ...style,
        ['--cols' as never]: `${a}fr ${b}fr` as never,
      }}
    >
      {children}
    </div>
  );
}

export function RtCardBox({ className, style, children }: RtProps) {
  return (
    <div className={className} style={{ borderRadius: 'var(--r-lg)', ...style }}>
      {children}
    </div>
  );
}

export function RtStickyBar({
  text,
  textZh,
  phone,
  className,
  style,
}: RtProps & { text: string; textZh?: string | null; phone: string }) {
  return (
    <div
      className={className}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '9px 16px',
        background: 'var(--c-secondary)',
        color: '#ffffff',
        fontSize: 13.5,
        fontWeight: 500,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      <span>{loc(text, textZh)}</span>
      <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--c-accent)', fontWeight: 700 }}>
        {phone}
      </a>
    </div>
  );
}
