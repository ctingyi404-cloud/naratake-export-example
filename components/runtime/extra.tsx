'use client';

/* Wave-2 runtime components. */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LocText, PlainLocText } from './loc-text';
import { apiGet, apiPost } from '@/lib/client';
import { money } from '@/lib/money';
import { site } from '@/lib/site-config';
import { useSiteLang } from '@/lib/site-i18n';
import { localePath } from '@/lib/locale-path';
import { RichText, type RichPalette } from '../richtext';
import { RtGlyph } from './basics';
import { useOptionalCart, useCartChromeClaim } from './ordering';
import { urlPath } from '@/lib/slug';
import { ctaZh } from '@/lib/cta-i18n';

type Sty = { className?: string; style?: CSSProperties };

/* twins of tableCols/tableRows/optionPairs in packages/components/src/defs — both
   surfaces must split a (possibly localized) list into the SAME cells */
function tableCols(columns: string): string[] {
  return String(columns ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
function tableRows(rows: string): string[][] {
  return String(rows ?? '')
    .split('\n')
    .filter(Boolean)
    .map((r) => r.split('|').map((s) => s.trim()));
}
function optionPairs(options: unknown, optionsZh: unknown): { v: string; zh?: string }[] {
  const zh = String(optionsZh ?? '').split(',').map((o) => o.trim());
  return String(options ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((v, i) => ({ v, zh: zh[i] || undefined }));
}

/** the site's own tokens, filling the roles the shared renderer asks for */
export const SITE_RICH: RichPalette = {
  heading: 'var(--f-head)',
  border: 'var(--c-border)',
  muted: 'var(--c-text-muted)',
  accent: 'var(--c-primary)',
  radius: 'var(--r-md)',
};

/* ── basics ── */

export function RtRichText({ text, textZh, className, style }: Sty & { text: string; textZh?: string | null }) {
  const { pick } = useSiteLang();
  return <RichText text={pick(text, textZh)} palette={SITE_RICH} className={className} style={style} />;
}

export function RtIconBadge({ icon = 'star', size = 44, className, style }: Sty & { icon?: string; size?: number }) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 'var(--r-md)',
        background: 'color-mix(in srgb, var(--c-primary) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--c-primary) 25%, transparent)',
        alignSelf: 'flex-start',
        ...style,
      }}
    >
      <RtGlyph name={icon} size={size * 0.5} />
    </span>
  );
}

export function RtLinkText({ text, textZh, href, className, style }: Sty & { text: string; textZh?: string | null; href?: string }) {
  const { pick } = useSiteLang();
  const destination = href?.trim() || undefined;
  const content = pick(text, ctaZh(text, textZh));
  const linkStyle = { textDecoration: 'underline', textUnderlineOffset: 3, alignSelf: 'flex-start', ...style };
  if (!destination) {
    return (
      <span aria-disabled="true" className={className} style={{ ...linkStyle, textDecoration: 'none', cursor: 'default' }}>
        {content}
      </span>
    );
  }
  return (
    <a className={className} href={destination} style={linkStyle}>
      {content}
    </a>
  );
}

export function RtAvatar({ src, alt = '', size = 72, shape = 'circle', className, style }: Sty & { src: string; alt?: string; size?: number; shape?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: shape === 'rounded' ? 'var(--r-md)' : 999, ...style }}
    />
  );
}

export function RtTableBlock({ columns, columnsZh, rows, rowsZh, className, style }: Sty & { columns: string; columnsZh?: string | null; rows: string; rowsZh?: string | null }) {
  const { pick } = useSiteLang();
  const cols = tableCols(pick(columns, columnsZh));
  const data = tableRows(pick(rows, rowsZh));
  return (
    <div className={className} style={{ overflowX: 'auto', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '2px solid var(--c-border)', fontSize: 13 }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: '10px 14px', borderBottom: '1px solid var(--c-border)', color: j === 0 ? 'var(--c-text)' : 'var(--c-text-muted)' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RtEmbed({ html, height = 320, className, style }: Sty & { html: string; height?: number }) {
  // An unconfigured Embed (still the default comment, or blank) must not show a stray
  // empty iframe to visitors — render nothing until real markup is provided.
  const hasContent = (html ?? '').replace(/<!--[\s\S]*?-->/g, '').trim().length > 0;
  if (!hasContent) return null;
  return (
    <iframe
      className={className}
      title="Embedded content"
      sandbox="allow-scripts allow-popups"
      srcDoc={html}
      style={{ width: '100%', height, border: 'none', borderRadius: 'var(--r-md)', ...style }}
      loading="lazy"
    />
  );
}

export function RtMarquee({ text, textZh, speed = 30, className, style }: Sty & { text: string; textZh?: string | null; speed?: number }) {
  const { pick } = useSiteLang();
  const chunk = `${pick(text, textZh)} `;
  return (
    <div
      className={className}
      style={{ overflow: 'hidden', whiteSpace: 'nowrap', padding: '16px 0', borderTop: '1px solid color-mix(in srgb, var(--c-text) 10%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--c-text) 10%, transparent)', ...style }}
    >
      <div
        className="font-heading mo-marquee-track"
        style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.02em', ['--marquee-s' as never]: `${speed}s` as never }}
      >
        <span style={{ opacity: 0.9 }}>{chunk.repeat(6)}</span>
        <span aria-hidden style={{ opacity: 0.9 }}>{chunk.repeat(6)}</span>
      </div>
    </div>
  );
}

/* ── layout ── */

export function RtTabsBox({ tabs = [], className, style, children }: Sty & { tabs?: { label: string; labelZh?: string }[]; children?: ReactNode }) {
  const [active, setActive] = useState(0);
  const kids = Array.isArray(children) ? children : [children];
  return (
    <div className={className} style={style}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--c-border)', marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            style={{
              padding: '10px 18px',
              fontSize: 14.5,
              fontWeight: 600,
              color: i === active ? 'var(--c-primary)' : 'var(--c-text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${i === active ? 'var(--c-primary)' : 'transparent'}`,
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            <PlainLocText en={t.label} zh={t.labelZh} />
          </button>
        ))}
      </div>
      {kids[active] ?? kids[0]}
    </div>
  );
}

export function RtAccordionBox({ titles = [], className, style, children }: Sty & { titles?: { title: string; titleZh?: string }[]; children?: ReactNode }) {
  const kids = Array.isArray(children) ? children : [children];
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {kids.map((child, i) => (
        <details key={i} open={i === 0} className="ls-card" style={{ padding: '14px 20px' }}>
          <summary className="ls-sum" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15.5 }}>{titles[i] ? <PlainLocText en={titles[i].title} zh={titles[i].titleZh} /> : `Section ${i + 1}`}</summary>
          <div style={{ marginTop: 12 }}>{child}</div>
        </details>
      ))}
    </div>
  );
}

/* ── navigation ── */

export function RtBreadcrumb({ current, currentZh, className, style }: Sty & { current: string; currentZh?: string | null }) {
  return (
    <nav className={className} aria-label="Breadcrumb" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--c-text-muted)', ...style }}>
      <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
        <LocText en="Home" zh="首頁" es="Inicio" />
      </a>
      <span style={{ opacity: 0.5 }}>/</span>
      <span style={{ color: 'var(--c-text)', fontWeight: 600 }}>
        <PlainLocText en={current} zh={currentZh} />
      </span>
    </nav>
  );
}

export function RtAnchorNav({ items = [], className, style }: Sty & { items?: { label: string; labelZh?: string; anchor: string }[] }) {
  const [active, setActive] = useState(0);
  return (
    <nav className={className} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', ...style }}>
      {items.map((it, i) => (
        <a
          key={i}
          href={`#${it.anchor}`}
          onClick={() => setActive(i)}
          style={{
            padding: '7px 16px',
            borderRadius: 999,
            fontSize: 13.5,
            fontWeight: 600,
            textDecoration: 'none',
            background: i === active ? 'var(--c-primary)' : 'var(--c-surface)',
            color: i === active ? 'var(--c-primary-fg)' : 'var(--c-text-muted)',
            border: `1px solid ${i === active ? 'var(--c-primary)' : 'var(--c-border)'}`,
          }}
        >
          <PlainLocText en={it.label} zh={it.labelZh} />
        </a>
      ))}
    </nav>
  );
}

export function RtSideMenu({ title, titleZh, className, style }: Sty & { title: string; titleZh?: string | null }) {
  const { lang } = useSiteLang();
  return (
    <nav className={`ls-card ${className ?? ''}`} style={{ padding: 18, minWidth: 200, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--c-text-muted)', marginBottom: 10 }}>
        <PlainLocText en={title} zh={titleZh} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {site.pages.slice(0, 6).map((p) => (
          <a key={p.slug} href={localePath(lang, p.slug)} style={{ padding: '8px 12px', borderRadius: 'var(--r-sm)', fontSize: 14, color: 'var(--c-text)', textDecoration: 'none' }}>
            {p.name}
          </a>
        ))}
      </div>
    </nav>
  );
}

/* ── forms ── */

export function RtRadioGroup({ label, labelZh, name, options, optionsZh, className, style }: Sty & { label: string; labelZh?: string | null; name: string; options: string; optionsZh?: string | null }) {
  const { pick } = useSiteLang();
  return (
    <div className={className} style={style}>
      <span className="ls-label">{pick(label, labelZh)}</span>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {optionPairs(options, optionsZh).map((o, i) => (
          <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
            <input type="radio" name={name} value={o.v} defaultChecked={i === 0} />
            {pick(o.v, o.zh)}
          </label>
        ))}
      </div>
    </div>
  );
}

export function RtTimeField({ label, labelZh, name, required, className, style }: Sty & { label: string; labelZh?: string | null; name: string; required?: boolean }) {
  const { pick } = useSiteLang();
  return (
    <label className={className} style={{ display: 'block', ...style }}>
      <span className="ls-label">
        {pick(label, labelZh)}
        {required && <span style={{ color: '#c0392b' }}> *</span>}
      </span>
      <input className="ls-input" type="time" name={name} required={required} />
    </label>
  );
}

export function RtFileField({ label, labelZh, name, accept = 'image/*', className, style }: Sty & { label: string; labelZh?: string | null; name: string; accept?: string }) {
  const { pick } = useSiteLang();
  const [fileName, setFileName] = useState('');
  return (
    <div className={className} style={style}>
      <span className="ls-label">{pick(label, labelZh)}</span>
      <label style={{ display: 'block', border: '2px dashed var(--c-border)', borderRadius: 'var(--r-md)', padding: 20, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13.5, cursor: 'pointer' }}>
        {/* the canvas says this in the reader's language; a hardcoded English
            string here made a Chinese form ship one English line */}
        {fileName || pick('Click or drop a file here', '點擊或拖放檔案', 'Haz clic o suelta un archivo aquí')}
        <input type="file" name={name} accept={accept} hidden onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
      </label>
    </div>
  );
}

/* ── business ── */

export function RtBeforeAfter({
  before,
  after,
  beforeLabel = 'Before',
  beforeLabelZh,
  afterLabel = 'After',
  afterLabelZh,
  className,
  style,
}: Sty & { before: string; after: string; beforeLabel?: string; beforeLabelZh?: string | null; afterLabel?: string; afterLabelZh?: string | null }) {
  const { pick } = useSiteLang();
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  function move(clientX: number) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100)));
  }

  return (
    <div
      ref={ref}
      className={className}
      onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
      onPointerDown={(e) => move(e.clientX)}
      style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 'var(--r-lg)', overflow: 'hidden', cursor: 'ew-resize', touchAction: 'none', userSelect: 'none', ...style }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={before} alt={pick(beforeLabel, beforeLabelZh)} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: `0 0 0 ${pos}%`, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={after}
          alt={pick(afterLabel, afterLabelZh)}
          draggable={false}
          style={{ position: 'absolute', top: 0, height: '100%', objectFit: 'cover', width: `${10000 / (100 - pos)}%`, maxWidth: 'none', left: `${-(pos / (100 - pos)) * 100}%` }}
        />
      </div>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, width: 3, background: '#fff', boxShadow: '0 0 10px rgba(0,0,0,0.4)' }} />
      <span style={{ position: 'absolute', top: '50%', left: `${pos}%`, transform: 'translate(-50%,-50%)', width: 36, height: 36, borderRadius: 999, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, boxShadow: '0 2px 10px rgba(0,0,0,0.3)', color: '#333' }}>
        ⇔
      </span>
      <span style={{ position: 'absolute', left: 12, bottom: 12, padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: 'rgba(0,0,0,0.55)', color: '#fff' }}>{pick(beforeLabel, beforeLabelZh)}</span>
      <span style={{ position: 'absolute', right: 12, bottom: 12, padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: 'rgba(0,0,0,0.55)', color: '#fff' }}>{pick(afterLabel, afterLabelZh)}</span>
    </div>
  );
}

export function RtGiftCardWidget({ heading, headingZh, className, style }: Sty & { heading: string; headingZh?: string | null }) {
  const { lang, pick } = useSiteLang();
  const [amount, setAmount] = useState(5000);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string; notified?: { email: boolean; sms: boolean } } | null>(null);
  const [error, setError] = useState('');
  // a captured charge whose /purchase failed — retries REUSE this intent so the
  // card is never charged twice for one gift card
  const captured = useRef<{ intentId: string; amountCents: number } | null>(null);

  async function buy() {
    setError('');
    if (!email) {
      setError(lang === 'es' ? 'Correo del destinatario obligatorio' : lang === 'zh' ? '請填寫收件 Email' : 'Recipient email required');
      return;
    }
    setBusy(true);
    try {
      let intentId: string;
      if (captured.current?.amountCents === amount) {
        intentId = captured.current.intentId;
      } else {
        // card reader first, THEN the charge — an intent minted before we knew
        // Stripe.js could load became an orphan in the merchant's dashboard
        const { cardUnavailable, collectStripePayment, siteStripeOrNull } = await import('./stripe-sheet');
        const stripe = await siteStripeOrNull(lang);
        const intent = await apiPost<{ provider: string; clientSecret: string; externalId: string }>(
          '/giftcards/intent',
          { amountCents: amount },
        );
        if (intent.provider === 'STRIPE') {
          if (!stripe) throw cardUnavailable(lang);
          const ok = await collectStripePayment(stripe, intent.clientSecret);
          if (!ok) {
            setBusy(false);
            return;
          }
        }
        intentId = intent.externalId;
        captured.current = { intentId, amountCents: amount };
      }
      const res = await apiPost<{ code: string; notified?: { email: boolean; sms: boolean } }>('/giftcards/purchase', {
        amountCents: amount,
        email,
        intentId,
      });
      captured.current = null;
      setDone(res);
    } catch (err) {
      // consumed/refunded intents can't be replayed — next attempt re-collects
      const code = (err as { code?: string }).code;
      if (code === 'PAYMENT_ALREADY_USED' || code === 'PAYMENT_REQUIRED') captured.current = null;
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 28, maxWidth: 520, ...style }}>
      <div
        style={{
          borderRadius: 'var(--r-lg)',
          padding: '26px 24px',
          marginBottom: 18,
          background: 'linear-gradient(120deg, var(--c-primary), color-mix(in srgb, var(--c-primary) 60%, var(--c-secondary)))',
          color: 'var(--c-primary-fg)',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.8 }}>Gift card</div>
        <div className="font-heading" style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{site.business.name}</div>
        <div style={{ marginTop: 16, fontFamily: 'monospace', letterSpacing: '0.2em', opacity: 0.85 }}>
          {done ? done.code : '•••• •••• ••••'}
        </div>
      </div>
      {done ? (
        <p className="ls-fade-up" style={{ margin: 0, fontSize: 14.5 }}>
          {/* "sent" only when email really sends: with no Resend key the mail is
              logged and dropped, and a gift bought FOR someone else would be lost
              unless the buyer is told to keep the code */}
          ✓ {done.notified?.email
            ? lang === 'es' ? '¡Tarjeta de regalo enviada! Código: ' : lang === 'zh' ? '禮品卡已寄出！代碼：' : 'Gift card sent! Code: '
            : lang === 'es' ? '¡Tarjeta creada! Guarda este código: ' : lang === 'zh' ? '禮品卡已建立,請保存這組代碼：' : 'Gift card created — keep this code: '}
          <strong style={{ color: 'var(--c-primary)' }}>{done.code}</strong>
        </p>
      ) : (
        <>
          <strong style={{ display: 'block', fontSize: 17, marginBottom: 12 }}>{heading}</strong>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[2500, 5000, 10000].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 'var(--r-md)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: amount === v ? 'var(--c-primary)' : 'var(--c-surface)',
                  color: amount === v ? 'var(--c-primary-fg)' : 'var(--c-text)',
                  border: `1px solid ${amount === v ? 'var(--c-primary)' : 'var(--c-border)'}`,
                }}
              >
                {money(v)}
              </button>
            ))}
          </div>
          <input aria-label={lang === 'es' ? 'Correo del destinatario' : lang === 'zh' ? '收件人 Email' : 'Recipient email'} className="ls-input" type="email" placeholder={lang === 'es' ? 'Correo del destinatario' : lang === 'zh' ? '收件人 Email' : 'Recipient email'} value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 12 }} />
          {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <button className="ls-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={buy}>
            {busy ? '…' : `${lang === 'es' ? 'Comprar tarjeta de regalo' : lang === 'zh' ? '購買禮品卡' : 'Buy gift card'} · ${money(amount)}`}
          </button>
        </>
      )}
    </div>
  );
}

export function RtLoyaltyWidget({ heading, headingZh, className, style }: Sty & { heading: string; headingZh?: string | null }) {
  const { lang, pick } = useSiteLang();
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<{ points: number } | null>(null);
  const [error, setError] = useState('');

  async function check() {
    setError('');
    setResult(null);
    try {
      const res = await apiPost<{ points: number }>('/loyalty/balance', { phone });
      setResult(res);
    } catch {
      setError(lang === 'es' ? 'No se encontró ningún miembro con ese número.' : lang === 'zh' ? '找不到這個號碼的會員資料。' : 'No member found for that number.');
    }
  }

  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 28, maxWidth: 520, ...style }}>
      <strong style={{ display: 'block', fontSize: 17 }}>{pick(heading, headingZh)}</strong>
      <p style={{ margin: '8px 0 16px', fontSize: 13.5, color: 'var(--c-text-muted)', lineHeight: 1.6 }}>
        {lang === 'es' ? 'Gana 1 punto por cada $1. Cada 100 puntos son $5 de descuento, canjéalos al pagar con tu número de teléfono.' : lang === 'zh' ? '消費 $1 累積 1 點，滿 100 點折抵 $5，結帳時輸入手機即可折抵。' : 'Earn 1 point per $1. Every 100 points is $5 off, redeem at checkout with your phone number.'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input aria-label={lang === 'es' ? 'Número de teléfono' : lang === 'zh' ? '手機號碼' : 'Phone number'} className="ls-input" style={{ flex: 1 }} placeholder={lang === 'es' ? 'Número de teléfono' : lang === 'zh' ? '手機號碼' : 'Phone number'} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="ls-btn ls-btn-outline" onClick={check}>
          {lang === 'es' ? 'Ver puntos' : lang === 'zh' ? '查詢點數' : 'Check points'}
        </button>
      </div>
      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: 10 }}>{error}</div>}
      {result && (
        <div className="ls-fade-up" style={{ marginTop: 16, display: 'flex', alignItems: 'baseline', gap: 8, padding: '14px 16px', borderRadius: 'var(--r-md)', background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)' }}>
          <span className="font-heading" style={{ fontSize: 30, fontWeight: 800 }}>{result.points}</span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>
            {lang === 'zh' ? `點 · 可折 ${money(Math.floor(result.points / 100) * 500)}` : `points · worth ${money(Math.floor(result.points / 100) * 500)} off`}
          </span>
        </div>
      )}
    </div>
  );
}

export function RtEventCalendar({ items = [], className, style }: Sty & { items?: { title: string; titleZh?: string; date: string; time: string; desc: string; descZh?: string }[] }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      {items.map((ev, i) => (
        <div key={i} className="ls-card" style={{ padding: 18, display: 'flex', gap: 18, alignItems: 'center' }}>
          <div style={{ flexShrink: 0, width: 64, textAlign: 'center', padding: '10px 0', borderRadius: 'var(--r-md)', background: 'color-mix(in srgb, var(--c-primary) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--c-primary) 22%, transparent)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--c-primary)' }}>{ev.date.split(',')[0]}</div>
            <div className="font-heading" style={{ fontSize: 18, fontWeight: 800 }}>{ev.date.replace(/[^0-9]/g, '').slice(-2) || '—'}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 15.5 }}><PlainLocText en={ev.title} zh={ev.titleZh} /></strong>
            <div style={{ fontSize: 12.5, color: 'var(--c-primary)', fontWeight: 600, margin: '2px 0 4px' }}>
              {ev.date} · {ev.time}
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-muted)' }}><PlainLocText en={ev.desc} zh={ev.descZh} /></p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface Post {
  slug: string;
  title: string;
  excerpt?: string | null;
  imageUrl?: string | null;
}

/* Cover band for posts without a photo: theme gradient + title initial. A
   deliberate branded device — never a broken <img> or a 404 fetch. */
function CoverBand({ title }: { title: string }) {
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        aspectRatio: '16 / 8',
        display: 'grid',
        placeItems: 'center',
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--c-primary) 16%, var(--c-surface)), color-mix(in srgb, var(--c-accent) 26%, var(--c-surface)))',
      }}
    >
      <span className="font-heading" style={{ fontSize: 44, fontWeight: 800, color: 'var(--c-primary)', opacity: 0.5 }}>
        {(title.trim().charAt(0) || '•').toUpperCase()}
      </span>
    </div>
  );
}

export function RtBlog({ initialData, className, style }: Sty & { initialData?: Post[] }) {
  const { lang } = useSiteLang();
  const [posts, setPosts] = useState<Post[]>(initialData ?? []);

  useEffect(() => {
    apiGet<{ posts: Post[] }>('/content/posts')
      /* An empty array from a live database IS the answer. This used to be
         `r.X.length && setX(...)`, so a merchant who deleted every row kept
         seeing the demo rows baked in at export — the delete worked, the site
         refused to show the truth. Only a network failure falls back, which is
         what .catch below is for. */
      .then((r) => setPosts(r.posts))
      .catch(() => {});
  }, []);

  return (
    <div className={className} style={style}>
      <div className="grid gap-5 md:grid-cols-2">
        {posts.slice(0, 6).map((p) => (
          // a real link (not a modal) so every article has its own indexable URL
          <a
            key={p.slug}
            href={localePath(lang, urlPath('posts', p.slug))}
            className="ls-card"
            aria-label={p.title}
            style={{ overflow: 'hidden', display: 'block', color: 'inherit', textDecoration: 'none' }}
          >
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" loading="lazy" decoding="async" className="ls-photo" style={{ width: '100%', aspectRatio: '16 / 8', objectFit: 'cover', display: 'block' }} />
            ) : (
              <CoverBand title={p.title} />
            )}
            <div style={{ padding: 20 }}>
              <strong className="font-heading" style={{ fontSize: 16.5 }}>{p.title}</strong>
              {p.excerpt && <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--c-text-muted)', lineHeight: 1.6 }}>{p.excerpt}</p>}
              <span style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 700, color: 'var(--c-primary)' }}>
                {lang === 'es' ? 'Leer más →' : lang === 'zh' ? '閱讀更多 →' : 'Read more →'}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export function RtCartButton({ label, labelZh, href, className, style }: Sty & { label: string; labelZh?: string | null; href?: string }) {
  const { lang, pick } = useSiteLang();
  const cart = useOptionalCart();
  useCartChromeClaim();
  const count = cart ? cart.lines.reduce((s, l) => s + l.qty, 0) : 0;
  return (
    <a
      // default to the page that really hosts the checkout — templates put
      // ordering at /shop etc., and a hardcoded /order 404s (audit modules#1)
      href={localePath(lang, href ?? site.orderPath ?? '/order')}
      className={`ls-btn ${className ?? ''}`}
      style={{ position: 'fixed', right: 22, bottom: 22, zIndex: 60, borderRadius: 999, boxShadow: '0 8px 24px color-mix(in srgb, var(--c-primary) 35%, transparent)', ...style }}
    >
      <RtGlyph name="cart" size={17} color="currentColor" /> {pick(label, ctaZh(label, labelZh))}
      {count > 0 && (
        <span
          aria-label={`${count} in cart`}
          style={{
            marginLeft: 8, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999,
            background: 'var(--c-primary-fg, #fff)', color: 'var(--c-primary)', fontSize: 12, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {count}
        </span>
      )}
    </a>
  );
}

export function RtItemDetailModal(_props: Sty) {
  // standalone showcase card is an editor-only preview; on the live site the
  // real modal opens from MenuList/OrderingWidget. Render nothing.
  return null;
}
