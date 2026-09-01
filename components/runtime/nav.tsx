'use client';

import { RtGlyph } from './basics';
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { apiPost } from '@/lib/client';
import { site, addressLine } from '@/lib/site-config';
import { useLiveBusiness } from '@/lib/business-client';
import { useSiteLang, secondaryLocale } from '@/lib/site-i18n';
import { localePath, stripLocale, type SiteLocale } from '@/lib/locale-path';
import { ctaZh } from '@/lib/cta-i18n';
import { brandGlyph } from './brand-glyphs';

const NAV_HIDDEN = new Set(['/privacy', '/terms']);

/* The other language, as a place rather than a setting.

   This used to flip a client-side flag: the words changed and the address did
   not, so a reader who found the Chinese page could not send it to anyone. Now
   it is a link, which is what makes the second language shareable, indexable
   and correct in `<html lang>` from the first byte.

   The href starts as that language's home page and becomes the equivalent of
   THIS page once mounted, because the server rendering `/menu` cannot ask the
   browser what the browser is showing — and guessing during SSR is a hydration
   mismatch. A crawler therefore follows a real link either way, and the exact
   pairing is what `hreflang` is for. */
export function LanguageToggle() {
  const { lang } = useSiteLang();
  const sec = secondaryLocale(); // 'zh' | 'es' | null
  const next = lang === 'en' ? sec : 'en';
  const [href, setHref] = useState(next ? localePath(next, '/') : '/');
  useEffect(() => {
    if (!next) return;
    const here = stripLocale(window.location.pathname).path;
    setHref(localePath(next, here) + window.location.search + window.location.hash);
  }, [next]);
  if (!sec || !next) return null;
  const label = lang === 'en' ? (sec === 'es' ? 'ES' : '中文') : 'EN';
  return (
    <a
      href={href}
      hrefLang={next === 'zh' ? 'zh-TW' : next === 'es' ? 'es-ES' : 'en-US'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textDecoration: 'none',
        padding: '6px 13px',
        minHeight: 32,
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 700,
        border: '1px solid var(--c-border)',
        background: 'var(--c-surface)',
        color: 'var(--c-text)',
        cursor: 'pointer',
      }}
      // accessible name must contain the visible label — WCAG 2.5.3
      aria-label={`${label} / switch language`}
      title="Switch language"
    >
      {label}
    </a>
  );
}

/* MIRROR of packages/components defs/nav.tsx NAV_LOGO_SIZES — the canvas twin
   cannot be imported from here, so both tables must change together. lg=34 is
   the ceiling: the condensed sticky header is 52/50px and must not grow. */
const NAV_LOGO_SIZES = {
  sm: { h: 22, w: 100 },
  md: { h: 26, w: 120 },
  lg: { h: 34, w: 160 },
} as const;

export function RtNavbar({
  brand,
  brandZh,
  ctaLabel,
  ctaLabelZh,
  ctaPageSlug,
  navStyle = 'floating',
  logoSize = 'md',
  sectionLinks,
  anchorLinks,
  className,
  style,
}: {
  brand: string;
  brandZh?: string | null;
  ctaLabel?: string;
  ctaLabelZh?: string | null;
  ctaPageSlug?: string;
  navStyle?: string;
  /** merchant-tunable logo box; the values live in NAV_LOGO_SIZES below */
  logoSize?: 'sm' | 'md' | 'lg';
  /* The second deck. A site whose content is organised into departments —
     a careers board's teams, a magazine's desks — navigates by those, not only
     by its pages, and eight tabs in one bar is how a platform's nav stops
     meaning anything. Baked by codegen from the same entries the canvas reads,
     so the row is in the HTML and never arrives late. */
  sectionLinks?: { label: string; href: string }[];
  /* A one-pager's main deck: the bar navigates one page by its sections
     instead of a site by its pages. Baked by codegen when the delivery is a
     single page; when present it REPLACES the pages row (the pages row would
     be a single 'Home' tab pointing at itself). */
  anchorLinks?: { label: string; labelZh?: string | null; href: string }[];
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const { lang, pick } = useSiteLang();
  const live = useLiveBusiness();
  /* Every internal address this bar renders, in the language the bar is in.

     The links are built here from site.config, not handed down as props, so
     nothing upstream could have prefixed them — and a nav that walks a reader
     out of the language they chose is how a second language stops being a
     place. localePath is idempotent, so a prop that arrived already prefixed
     passes through unharmed. */
  const lp = (h?: string | null) => localePath(lang, h);
  // the CTA button already IS the link to its target page — listing it again as
  // a nav item is redundant chrome (judged: "Order Online link + Order online button")
  const pages = (anchorLinks ?? []).length
    ? anchorLinks!.map((a) => ({ slug: a.href, name: a.label, nameZh: a.labelZh }))
    : site.pages
        .filter((p) => !p.hideFromNav && !NAV_HIDDEN.has(p.slug) && !(ctaLabel && p.slug === ctaPageSlug))
        .slice(0, 8)
        .map((p) => ({ slug: p.slug, name: p.name, nameZh: undefined as string | null | undefined }));
  // hydration-safe active-page detection (server renders no active state)
  const [path, setPath] = useState('');
  useEffect(() => setPath(stripLocale(window.location.pathname).path), []);
  // condensed chrome once the page scrolls — the bar tightens and gains presence
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  /* default = floating, except that a department deck settles the question: a
     glass pill has nowhere to hang a second row, so asking for one is asking
     for the bar that can carry it */
  const floating = navStyle !== 'classic' && !(sectionLinks ?? []).some((s) => s.label);
  // island: a detached glass capsule that hugs its content — mt-6 off the top,
  // fully round, no frosted band behind it (the sides ARE the aesthetic).
  // Opt-in per template; 'floating' stays the untouched default.
  const island = navStyle === 'island';
  const ctaHref = ctaPageSlug?.trim() ? lp(ctaPageSlug.trim()) : undefined;

  /* The mobile drawer is a modal surface, so it behaves like one: focus moves
     into it on open, Escape or a tap anywhere outside closes it, and focus
     returns to the hamburger on close (mobile-kbd#3). */
  const drawerId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // decided at close time, not in the cleanup: by then React has detached the
  // drawer, focus has already fallen back to <body>, and "was it inside?" can
  // no longer be asked
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    restoreFocus.current = true; // we are taking focus, so we owe it back
    drawer?.querySelector<HTMLElement>('a[href], button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (drawer?.contains(t) || toggleRef.current?.contains(t)) return;
      restoreFocus.current = false; // the user is aiming elsewhere; do not grab it back
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      if (restoreFocus.current) toggleRef.current?.focus();
    };
  }, [open]);

  const logo = site.business.logo ?? '';
  const logoDims = site.business.logoDims;
  const sz = NAV_LOGO_SIZES[logoSize] ?? NAV_LOGO_SIZES.md;
  /* The wordmark, when the wordmark IS the business name.

     `brand` arrives as a frozen string in the page source: fillProjectPlaceholders
     stamps it once at project creation and codegen bakes it into every emitted
     page's props, so renaming the business in the back office changed the footer
     and the title and left the header saying the old name. Swap it only when the
     baked prop still equals the baked business name — a merchant who typed a
     different wordmark ("Est. 1994", an abbreviation) meant that word, and the
     business name is not what they are asking for. */
  const liveName = live.name;
  const brandText = brand === site.business.name && liveName ? liveName : brand;
  const brandEl = (
    <a href={lp('/')} style={{ fontFamily: 'var(--f-head)', fontWeight: floating ? 750 : 700, fontSize: floating ? 18.5 : 19, letterSpacing: '-0.02em', color: 'var(--c-text)', whiteSpace: 'nowrap', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: floating || logo ? 9 : 0 }}>
      {/* The historical CLS trap here — fixed height, unknown width, brand name
          sliding right when the bytes land — is PAID when logoDims is present:
          the editor now captures the intrinsic size at upload and aspect-ratio
          reserves the true box. Logos uploaded before that have no dims and
          stay on the perf-budget ratchet, visibly, until re-uploaded. */}
      {logo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={logo} alt="" style={{ height: sz.h, maxWidth: sz.w, objectFit: 'contain', flexShrink: 0, ...(logoDims ? { aspectRatio: `${logoDims.w} / ${logoDims.h}` } : {}) }} />
        : floating && <span aria-hidden className="mo-pulse-dot" style={{ width: 9, height: 9, borderRadius: 99, background: 'linear-gradient(135deg, var(--g1), var(--g2))', flexShrink: 0 }} />}
      {pick(brandText, brandZh)}
    </a>
  );

  // display lives in the Tailwind utilities, not inline — an inline `display`
  // would beat `max-lg:hidden` and leak onto mobile
  const navEl = (
    <nav className="max-lg:hidden lg:flex" style={{ marginLeft: 'auto', gap: floating ? 4 : 26, alignItems: 'center' }}>
      {pages.map((p) => {
        const active = path === p.slug;
        return (
          <a
            key={p.slug}
            href={lp(p.slug)}
            className="ls-navlink"
            aria-current={active ? 'page' : undefined}
            data-active={!floating && active ? 'true' : undefined}
            style={
              floating
                ? { position: 'relative', padding: '7px 14px', borderRadius: 999, fontSize: 14, fontWeight: active ? 650 : 500, color: active ? 'var(--c-primary)' : 'var(--c-text-muted)', background: active ? 'color-mix(in srgb, var(--c-text) 7%, transparent)' : 'transparent', textDecoration: 'none', transition: 'background 150ms ease, color 150ms ease' }
                : { fontSize: 14.5, fontWeight: active ? 650 : 500, color: active ? 'var(--c-text)' : 'var(--c-text-muted)', textDecoration: 'none' }
            }
          >
            {pick(p.name, p.nameZh ?? ctaZh(p.name))}
            {floating && active && <span aria-hidden style={{ position: 'absolute', left: '50%', bottom: 3, width: 4, height: 4, marginLeft: -2, borderRadius: 99, background: 'var(--c-primary)' }} />}
          </a>
        );
      })}
    </nav>
  );

  const actions = (
    <div className="max-lg:hidden lg:flex" style={{ gap: 8, alignItems: 'center' }}>
      <LanguageToggle />
      {ctaLabel && (ctaHref ? (
        <a href={ctaHref} className="ls-btn" style={{ padding: '9px 20px', fontSize: 13.5 }}>
          {pick(ctaLabel, ctaZh(ctaLabel, ctaLabelZh))}
        </a>
      ) : (
        <span aria-disabled="true" className="ls-btn" style={{ padding: '9px 20px', fontSize: 13.5, cursor: 'default' }}>
          {pick(ctaLabel, ctaZh(ctaLabel, ctaLabelZh))}
        </span>
      ))}
    </div>
  );

  const hamburger = (
    <button
      ref={toggleRef}
      className="lg:hidden max-lg:flex"
      aria-label="Menu"
      aria-expanded={open}
      aria-controls={drawerId}
      onClick={() => setOpen(!open)}
      style={{ marginLeft: 'auto', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', fontSize: 22, background: 'none', border: 'none', color: 'var(--c-text)', cursor: 'pointer', padding: '0 10px' }}
    >
      <RtGlyph name={open ? 'x' : 'menu'} size={22} color="currentColor" />
    </button>
  );

  /* The second deck: departments under the bar, ruled off from it. It rides
     below the whole header rather than inside the pill because it belongs to
     the page, not to the floating chrome — and on a phone it scrolls sideways
     instead of wrapping into a four-line wall. */
  const deck = (sectionLinks ?? []).filter((s) => s.label);
  const deckEl = deck.length > 0 && (
    <nav
      aria-label={pick('Sections', '版面')}
      className="max-lg:hidden"
      style={{ borderTop: '1px solid color-mix(in srgb, var(--c-text) 8%, transparent)', background: 'var(--c-bg)' }}
    >
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px', display: 'flex', gap: 24, overflowX: 'auto' }}>
        {deck.map((s) => (
          <a
            key={s.href || s.label}
            href={s.href ? lp(s.href) : undefined}
            className="ls-navlink"
            style={{
              padding: '10px 0',
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--c-text)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );

  const drawer = open && (
    <div
      id={drawerId}
      ref={drawerRef}
      className="lg:hidden nav-drawer"
      style={{
        ...(floating
          ? { maxWidth: 1080, margin: '8px auto 0', borderRadius: 24, background: 'color-mix(in srgb, var(--c-surface) 92%, transparent)', backdropFilter: 'blur(18px)', border: '1px solid color-mix(in srgb, var(--c-text) 10%, transparent)', boxShadow: '0 20px 50px -20px rgba(0,0,0,0.35)', padding: '10px 20px 18px' }
          : { borderTop: '1px solid color-mix(in srgb, var(--c-text) 9%, transparent)', padding: '6px 24px 16px' }),
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {pages.map((p) => (
        <a key={p.slug} href={lp(p.slug)} style={{ padding: '12px 4px', fontSize: 16, fontWeight: 550, color: 'var(--c-text)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--c-text) 7%, transparent)' }}>
          {pick(p.name, p.nameZh ?? ctaZh(p.name))}
        </a>
      ))}
      {/* the second deck is desktop-only chrome; on a phone its links join the
          drawer, because a department a reader cannot reach is not navigation */}
      {deck.map((s) => (
        <a key={s.href || s.label} href={s.href ? lp(s.href) : undefined} style={{ padding: '12px 4px', fontSize: 13.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', textDecoration: 'none', borderBottom: '1px solid color-mix(in srgb, var(--c-text) 7%, transparent)' }}>
          {s.label}
        </a>
      ))}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <LanguageToggle />
        {ctaLabel && (ctaHref ? (
          <a href={ctaHref} className="ls-btn" style={{ flex: 1 }}>
            {pick(ctaLabel, ctaZh(ctaLabel, ctaLabelZh))}
          </a>
        ) : (
          <span aria-disabled="true" className="ls-btn" style={{ flex: 1, cursor: 'default' }}>
            {pick(ctaLabel, ctaZh(ctaLabel, ctaLabelZh))}
          </span>
        ))}
      </div>
    </div>
  );

  if (floating) {
    // header sticks at top:0 with a persistent 12px top pad (same resting offset
    // as the old top:12); once scrolled it becomes a frosted band so page content
    // never collides in the transparent gutters around the pill. Flow height is
    // constant: 12+60+0 resting = 12+52+8 scrolled.
    return (
      <header
        className={className}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: island ? (scrolled ? '14px 16px 8px' : '24px 16px 0') : scrolled ? '12px 16px 8px' : '12px 16px 0',
          background: !island && scrolled ? 'color-mix(in srgb, var(--c-bg) 90%, transparent)' : 'transparent',
          backdropFilter: !island && scrolled ? 'blur(10px)' : undefined,
          WebkitBackdropFilter: !island && scrolled ? 'blur(10px)' : undefined,
          borderBottom: `1px solid ${!island && scrolled ? 'color-mix(in srgb, var(--c-text) 7%, transparent)' : 'transparent'}`,
          transition: 'background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, padding 200ms ease',
          ...style,
        }}
      >
        {/* floating glass pill (island: content-hugging detached capsule) */}
        <div
          style={{
            ...(island ? { width: 'fit-content' } : { maxWidth: 1080 }),
            margin: '0 auto',
            padding: island ? '0 8px 0 20px' : '0 10px 0 22px',
            height: island ? (scrolled ? 50 : 56) : scrolled ? 52 : 60,
            display: 'flex',
            alignItems: 'center',
            gap: island ? 18 : 22,
            borderRadius: 999,
            background: `color-mix(in srgb, var(--c-surface) ${island ? (scrolled ? 92 : 75) : scrolled ? 90 : 72}%, transparent)`,
            backdropFilter: island ? 'blur(20px) saturate(1.6)' : 'blur(18px) saturate(1.4)',
            WebkitBackdropFilter: island ? 'blur(20px) saturate(1.6)' : 'blur(18px) saturate(1.4)',
            border: '1px solid color-mix(in srgb, var(--c-text) 10%, transparent)',
            boxShadow: scrolled
              ? '0 2px 8px rgba(0,0,0,0.07), 0 18px 44px -16px rgba(0,0,0,0.34)'
              : '0 2px 6px rgba(0,0,0,0.05), 0 14px 40px -18px rgba(0,0,0,0.3)',
            transition: 'height 200ms ease, background 200ms ease, box-shadow 200ms ease',
          }}
        >
          {brandEl}
          {navEl}
          {actions}
          {hamburger}
        </div>
        {drawer}
      </header>
    );
  }

  return (
    <header
      className={className}
      style={{ position: 'sticky', top: 0, zIndex: 50, background: 'color-mix(in srgb, var(--c-surface) 85%, transparent)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid color-mix(in srgb, var(--c-text) 9%, transparent)', boxShadow: scrolled ? '0 1px 8px rgba(0,0,0,0.08)' : 'none', transition: 'box-shadow 200ms ease', ...style }}
    >
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px', height: scrolled ? 58 : 66, display: 'flex', alignItems: 'center', gap: 28, transition: 'height 200ms ease' }}>
        {brandEl}
        {navEl}
        {actions}
        {hamburger}
      </div>
      {deckEl}
      {drawer}
    </header>
  );
}

/* compact newsletter capture above the footer's bottom rule — same POST as
   RtNewsletterSignup (/forms {kind:'newsletter'}), success swaps to a thank-you line */
function FooterSignup({ lang, center }: { lang: 'en' | 'zh' | 'es'; center?: boolean }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'err'>('idle');
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  // no customer list on this site means nothing to submit to — better no form
  // than one that eats what a visitor types
  if (!site.enabledModules.includes('customers')) return null;
  if (state === 'sent') {
    return (
      <p className="ls-fade-up" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#fff', textAlign: center ? 'center' : undefined }}>
        ✓ {t3('You are on the list!', '訂閱成功！', '¡Ya estás en la lista!')}
      </p>
    );
  }
  return (
    <div style={center ? { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '100%' } : undefined}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', marginBottom: 10 }}>
        {t3('Get offers & updates', '接收優惠與消息', 'Recibe ofertas y novedades')}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setState('busy');
          /* The server rejects a submission whose `website` came back filled —
             but it can only do that if the bait is on the page. This form had
             none: one email field, in the footer of every page, posting to the
             same endpoint the guarded contact form posts to. It is the easiest
             target on the site and what it fills is the merchant's mailing
             list, which they then pay to send to. */
          const bait = (e.currentTarget.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
          try {
            await apiPost('/forms', { kind: 'newsletter', email, website: bait });
            setState('sent');
          } catch {
            setState('err'); // a silent failure here quietly loses a subscriber
          }
        }}
        className="flex gap-2 max-md:flex-col"
        style={{ maxWidth: 440, width: '100%' }}
      >
        {/* off-screen rather than display:none — a bot that skips hidden fields
            still fills this one, and a screen reader is told to ignore it */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden />
        <input aria-label="you@email.com" className="ls-input" style={{ flex: 1, padding: '10px 14px' }} type="email" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="ls-btn" disabled={state === 'busy'} style={{ padding: '10px 20px', fontSize: 13.5 }}>
          {t3('Sign up', '訂閱', 'Suscribirme')}
        </button>
        {state === 'err' && (
          <span role="alert" style={{ color: '#ffb3ab', fontSize: 13, alignSelf: 'center' }}>
            {t3('Could not subscribe. Please try again.', '訂閱失敗，請再試一次。', 'No se pudo suscribir. Inténtalo de nuevo.')}
          </span>
        )}
      </form>
    </div>
  );
}

/* The legal strip already carries the copyright and, for regulated trades, the
   licence number — so the policies belong beside them, not in the page list
   above. That list is capped at 8 entries; a privacy policy that can be pushed
   out by an eighth marketing page is a privacy policy you do not have. */
function FooterLegalLinks({ lang }: { lang: SiteLocale }) {
  const docs = site.legalDocs ?? [];
  if (!docs.length) return null;
  return (
    <>
      {docs.map((d) => (
        <span key={d.slug}>
          {' · '}
          {/* localePath, like every other link in this file: a bare path here
              sent a reader of the zh tree back into the English one, and a
              privacy policy is the last place to lose someone's language. */}
          <a href={localePath(lang, `/legal/${d.slug}`)} style={{ color: 'inherit', textDecoration: 'none' }}>
            {lang === 'zh' ? LEGAL_ZH[d.slug] ?? d.title : d.title}
          </a>
        </span>
      ))}
    </>
  );
}
const LEGAL_ZH: Record<string, string> = { privacy: '隱私政策', terms: '使用條款', disclosures: '法定揭露' };

/* 頁尾的出處行。
 *
 * 這行字本來就在,只是一直是純文字 —— 我們每發佈一個站就送出一次品牌
 * 提及,卻一次連結都沒拿到。建站工具的成長迴圈就是這條:客戶的站連回來,
 * 排名上去,更多客戶,更多連結。Wix、Squarespace、Webflow、Linktree 都是
 * 這樣長起來的,而我們把它寫成了 <span>。
 *
 * 只有雲端發佈的站會變成連結(site.attribution,見 codegen 的
 * ExportProjectOptions):桌面版匯出與「下載你的程式碼」保持純文字 ——
 * 我們賣的就是「程式碼歸你、沒有鎖定」,在交出去的原始碼裡埋一條回連
 * 是自打嘴巴。商家自己寫了 credit 的,照他的,我們一個字都不加。
 */
function creditNode(
  credit: string | undefined,
  creditZh: string | null | undefined,
  lang: string,
  pick: (en: string, zh?: string | null) => string,
): ReactNode {
  const authored = pick(credit ?? '', creditZh);
  if (authored) return authored;
  const label = lang === 'es' ? 'Hecho con Naratake' : lang === 'zh' ? '由 Naratake 製作' : 'Built with Naratake';
  /* 關掉開關只拿掉連結,這行字留著 —— 這是產品決定,不是漏寫 return null。
     而且真的寫不得:site.attribution 是「這是雲端發佈」and「客戶沒關掉」
     壓成的一格(codegen index.ts 的 exportProject),runtime 分不出是哪一個
     讓它變 false,所以在這裡不 render 會連桌面匯出與「下載你的程式碼」
     那份本來就該有的純文字署名一起吃掉。要換掉這行字,填 credit 欄。 */
  if (!site.attribution) return label;
  return (
    <a
      href="https://naratake.com"
      target="_blank"
      rel="noopener"
      style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}
    >
      {label}
    </a>
  );
}

export function RtFooter({
  blurb,
  blurbZh,
  tagline,
  taglineZh,
  credit,
  creditZh,
  layout = 'columns',
  showSignup,
  className,
  style,
}: {
  blurb: string;
  blurbZh?: string | null;
  tagline?: string;
  taglineZh?: string | null;
  credit?: string;
  creditZh?: string | null;
  layout?: 'columns' | 'center';
  showSignup?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { lang, pick } = useSiteLang();
  // the footer mirrors the nav, so it mirrors the nav's language too
  const lp = (h?: string | null) => localePath(lang, h);
  /* Baked first, live second. The server renders the published details — which
     is what a crawler reads and what the page shows before hydration — and the
     browser upgrades them to whatever the back office says now. Fields the
     merchant has never touched resolve to the identical baked value, so an
     untouched site swaps nothing. */
  const b = useLiveBusiness();
  // footer defaults to mirroring the top nav, but a page can opt to appear only
  // here (legal/terms) by setting hideFromNav without hideFromFooter.
  const pages = site.pages.filter((p) => !(p.hideFromFooter ?? p.hideFromNav)).slice(0, 8);
  // only real, configured links on the exported site — no dead placeholder icons
  const links = Object.entries(b.socials ?? {}).filter(([, url]) => url);
  const phoneTarget = b.phone.replace(/[^+\d]/g, '');
  const phoneHref = phoneTarget ? `tel:${phoneTarget}` : null;
  const emailHref = b.email ? `mailto:${b.email}` : null;
  const onDark = (a: number) => `color-mix(in srgb, #ffffff ${a}%, transparent)`;
  const label: CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-accent)', marginBottom: 16 };
  const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14.5 };
  // padded so each link clears the 24px minimum touch target (WCAG 2.2 SC 2.5.8)
  // tone travels as --fl so globals.css `footer a:hover` can actually win —
  // an inline `color` would out-specify the hover rule (the old dead-hover bug)
  const footLink = (tone: string): CSSProperties =>
    ({ textDecoration: 'none', padding: '3px 0', display: 'inline-block', '--fl': tone }) as CSSProperties;
  // centered stacked footer — an editorial alternative so two sites never share
  // the same closing structure (brand + blurb centered, links in one row)
  if (layout === 'center') {
    return (
      <footer className={className} style={{ background: 'var(--c-secondary)', color: onDark(78), ...style }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '64px 24px 34px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 18 }}>
          <span style={{ fontFamily: 'var(--f-head)', fontWeight: 700, fontSize: 28, color: '#fff', lineHeight: 1.1 }}>{b.name}</span>
          {tagline ? <span style={{ fontSize: 14, color: onDark(45) }}>{pick(tagline, taglineZh)}</span> : null}
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, maxWidth: '46ch', color: onDark(64) }}>{pick(blurb, blurbZh)}</p>
          <nav style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 26px', fontSize: 14, fontWeight: 550 }}>
            {pages.map((p) => (
              <a key={p.slug} href={lp(p.slug)} style={footLink(onDark(82))}>
                {pick(p.name, ctaZh(p.name))}
              </a>
            ))}
          </nav>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', gap: '4px 10px', fontSize: 13.5, color: onDark(60) }}>
            <span>{addressLine(b.address)}</span>
            {phoneHref ? <><span aria-hidden>·</span><a href={phoneHref} style={footLink(onDark(72))}>{b.phone}</a></> : null}
            {emailHref ? <><span aria-hidden>·</span><a href={emailHref} style={footLink(onDark(72))}>{b.email}</a></> : null}
            <span aria-hidden>·</span>
            <a href="/admin" style={footLink(onDark(50))}>{lang === 'es' ? 'Acceso comercio' : lang === 'zh' ? '商家登入' : 'Merchant login'}</a>
          </div>
          {links.length > 0 && (
            <div style={{ display: 'flex', gap: 12 }}>
              {links.map(([id, url]) => (
                <a key={id} href={url} target="_blank" rel="noopener noreferrer" aria-label={id} title={id} className="ls-social" style={{ '--sb': onDark(24), '--sc': onDark(85) } as CSSProperties}>
                  {brandGlyph(id, 18)}
                </a>
              ))}
            </div>
          )}
        </div>
        {showSignup && (
          <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 24px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <FooterSignup lang={lang} center />
          </div>
        )}
        <div style={{ borderTop: `1px solid ${onDark(12)}`, maxWidth: 880, margin: '0 auto', padding: '18px 24px', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', fontSize: 12.5, color: onDark(48) }}>
          <span>© {new Date().getFullYear()} {b.name}. {lang === 'es' ? 'Todos los derechos reservados.' : lang === 'zh' ? '版權所有。' : 'All rights reserved.'}{b.license?.number && <> · {b.license.authority ? `${b.license.authority} ` : ''}{b.license.number}</>}<FooterLegalLinks lang={lang} /></span>
          <span>{creditNode(credit, creditZh, lang, pick)}</span>
        </div>
      </footer>
    );
  }
  return (
    <footer className={className} style={{ background: 'var(--c-secondary)', color: onDark(78), ...style }}>
      <div
        className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr] gap-x-6 gap-y-9 md:gap-14"
        style={{ maxWidth: 1200, margin: '0 auto', padding: '56px 24px 30px' }}
      >
        {/* brand spans the full width on a phone; the two link columns sit
            side by side beneath it (like the tablet), never fully stacked */}
        <div className="col-span-2 md:col-span-1">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--f-head)', fontWeight: 700, fontSize: 26, color: '#fff', lineHeight: 1.1 }}>{b.name}</span>
            {tagline ? <span style={{ fontSize: 14, color: onDark(45) }}>{pick(tagline, taglineZh)}</span> : null}
          </div>
          <p style={{ margin: '16px 0 22px', fontSize: 14.5, lineHeight: 1.7, maxWidth: '40ch', color: onDark(64) }}>{pick(blurb, blurbZh)}</p>
          <div style={{ display: 'flex', gap: 12 }}>
            {links.map(([id, url]) => (
              <a
                key={id}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={id}
                title={id}
                className="ls-social"
                style={{ '--sb': onDark(24), '--sc': onDark(85) } as CSSProperties}
              >
                {brandGlyph(id, 18)}
              </a>
            ))}
          </div>
        </div>
        <div>
          <div style={label}>{lang === 'es' ? 'Explorar' : lang === 'zh' ? '瀏覽' : 'Explore'}</div>
          <div style={col}>
            {pages.map((p) => (
              <a key={p.slug} href={lp(p.slug)} style={footLink(onDark(80))}>
                {pick(p.name, ctaZh(p.name))}
              </a>
            ))}
          </div>
        </div>
        <div>
          <div style={label}>{lang === 'es' ? 'Visítanos' : lang === 'zh' ? '聯絡我們' : 'Visit us'}</div>
          <div style={{ ...col, color: onDark(70) }}>
            <span>{addressLine(b.address)}</span>
            {phoneHref ? <a href={phoneHref} style={footLink(onDark(80))}>{b.phone}</a> : null}
            {emailHref ? <a href={emailHref} style={footLink(onDark(80))}>{b.email}</a> : null}
            <a href="/admin" style={footLink(onDark(55))}>{lang === 'es' ? 'Acceso comercio' : lang === 'zh' ? '商家登入' : 'Merchant login'}</a>
          </div>
        </div>
      </div>
      {showSignup && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 28px' }}>
          <FooterSignup lang={lang} />
        </div>
      )}
      <div
        style={{
          borderTop: `1px solid ${onDark(12)}`,
          maxWidth: 1200,
          margin: '0 auto',
          padding: '20px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: 'space-between',
          fontSize: 12.5,
          color: onDark(48),
        }}
      >
        <span>© {new Date().getFullYear()} {b.name}. {lang === 'es' ? 'Todos los derechos reservados.' : lang === 'zh' ? '版權所有。' : 'All rights reserved.'}{b.license?.number && <> · {b.license.authority ? `${b.license.authority} ` : ''}{b.license.number}</>}<FooterLegalLinks lang={lang} /></span>
        <span>{creditNode(credit, creditZh, lang, pick)}</span>
      </div>
    </footer>
  );
}
