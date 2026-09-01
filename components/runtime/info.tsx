'use client';

/* Informational components. Client components that hydrate live data over
   their baked-in initial props. */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BodyPortal } from './BodyPortal';
import { LocText, PlainLocText } from './loc-text';
import { apiGet } from '@/lib/client';
import { money } from '@/lib/money';
import { addressLine, mapQueryFor, site } from '@/lib/site-config';
import { useLiveBusiness } from '@/lib/business-client';
import { useSiteLang } from '@/lib/site-i18n';
import { RtBtnArrow, RtGlyph } from './basics';
import { brandGlyph } from './brand-glyphs';
import { useDialogFocus } from './ordering';
import { ctaZh } from '@/lib/cta-i18n';

type Sty = { className?: string; style?: CSSProperties };

/* twin of featureLines in packages/components/src/defs/business-info.tsx — both
   surfaces must split a (possibly localized) feature list into the same rows */
function featureLines(features: string): string[] {
  return String(features ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const DAY_LABELS: Record<string, [string, string]> = {
  mon: ['Monday', '週一'],
  tue: ['Tuesday', '週二'],
  wed: ['Wednesday', '週三'],
  thu: ['Thursday', '週四'],
  fri: ['Friday', '週五'],
  sat: ['Saturday', '週六'],
  sun: ['Sunday', '週日'],
};

export function RtBusinessHours({ className, style }: Sty) {
  const { lang } = useSiteLang();
  /* This component invented the bake-then-upgrade pattern here, with its own
     private fetch of /business. It now shares the one lib/business-client.ts
     runs for the whole page — same behaviour, one request instead of one per
     component now that the footer and the navbar ask the same question. */
  const hours = useLiveBusiness().hours;
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  // computed after mount only — calling new Date() in render would bake the build
  // day's "today" into the static HTML and highlight the wrong row until the fetch lands
  const [todayKey, setTodayKey] = useState<(typeof keys)[number] | null>(null);
  useEffect(() => { setTodayKey(keys[(new Date().getDay() + 6) % 7]); }, []);
  return (
    // flex fills the column when paired with the map at equal height
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 24, flex: '1 1 auto', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <RtGlyph name="clock" />
        <strong style={{ fontSize: 16 }}>{lang === 'es' ? 'Horario' : lang === 'zh' ? '營業時間' : 'Opening hours'}</strong>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          {keys.map((k) => {
            const spans = hours[k];
            const isToday = k === todayKey;
            return (
              <tr key={k} style={isToday ? { background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)' } : undefined}>
                <td style={{ padding: '7px 10px', fontWeight: isToday ? 700 : 500 }}>
                  {lang === 'zh' ? DAY_LABELS[k][1] : DAY_LABELS[k][0]}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--c-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {spans && spans.length ? spans.map(([o, cl]) => `${o} – ${cl}`).join(', ') : lang === 'es' ? 'Cerrado' : lang === 'zh' ? '公休' : 'Closed'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** `query` overrides the pin — a property page maps the PROPERTY, not the
    brokerage office. Default keeps every existing site exactly where it was. */
export function RtMapCard({ query, className, style }: Sty & { query?: string }) {
  const { lang } = useSiteLang();
  // the pin and the caption follow a move; see lib/business-client.ts
  const b = useLiveBusiness();
  const place = query || mapQueryFor(b.address);
  if (!place) return null;
  const q = encodeURIComponent(place);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  // A real interactive map shows out of the box via Google's keyless embed;
  // setting NEXT_PUBLIC_GOOGLE_MAPS_KEY upgrades to the official Embed API.
  const src = key
    ? `https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}`
    : `https://maps.google.com/maps?q=${q}&z=15&hl=en&output=embed`;
  return (
    // flex column: the map pane grows so the card can match its neighbour's height
    <div className={`ls-card ${className ?? ''}`} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: '1 1 auto', ...style }}>
      {/* The Google embed is shown in its own colours. It used to be greyscaled
          and washed with --c-primary at 50% mix-blend-mode:color, which read as
          a brand touch on cool palettes and as a sepia print on warm ones — and
          in every case it destroyed the colour coding a map is FOR: parks, water
          and roads all collapsed to one hue. A map is an instrument, not brand
          photography; the card frame and caption around it carry the brand. */}
      <div style={{ position: 'relative', isolation: 'isolate', display: 'flex', flex: '1 1 240px', minHeight: 240 }}>
        {/* iframe 後面的地面層:Google 的 keyless embed 在無頭環境、被擋
            cookie 或間歇性限流時整塊不畫,卡片就是一個白洞(長條圖抓到,
            訪客端也可能發生)。地面層畫一個有意圖的「地圖感」面板 —— 淡格
            線 + 圓形大頭針;embed 一載入就整片蓋掉,零成本的優雅降級。 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background:
              'repeating-linear-gradient(0deg, transparent 0 31px, color-mix(in srgb, var(--c-text) 7%, transparent) 31px 32px), repeating-linear-gradient(90deg, transparent 0 31px, color-mix(in srgb, var(--c-text) 7%, transparent) 31px 32px), var(--c-surface)',
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: '50% 50% 50% 0',
              transform: 'rotate(-45deg)',
              background: 'var(--c-primary)',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 8px 20px color-mix(in srgb, var(--c-primary) 35%, transparent)',
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--c-primary-fg)' }} />
          </span>
        </div>
        <iframe
          title={`Map — ${query || b.name}`}
          src={src}
          style={{ width: '100%', border: 0, display: 'block', flex: 1, position: 'relative' }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* the caption must name whatever the pin is on: with a query set, the
              map is a property and printing the office address under it says the
              map is somewhere it is not */}
          <strong style={{ display: 'block', marginBottom: 4 }}>{query || b.name}</strong>
          {!query && (
            <span style={{ color: 'var(--c-text-muted)', fontSize: 14 }}>
              {/* addressLine, not a template string: an agent with no office
                  street address printed a caption that opened with a comma */}
              {addressLine(b.address)}
            </span>
          )}
        </div>
        <a
          href={`https://maps.google.com/?q=${q}`}
          target="_blank"
          rel="noopener"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--c-border)', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, color: 'var(--c-primary)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {lang === 'es' ? 'Abrir en Maps' : lang === 'zh' ? '在地圖開啟' : 'Open in Maps'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
        </a>
      </div>
    </div>
  );
}

export function RtGallery({
  images,
  cols = 3,
  className,
  style,
}: Sty & { images: { src: string; caption: string; captionZh?: string }[]; cols?: number }) {
  const { pick } = useSiteLang();
  const [lightbox, setLightbox] = useState<number | null>(null);
  return (
    <>
      <div className={`cin-grid ${className ?? ''}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14, ...style }}>
        {images.map((im, i) => (
          // a real <button> so the lightbox opens with keyboard (Enter/Space), with an accessible name
          <button
            key={i}
            type="button"
            onClick={() => setLightbox(i)}
            aria-label={pick(im.caption, im.captionZh) || `Photo ${i + 1}`}
            style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', display: 'block' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={im.src}
              alt={pick(im.caption, im.captionZh) || `Photo ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="ls-photo"
              style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--r-md)', display: 'block' }}
            />
          </button>
        ))}
      </div>
      {lightbox !== null && <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} onNav={setLightbox} />}
    </>
  );
}

const lightNavBtn: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.4)',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  fontSize: 16,
  cursor: 'pointer',
};

/* Caption + prev/next mirror the editor preview's lightbox (LiveMisc.tsx) —
   merchant captions ship, and a gallery browses without reopening. */
function Lightbox({
  images,
  index,
  onClose,
  onNav,
}: {
  images: { src: string; caption: string }[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  const image = images[index];
  return (
    <BodyPortal>
    <div
      ref={ref}
      tabIndex={-1}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.caption || 'Photo'}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 24, outline: 'none' }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <RtGlyph name="x" size={18} color="currentColor" />
      </button>
      {/* The lightbox: a position:fixed overlay that exists only after the
          reader clicks a thumbnail. Out of the document flow, so it cannot move
          the page under them, and its size is the photo's own — which is the
          point of opening it: cls-ok */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src} alt={image.caption || ''} style={{ maxWidth: '92vw', maxHeight: '82vh', borderRadius: 12 }} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: '#fff', fontSize: 13.5 }}>
        <button
          type="button"
          aria-label="Previous photo"
          onClick={(e) => { e.stopPropagation(); onNav((index - 1 + images.length) % images.length); }}
          style={lightNavBtn}
        >
          ←
        </button>
        <span>{image.caption || `${index + 1} / ${images.length}`}</span>
        <button
          type="button"
          aria-label="Next photo"
          onClick={(e) => { e.stopPropagation(); onNav((index + 1) % images.length); }}
          style={lightNavBtn}
        >
          →
        </button>
      </div>
    </div>
  </BodyPortal>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} style={{ color: 'var(--c-accent)', letterSpacing: 2 }}>
      {'★'.repeat(rating)}
      <span style={{ opacity: 0.25 }}>{'★'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

export function RtTestimonials({
  items,
  className,
  style,
}: Sty & { items: { author: string; authorZh?: string; text: string; textZh?: string; rating: number }[] }) {
  return (
    <div className={`grid gap-5 md:grid-cols-3 ${className ?? ''}`} style={style}>
      {items.map((it, i) => (
        <figure key={i} className="ls-card ls-quote" style={{ padding: 26, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Stars rating={it.rating ?? 5} />
          <blockquote style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6 }}>
            <PlainLocText en={it.text} zh={it.textZh} />
          </blockquote>
          <figcaption style={{ color: 'var(--c-text-muted)', fontSize: 13.5, fontWeight: 600 }}>— <PlainLocText en={it.author} zh={it.authorZh} /></figcaption>
        </figure>
      ))}
    </div>
  );
}

interface Review {
  id?: string;
  authorName: string;
  rating: number;
  text: string | null;
}

export function RtReviewsFeed({ initialData, readOnly, className, style }: Sty & { initialData?: Review[]; readOnly?: boolean }) {
  const { lang } = useSiteLang();
  const [reviews, setReviews] = useState<Review[]>(initialData ?? []);
  const [writing, setWriting] = useState(false);
  const [form, setForm] = useState({ authorName: '', rating: 5, text: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet<{ reviews: Review[] }>('/reviews')
      /* An empty array from a live database IS the answer. This used to be
         `r.X.length && setX(...)`, so a merchant who deleted every row kept
         seeing the demo rows baked in at export — the delete worked, the site
         refused to show the truth. Only a network failure falls back, which is
         what .catch below is for. */
      .then((r) => setReviews(r.reviews))
      .catch(() => {});
  }, []);

  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // guard against double-submit
    setBusy(true);
    setErr('');
    try {
      const { apiPost } = await import('@/lib/client');
      await apiPost('/reviews', form);
      setSent(true);
    } catch {
      setErr(lang === 'es' ? 'No se pudo enviar. Inténtalo de nuevo.' : lang === 'zh' ? '送出失敗,請再試一次。' : 'Could not submit. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        {reviews.length > 0 ? (
          <>
            <span className="font-heading" style={{ fontSize: 44, fontWeight: 800 }}>{avg.toFixed(1)}</span>
            <div>
              <Stars rating={Math.round(avg)} />
              <div style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
                {reviews.length} {lang === 'es' ? 'reseñas verificadas' : lang === 'zh' ? '則真實評論' : 'verified reviews'}
              </div>
            </div>
          </>
        ) : (
          // no reviews yet → an honest empty prompt, never a fabricated 5.0
          <div style={{ color: 'var(--c-text-muted)', fontSize: 15 }}>
            {lang === 'es' ? 'Sé el primero en dejar una reseña.' : lang === 'zh' ? '成為第一個留下評論的人。' : 'Be the first to leave a review.'}
          </div>
        )}
        {/* A storefront build has no database to store a submission in, so the
            invitation is withheld rather than offered and then refused. */}
        {!readOnly && (
          <button className="ls-btn-outline ls-btn" style={{ marginLeft: 'auto', padding: '8px 16px', fontSize: 13 }} onClick={() => setWriting(!writing)}>
            {lang === 'es' ? 'Escribir reseña' : lang === 'zh' ? '寫評論' : 'Write a review'}
          </button>
        )}
      </div>
      {writing && !sent && !readOnly && (
        <form onSubmit={submit} className="ls-card ls-fade-up" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input required aria-label={lang === 'es' ? 'Tu nombre' : lang === 'zh' ? '你的名字' : 'Your name'} placeholder={lang === 'es' ? 'Tu nombre' : lang === 'zh' ? '你的名字' : 'Your name'} className="ls-input" value={form.authorName} onChange={(e) => setForm({ ...form, authorName: e.target.value })} />
            <select aria-label={lang === 'es' ? 'Calificación' : lang === 'zh' ? '評分' : 'Rating'} className="ls-input" style={{ width: 110 }} value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{'★'.repeat(n)}</option>
              ))}
            </select>
          </div>
          <textarea required aria-label={lang === 'es' ? 'Tu reseña' : lang === 'zh' ? '你的評論' : 'Your review'} rows={3} placeholder={lang === 'es' ? 'Comparte tu experiencia…' : lang === 'zh' ? '分享你的體驗…' : 'Share your experience…'} className="ls-input" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          {err && <div style={{ color: '#e5484d', fontSize: 13 }}>{err}</div>}
          <button className="ls-btn" disabled={busy} style={{ alignSelf: 'flex-start', opacity: busy ? 0.6 : 1 }}>
            {busy ? (lang === 'es' ? 'Enviando…' : lang === 'zh' ? '送出中…' : 'Sending…') : lang === 'es' ? 'Enviar' : lang === 'zh' ? '送出' : 'Submit'}
          </button>
        </form>
      )}
      {sent && (
        <div className="ls-card" style={{ padding: 16, fontSize: 14, color: 'var(--c-text-muted)' }}>
          {lang === 'es' ? '¡Gracias! Tu reseña aparecerá una vez aprobada.' : lang === 'zh' ? '謝謝！你的評論將在審核後顯示。' : 'Thanks! Your review will appear once approved.'}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {reviews.slice(0, 6).map((r, i) => (
          <div key={r.id ?? i} className="ls-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 14.5 }}>{r.authorName}</strong>
              <Stars rating={r.rating} />
            </div>
            <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14, lineHeight: 1.6 }}>{r.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface StaffLite {
  id?: string;
  name: string;
  role?: string | null;
  bio?: string | null;
  /** merchant-uploaded photo (from the admin backoffice) */
  photoUrl?: string | null;
  /** baked generic portrait — only present for seeded staff (emit) */
  imageUrl?: string;
  /* how a visitor reaches this person, and what qualifies them. Every one of
     these must also appear in the /appointments/staff projection, or the card
     renders it server-side and then loses it when the client fetch lands. */
  email?: string | null;
  phone?: string | null;
  license?: string | null;
  areas?: string[] | null;
  languages?: string[] | null;
  socials?: Record<string, string> | null;
}

/** real photo wins; seeded staff keep their baked art; anyone else (or a dead
    image path) gets an initial disc — never a broken <img> */
function TeamPortrait({ staff }: { staff: StaffLite }) {
  const src = staff.photoUrl || staff.imageUrl;
  const [broken, setBroken] = useState(false);
  const disc: CSSProperties = { width: 96, height: 96, borderRadius: 999, margin: '0 auto 14px' };
  if (src && !broken) {
    // `disc` is a hard 96x96 above, shared with the initial-letter fallback so
    // the row holds its height whichever one renders. cls-ok
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={staff.name} loading="lazy" decoding="async" onError={() => setBroken(true)} className="ls-photo" style={{ ...disc, objectFit: 'cover' }} />;
  }
  return (
    <div aria-hidden style={{ ...disc, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--c-primary) 14%, transparent)', color: 'var(--c-primary)', fontSize: 36, fontWeight: 700 }}>
      {(staff.name.trim()[0] ?? '?').toUpperCase()}
    </div>
  );
}

export function RtTeamCards({ initialData, className, style }: Sty & { initialData?: StaffLite[] }) {
  const [staff, setStaff] = useState<StaffLite[]>(initialData ?? []);
  useEffect(() => {
    apiGet<{ staff: StaffLite[] }>('/appointments/staff')
      .then((r) => {
        if (!r.staff.length) return;
        // the API knows photoUrl but not the baked art — reattach it by name so
        // seeded members keep their portrait while admin-added ones get the disc
        const baked = new Map((initialData ?? []).map((s) => [s.name, s.imageUrl]));
        setStaff(r.staff.map((s) => ({ ...s, imageUrl: baked.get(s.name) })));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cols = Math.min(Math.max(staff.length, 1), 4);
  return (
    <div className={`grid gap-5 max-md:!grid-cols-1 ${className ?? ''}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, ...style }}>
      {staff.map((s, i) => (
        <div key={s.id ?? i} className="ls-card" style={{ padding: 22, textAlign: 'center' }}>
          <TeamPortrait staff={s} />
          <strong style={{ display: 'block', fontSize: 16 }}>{s.name}</strong>
          {s.role && <span style={{ display: 'block', color: 'var(--c-primary)', fontSize: 13, fontWeight: 600, margin: '3px 0 8px' }}>{s.role}</span>}
          {s.bio && <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 13.5, lineHeight: 1.55 }}>{s.bio}</p>}
          {s.license && <div style={{ marginTop: 8, color: 'var(--c-text-muted)', fontSize: 12, letterSpacing: '0.02em' }}>{s.license}</div>}
          {(s.areas?.length || s.languages?.length) && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {[...(s.areas ?? []), ...(s.languages ?? [])].map((tag) => (
                <span key={tag} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--c-border)', color: 'var(--c-text-muted)' }}>{tag}</span>
              ))}
            </div>
          )}
          {(s.email || s.phone) && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13.5 }}>
              {s.phone && <a href={`tel:${s.phone.replace(/[^+0-9]/g, '')}`} style={{ color: 'var(--c-primary)', fontWeight: 600 }}>{s.phone}</a>}
              {s.email && <a href={`mailto:${s.email}`} style={{ color: 'var(--c-primary)', fontWeight: 600, wordBreak: 'break-all' }}>{s.email}</a>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface CatalogItem {
  id: string;
  name: string;
  nameZh?: string | null;
  description?: string | null;
  descriptionZh?: string | null;
  priceCents: number;
  durationMin?: number | null;
  depositCents?: number | null;
  imageUrl?: string | null;
  badges?: string[];
  modifiers?: { name: string; min: number; max: number; options: { name: string; priceCents: number }[] }[];
}
interface CatalogCategory {
  id?: string;
  name: string;
  nameZh?: string | null;
  type?: string;
  items: CatalogItem[];
}

export function RtServiceList({ initialData, className, style }: Sty & { initialData?: CatalogCategory[] }) {
  const { pick } = useSiteLang();
  const [cats, setCats] = useState<CatalogCategory[]>(initialData ?? []);
  useEffect(() => {
    apiGet<{ categories: CatalogCategory[] }>('/catalog?type=SERVICE')
      .then((r) => setCats(r.categories))
      .catch(() => {});
  }, []);
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 30, ...style }}>
      {cats.map((cat, ci) => (
        <div key={cat.id ?? ci}>
          <h3 className="font-heading" style={{ fontSize: 21, marginBottom: 14, fontWeight: 700 }}>{pick(cat.name, cat.nameZh)}</h3>
          {/* capped measure so the dotted leaders stay readable on wide screens */}
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 880, margin: 0 }}>
            {cat.items.map((it, i) => (
              <div key={it.id ?? i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '13px 4px', borderBottom: '1px solid var(--c-border)' }}>
                <span style={{ fontWeight: 600, fontSize: 15.5 }}>{pick(it.name, it.nameZh)}</span>
                {it.durationMin != null && it.durationMin > 0 && (
                  // fixed-width slot so the dotted leaders start on a consistent grid line
                  <span style={{ display: 'inline-block', minWidth: '6ch', color: 'var(--c-text-muted)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{it.durationMin} min</span>
                )}
                <span aria-hidden style={{ flex: 1, borderBottom: '1.5px dotted var(--c-border)', transform: 'translateY(-4px)' }} />
                <span style={{ color: 'color-mix(in srgb, var(--c-text) 92%, transparent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {it.priceCents === 0 ? 'Free' : money(it.priceCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RtPricingTable({
  plans,
  className,
  style,
}: Sty & {
  plans: {
    name: string; nameZh?: string; price: string; features: string; featuresZh?: string;
    featured: boolean; cta: string; ctaZh?: string; link?: string;
  }[];
}) {
  const { pick } = useSiteLang();
  return (
    <div className={`grid gap-6 max-md:!grid-cols-1 ${className ?? ''}`} style={{ gridTemplateColumns: `repeat(${plans.length}, 1fr)`, alignItems: 'stretch', ...style }}>
      {plans.map((p, i) => (
        <div
          key={i}
          className="ls-card"
          style={{
            padding: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            ...(p.featured ? { borderColor: 'var(--c-primary)', borderWidth: 2, boxShadow: '0 14px 40px color-mix(in srgb, var(--c-primary) 18%, transparent)' } : {}),
          }}
        >
          {p.featured && (
            <span style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-primary-fg)', background: 'var(--c-primary)', padding: '3px 10px', borderRadius: 999 }}>
              <LocText en="Most popular" zh="最受歡迎" es="Más popular" />
            </span>
          )}
          <strong style={{ fontSize: 18 }}>{pick(p.name, p.nameZh)}</strong>
          <span className="font-heading" style={{ fontSize: 34, fontWeight: 800 }}>{p.price}</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
            {featureLines(pick(p.features, p.featuresZh)).map((line, j) => (
              <li key={j} style={{ display: 'flex', gap: 9, alignItems: 'center', color: 'var(--c-text-muted)', fontSize: 14 }}>
                <RtGlyph name="check" size={15} />
                {line}
              </li>
            ))}
          </ul>
          {(() => {
            // each plan links to its own destination — a Stripe Payment Link
            // (real recurring subscription checkout, zero backend) or a page.
            // Falls back to /contact so the button is never a dead end.
            const href = (p.link ?? '').trim() || '/contact';
            const external = /^https?:\/\//i.test(href);
            return (
              <a
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                className={`ls-btn ${p.featured ? '' : 'ls-btn-outline'}`}
                style={{ justifyContent: 'center' }}
              >
                {pick(p.cta, ctaZh(p.cta, p.ctaZh))}
              </a>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

export function RtFAQ({
  items,
  className,
  style,
}: Sty & { items: { q: string; a: string; qZh?: string; aZh?: string }[] }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {items.map((it, i) => (
        <details key={i} className="ls-card" style={{ padding: '16px 20px' }}>
          <summary className="ls-sum" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 15.5 }}>
            {it.qZh ? <LocText en={it.q} zh={it.qZh} /> : it.q}
          </summary>
          <p style={{ margin: '10px 0 2px', color: 'var(--c-text-muted)', fontSize: 14.5, lineHeight: 1.65 }}>
            {it.aZh ? <LocText en={it.a} zh={it.aZh} /> : it.a}
          </p>
        </details>
      ))}
    </div>
  );
}

export function RtCTASection({
  heading,
  headingZh,
  sub,
  subZh,
  buttonLabel,
  buttonLabelZh,
  href,
  className,
  style,
}: Sty & {
  heading: string; headingZh?: string | null; sub: string; subZh?: string | null;
  buttonLabel: string; buttonLabelZh?: string | null; href?: string;
}) {
  const { pick } = useSiteLang();
  const destination = href?.trim() || undefined;
  const ctaStyle = { background: 'var(--c-primary-fg)', color: 'var(--c-primary)', padding: '14px 30px', fontSize: 16 };
  const ctaContent = (
    <>
      {pick(buttonLabel, ctaZh(buttonLabel, buttonLabelZh))}
      {/* the section IS the page's big CTA — always button-in-button */}
      <RtBtnArrow />
    </>
  );
  return (
    <div
      className={`flex max-md:flex-col max-md:items-start items-center gap-7 ${className ?? ''}`}
      style={{ background: 'var(--c-primary)', borderRadius: 'calc(var(--r-lg) * 1.4)', padding: 'clamp(28px, 5vw, 60px)', ...style }}
    >
      <div style={{ flex: 1 }}>
        <h2 className="font-heading" style={{ margin: 0, fontSize: 30, color: 'var(--c-primary-fg)' }}>{pick(heading, headingZh)}</h2>
        <p style={{ margin: '10px 0 0', color: 'var(--c-primary-fg)', opacity: 0.85, fontSize: 15.5 }}>{pick(sub, subZh)}</p>
      </div>
      {destination ? (
        <a href={destination} className="ls-btn" style={ctaStyle}>{ctaContent}</a>
      ) : (
        <span aria-disabled="true" className="ls-btn" style={{ ...ctaStyle, cursor: 'default' }}>{ctaContent}</span>
      )}
    </div>
  );
}

export function RtStatsRow({ items, className, style }: Sty & { items: { value: string; label: string; labelZh?: string }[] }) {
  return (
    <div className={`grid gap-6 max-md:!grid-cols-2 ${className ?? ''}`} style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)`, ...style }}>
      {items.map((it, i) => {
        // animate the numeric part when ls-motion is active: "4.9★" → counts to 4.9
        const m = it.value.match(/^([^0-9]*)([0-9]+(?:\.[0-9]+)?)(.*)$/);
        return (
          <div key={i} style={{ textAlign: 'center' }}>
            <div className="font-heading text-gradient" style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.1 }}>
              {m ? (
                <span data-count-to={m[2]} data-count-prefix={m[1]} data-count-suffix={m[3]}>
                  {it.value}
                </span>
              ) : (
                it.value
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--c-text-muted)' }}>
              <PlainLocText en={it.label} zh={it.labelZh} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RtLogoStrip({ items, className, style }: Sty & { items: { name: string; nameZh?: string; logo?: string }[] }) {
  const { pick } = useSiteLang();
  return (
    <div className={className} style={{ display: 'flex', flexWrap: 'wrap', gap: 30, justifyContent: 'center', alignItems: 'center', opacity: 0.75, ...style }}>
      {items.map((it, i) =>
        it.logo ? (
          <img key={i} src={it.logo} alt={pick(it.name, it.nameZh)} loading="lazy" decoding="async" style={{ height: 30, width: 'auto', maxWidth: 140, objectFit: 'contain' }} />
        ) : (
          <span key={i} className="font-heading" style={{ fontWeight: 700, fontSize: 17, color: 'var(--c-text-muted)', whiteSpace: 'nowrap' }}>
            <PlainLocText en={it.name} zh={it.nameZh} />
          </span>
        ),
      )}
    </div>
  );
}

export function RtSocialLinks({ className, style }: Sty) {
  const socials = site.business.socials ?? {};
  const links = Object.entries(socials).filter(([, url]) => url);
  if (links.length === 0) return null; // no dead placeholder icons on the real site
  return (
    <div className={className} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', ...style }}>
      {links.map(([id, url]) => (
        <a key={id} href={url} target="_blank" rel="noopener noreferrer" aria-label={id} title={id} className="ls-social">
          {brandGlyph(id)}
        </a>
      ))}
    </div>
  );
}

export function RtAnnouncementBar({ text, textZh, className, style }: Sty & { text: string; textZh?: string | null }) {
  const { pick } = useSiteLang();
  // the admin's live announcement has no translation of its own — once it lands
  // it replaces BOTH languages (a stale zh baked string would be a lie)
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ announcements: { text: string }[] }>('/content/announcements')
      .then((r) => r.announcements[0] && setLive(r.announcements[0].text))
      .catch(() => {});
  }, []);
  return (
    <div className={className} style={{ background: 'var(--c-banner)', color: 'var(--c-banner-fg)', textAlign: 'center', fontSize: 13.5, fontWeight: 600, padding: '9px 16px', ...style }}>
      {live ?? pick(text, textZh)}
    </div>
  );
}

export function RtCouponBanner({
  heading,
  headingZh,
  code = 'WELCOME10',
  description = '10% off your first order',
  className,
  style,
}: Sty & { heading: string; headingZh?: string | null; code?: string; description?: string }) {
  const { lang, pick } = useSiteLang();
  const [copied, setCopied] = useState(false);
  // Live offer, same refresh discipline as RtAnnouncementBar: the banner shows
  // what the admin currently has active and hides itself when nothing is — a
  // baked seed code must never outlive the offer (audit dining#10).
  // undefined = not fetched yet (show baked), null = confirmed none (hide).
  const [live, setLive] = useState<{ code: string; description: string } | null | undefined>(undefined);
  useEffect(() => {
    apiGet<{ coupon: { code: string; description?: string | null; kind: 'PERCENT' | 'FIXED'; value: number } | null }>('/coupons/active')
      .then((r) => {
        if (!r.coupon) return setLive(null);
        setLive({
          code: r.coupon.code,
          description:
            r.coupon.description ??
            (r.coupon.kind === 'PERCENT' ? `${r.coupon.value}% off` : `$${(r.coupon.value / 100).toFixed(2)} off`),
        });
      })
      .catch(() => {}); // offline/dev: keep the baked seed coupon
  }, []);
  if (live === null) return null;
  const shownCode = live?.code ?? code;
  const desc = live?.description ?? description;
  return (
    <div
      className={`flex max-md:flex-col items-center gap-4 ${className ?? ''}`}
      style={{
        padding: '22px 28px',
        borderRadius: 'calc(var(--r-lg) * 1.2)',
        border: '2px dashed var(--c-primary)',
        background: 'color-mix(in srgb, var(--c-primary) 6%, var(--c-surface))',
        ...style,
      }}
    >
      <div style={{ flex: 1 }}>
        <strong style={{ display: 'block', fontSize: 17 }}>{pick(heading, headingZh)}</strong>
        <span style={{ color: 'var(--c-text-muted)', fontSize: 14 }}>{desc}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <code style={{ padding: '9px 18px', fontSize: 16, fontWeight: 700, letterSpacing: '0.12em', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', color: 'var(--c-primary)' }}>
          {shownCode}
        </code>
        <button
          className="ls-btn ls-btn-outline"
          style={{ padding: '8px 16px', fontSize: 13 }}
          onClick={() => {
            navigator.clipboard.writeText(shownCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? '✓' : lang === 'es' ? 'Copiar código' : lang === 'zh' ? '複製代碼' : 'Copy code'}
        </button>
      </div>
    </div>
  );
}
