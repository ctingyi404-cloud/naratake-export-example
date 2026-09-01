'use client';

/* Property listings with filters + inquiry, and the order/repair tracker. */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BodyPortal } from './BodyPortal';
import { apiGet, apiPost } from '@/lib/client';
import { money } from '@/lib/money';
import { useSiteLang } from '@/lib/site-i18n';
import { localePath } from '@/lib/locale-path';
import { useDialogFocus } from './ordering';

type Sty = { className?: string; style?: CSSProperties };

interface Listing {
  id: string;
  title: string;
  priceCents: number;
  address: string;
  beds: number;
  baths: number;
  sqft: number;
  propertyType: string;
  status: 'ACTIVE' | 'PENDING' | 'SOLD';
  description: string;
  imageUrl?: string | null;
  /** the property's own page; absent on a legacy row, which keeps the modal */
  slug?: string | null;
  /** amenity tags — array from baked initialData, comma-string from the DB API */
  features?: string[] | string;
}

/** listing photo (merchant upload or baked art) with a clean fallback band —
    a dead image path renders the property initial, never a broken <img> */
function ListingPhoto({ listing, height }: { listing: Listing; height?: number }) {
  const [broken, setBroken] = useState(false);
  const frame: CSSProperties = height ? { width: '100%', height } : { width: '100%', aspectRatio: '3 / 2' };
  if (!broken) {
    // The box is `frame` above — width:100% plus either a fixed height or a 3/2
    // aspectRatio — and the initial-letter fallback reserves the very same box,
    // so neither a slow photo nor a dead path moves the row. cls-ok
    // eslint-disable-next-line @next/next/no-img-element
    return (
      // width + (height | aspectRatio) via `frame` above: cls-ok
      <img
        src={listing.imageUrl ?? '/images/listing-default.svg'}
        alt={height ? '' : listing.title}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="ls-photo"
        style={{ ...frame, objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return (
    <div aria-hidden style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--c-primary) 12%, transparent)', color: 'var(--c-primary)', fontSize: 40, fontWeight: 800 }}>
      {(listing.title.trim()[0] ?? '?').toUpperCase()}
    </div>
  );
}

/** normalize features from either shape */
function feats(l: Listing): string[] {
  return Array.isArray(l.features)
    ? l.features
    : String(l.features ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/* ── the filter row's address ─────────────────────────────────
   Slugs, not the band's index: `?price=350-500` reads like something a person
   wrote and survives an edit to the band list, where a shared `?price=2` would
   quietly start meaning a different price the next time the bands move.
   Index-aligned with BANDS below, which is the only thing that must stay true. */
const BAND_KEYS = ['any', 'u350', '350-500', '500-750', '750up'];
/* the sorts the row actually offers — a `?sort=` it does not know is dropped
   rather than echoed back into the address bar */
const SORTS = ['featured', 'price-asc', 'price-desc', 'sqft-desc', 'beds-desc'];
/* the steps each numeric control offers, read by both the selects and the query
   string, so a hand-typed `?baths=2.5` cannot arm a filter that no option can
   show and nothing on the page can clear */
const BEDS = [2, 3, 4, 5];
const BATHS = [1.5, 2, 3, 4];
const SQFT = [1000, 1500, 2000, 3000];

export function RtPropertyListings({ initialData, className, style }: Sty & { initialData?: Listing[] }) {
  const { lang } = useSiteLang();
  const [listings, setListings] = useState<Listing[]>(initialData ?? []);
  const [priceBand, setPriceBand] = useState(0);
  const [beds, setBeds] = useState(0);
  const [baths, setBaths] = useState(0);
  const [sqftMin, setSqftMin] = useState(0);
  const [type, setType] = useState('all');
  const [status, setStatus] = useState<'all' | Listing['status']>('all');
  const [mustHave, setMustHave] = useState<string[]>([]);
  const [sort, setSort] = useState('featured');
  const [detail, setDetail] = useState<Listing | null>(null);

  useEffect(() => {
    apiGet<{ listings: Listing[] }>('/content/listings')
      /* An empty array from a live database IS the answer. This used to be
         `r.X.length && setX(...)`, so a merchant who deleted every row kept
         seeing the demo rows baked in at export — the delete worked, the site
         refused to show the truth. Only a network failure falls back, which is
         what .catch below is for. */
      .then((r) => {
        setListings(r.listings);
        /* A shared link outlives the data it points at: a property type the
           brokerage stopped listing, an amenity tag the merchant renamed. Left
           alone, those keep emptying the grid while the select reads "All
           types" and no chip is lit — an invisible filter with nothing to press
           to clear it. Drop whatever the live rows can no longer offer. */
        const kinds = new Set(r.listings.map((l) => l.propertyType));
        setType((t) => (t === 'all' || kinds.has(t) ? t : 'all'));
        const tags = new Set(r.listings.flatMap(feats));
        setMustHave((m) => (m.every((f) => tags.has(f)) ? m : m.filter((f) => tags.has(f))));
      })
      .catch(() => {});
  }, []);

  /* Read the filters back on load. In an effect and not in a useState
     initializer, because this component is server-rendered first and the server
     has no query string — reading window during render is the hydration
     mismatch. RtNavbar detects its active page the same way, for the same
     reason. */
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // a value the control cannot offer is not a filter — it falls back to that
    // control's default rather than arming something the row cannot show
    const step = (k: string, steps: number[]) => {
      const n = Number(q.get(k));
      return steps.includes(n) ? n : 0;
    };
    const band = BAND_KEYS.indexOf(q.get('price') ?? '');
    const st = (q.get('status') ?? '').toUpperCase();
    const so = q.get('sort') ?? '';
    const must = (q.get('must') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    setPriceBand(band > 0 ? band : 0);
    setBeds(step('beds', BEDS));
    setBaths(step('baths', BATHS));
    setSqftMin(step('sqft', SQFT));
    setType(q.get('type') || 'all');
    setStatus(st === 'ACTIVE' || st === 'PENDING' || st === 'SOLD' ? st : 'all');
    if (must.length) setMustHave(must);
    setSort(SORTS.includes(so) ? so : 'featured');
    setUrlRead(true);
  }, []);

  /* …and write them back, so a filtered view is a link an agent can send.

     replaceState, not pushState: the eight controls refine ONE view, and a
     history entry per dropdown turns the back button into a trap the buyer has
     to press eight times to escape. The one place back genuinely must undo
     something — open a home, press back, expect the shortlist still standing —
     is exactly what replaceState delivers, because the entry the browser
     returns to already carries the filters in its URL. (Paging in
     CollectionList pushes for the opposite reason: page 3 is a different view,
     not a narrower one.)

     Raw History API rather than the router: this is the same page at a new
     address, not a navigation, and routing it would re-run the route on every
     turn of a select. history.state is passed straight through so the App
     Router's own tree survives the rewrite, and the hash rides along so an
     anchor is not thrown away by a filter change. */
  useEffect(() => {
    if (!urlRead) return;
    const q = new URLSearchParams(window.location.search);
    // defaults stay OUT: an unfiltered /listings keeps a clean, shareable URL
    const put = (k: string, v: string, blank: string) => {
      if (v === blank) q.delete(k);
      else q.set(k, v);
    };
    put('price', BAND_KEYS[priceBand] ?? 'any', 'any');
    put('beds', String(beds), '0');
    put('baths', String(baths), '0');
    put('sqft', String(sqftMin), '0');
    put('type', type, 'all');
    put('status', status.toLowerCase(), 'all');
    put('must', mustHave.join(','), '');
    put('sort', sort, 'featured');
    const qs = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }, [urlRead, priceBand, beds, baths, sqftMin, type, status, mustHave, sort]);

  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);

  // price bands read like a realtor site, not a raw max-price slider
  /** Below this many listings a visitor simply reads them all. */
const FILTER_FLOOR = 6;

const BANDS: [string, number, number][] = [
    [t3('Any price', '不限價格', 'Cualquier precio'), 0, Number.MAX_SAFE_INTEGER],
    [t3('Under $350k', '$350k 以下', 'Menos de $350k'), 0, 35000000],
    ['$350k – $500k', 35000000, 50000000],
    ['$500k – $750k', 50000000, 75000000],
    ['$750k+', 75000000, Number.MAX_SAFE_INTEGER],
  ];

  const types = useMemo(() => [...new Set(listings.map((l) => l.propertyType))], [listings]);
  const allFeatures = useMemo(() => [...new Set(listings.flatMap(feats))], [listings]);

  const [, lo, hi] = BANDS[priceBand] ?? BANDS[0];
  const filtered = listings.filter(
    (l) =>
      l.priceCents >= lo &&
      l.priceCents <= hi &&
      (beds === 0 || l.beds >= beds) &&
      (baths === 0 || l.baths >= baths) &&
      (sqftMin === 0 || l.sqft >= sqftMin) &&
      (type === 'all' || l.propertyType === type) &&
      (status === 'all' || l.status === status) &&
      mustHave.every((f) => feats(l).includes(f)),
  );
  const sorted = [...filtered];
  if (sort === 'price-asc') sorted.sort((a, b) => a.priceCents - b.priceCents);
  else if (sort === 'price-desc') sorted.sort((a, b) => b.priceCents - a.priceCents);
  else if (sort === 'sqft-desc') sorted.sort((a, b) => b.sqft - a.sqft);
  else if (sort === 'beds-desc') sorted.sort((a, b) => b.beds - a.beds);

  const sel: CSSProperties = { width: 'auto' };
  /* Filters narrow a list you cannot scan. A brokerage that is carrying two
     homes can be read in one glance, so six dropdowns above two cards make the
     inventory look like a failed search rather than a careful shortlist — and
     the agent watching her own site sees an empty shop. They appear once there
     is enough to sift, and everything below is unconditional. */
  const showFilters = listings.length >= FILTER_FLOOR;
  return (
    <div className={className} style={style}>
      {showFilters && (
      <div className="flex flex-wrap gap-3" style={{ marginBottom: 10 }}>
        <select aria-label={t3('Price', '價格', 'Precio')} className="ls-input" style={sel} value={priceBand} onChange={(e) => setPriceBand(Number(e.target.value))}>
          {BANDS.map(([label], i) => (
            <option key={i} value={i}>{label}</option>
          ))}
        </select>
        <select aria-label={t3('Bedrooms', '房數', 'Habitaciones')} className="ls-input" style={sel} value={beds} onChange={(e) => setBeds(Number(e.target.value))}>
          <option value={0}>{t3('Any beds', '不限房數', 'Cualquier habitación')}</option>
          {BEDS.map((b) => (
            <option key={b} value={b}>{b}+ bd</option>
          ))}
        </select>
        <select aria-label={t3('Bathrooms', '衛浴數', 'Baños')} className="ls-input" style={sel} value={baths} onChange={(e) => setBaths(Number(e.target.value))}>
          <option value={0}>{t3('Any baths', '不限衛浴', 'Cualquier baño')}</option>
          {BATHS.map((b) => (
            <option key={b} value={b}>{b}+ ba</option>
          ))}
        </select>
        <select aria-label={t3('Minimum size', '坪數下限', 'Tamaño mínimo')} className="ls-input" style={sel} value={sqftMin} onChange={(e) => setSqftMin(Number(e.target.value))}>
          <option value={0}>{t3('Any size', '不限大小', 'Cualquier tamaño')}</option>
          {SQFT.map((s) => (
            <option key={s} value={s}>{s.toLocaleString()}+ sqft</option>
          ))}
        </select>
        <select aria-label={t3('Property type', '房產類型', 'Tipo de propiedad')} className="ls-input" style={sel} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">{t3('All types', '所有類型', 'Todos los tipos')}</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select aria-label={t3('Status', '狀態', 'Estado')} className="ls-input" style={sel} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">{t3('Any status', '所有狀態', 'Todos los estados')}</option>
          <option value="ACTIVE">{t3('For sale', '出售中', 'En venta')}</option>
          <option value="PENDING">{t3('Pending', '洽談中', 'Pendiente')}</option>
          <option value="SOLD">{t3('Sold', '已售', 'Vendida')}</option>
        </select>
        <select aria-label={t3('Sort', '排序', 'Ordenar')} className="ls-input" style={sel} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="featured">{t3('Featured', '精選排序', 'Destacados')}</option>
          <option value="price-asc">{t3('Price: low to high', '價格：低到高', 'Precio: menor a mayor')}</option>
          <option value="price-desc">{t3('Price: high to low', '價格：高到低', 'Precio: mayor a menor')}</option>
          <option value="sqft-desc">{t3('Largest first', '面積：大到小', 'Más grande primero')}</option>
          <option value="beds-desc">{t3('Most bedrooms', '房數最多', 'Más habitaciones')}</option>
        </select>
      </div>
      )}
      {showFilters && allFeatures.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{t3('Must have:', '必備條件：', 'Imprescindibles:')}</span>
          {allFeatures.map((f) => {
            const on = mustHave.includes(f);
            return (
              <button
                key={f}
                onClick={() => setMustHave(on ? mustHave.filter((x) => x !== f) : [...mustHave, f])}
                aria-pressed={on}
                style={{
                  padding: '5px 13px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--c-primary)' : 'var(--c-border)'}`,
                  background: on ? 'var(--c-primary)' : 'var(--c-surface)',
                  color: on ? 'var(--c-primary-fg)' : 'var(--c-text)',
                  transition: 'background 130ms ease, color 130ms ease, border-color 130ms ease',
                }}
              >
                {f}
              </button>
            );
          })}
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)', marginLeft: 'auto' }}>
            {sorted.length} {t3('listings', '筆房源', 'propiedades')}
          </span>
        </div>
      )}
      {!showFilters && sorted.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginBottom: 12 }}>
          {sorted.length} {t3(sorted.length === 1 ? 'listing' : 'listings', '筆房源', 'propiedades')}
        </div>
      )}
      {/* Two cards in a three-column grid read as a row with a hole in it. */}
      <div className={`grid gap-5 max-md:grid-cols-1 ${sorted.length < 3 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {sorted.map((l) => (
          /* A REAL LINK, so the card can be opened in a new tab, copied, and
             shared, and so the back button goes back. Rows exported before
             listings had pages carry no slug and keep the old modal. */
          l.slug ? (
            <a key={l.id} href={localePath(lang, `/listings/${l.slug}`)} className="ls-card" style={{ overflow: 'hidden', display: 'block', textAlign: 'left', padding: 0, color: 'var(--c-text)', textDecoration: 'none' }}>
            <div style={{ position: 'relative' }}>
              <ListingPhoto listing={l} />
              <StatusPill status={l.status} lang={lang} />
            </div>
            <div style={{ padding: 16 }}>
              <div className="font-heading" style={{ fontSize: 20, fontWeight: 800 }}>{money(l.priceCents)}</div>
              <div style={{ fontSize: 14, marginTop: 2 }}>{l.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)', marginTop: 2 }}>{l.address}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                <span>{l.beds} bd</span>
                <span>{l.baths} ba</span>
                <span>{l.sqft.toLocaleString()} sqft</span>
              </div>
              {feats(l).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {feats(l).slice(0, 3).map((f) => (
                    <span key={f} style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)', color: 'var(--c-text)' }}>
                      {f}
                    </span>
                  ))}
                  {feats(l).length > 3 && (
                    <span style={{ fontSize: 11, color: 'var(--c-text-muted)', alignSelf: 'center' }}>+{feats(l).length - 3}</span>
                  )}
                </div>
              )}
            </div>
            </a>
          ) : (
            <button key={l.id} className="ls-card" onClick={() => setDetail(l)} style={{ overflow: 'hidden', cursor: 'pointer', textAlign: 'left', padding: 0, color: 'var(--c-text)' }}>
            <div style={{ position: 'relative' }}>
              <ListingPhoto listing={l} />
              <StatusPill status={l.status} lang={lang} />
            </div>
            <div style={{ padding: 16 }}>
              <div className="font-heading" style={{ fontSize: 20, fontWeight: 800 }}>{money(l.priceCents)}</div>
              <div style={{ fontSize: 14, marginTop: 2 }}>{l.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)', marginTop: 2 }}>{l.address}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                <span>{l.beds} bd</span>
                <span>{l.baths} ba</span>
                <span>{l.sqft.toLocaleString()} sqft</span>
              </div>
              {feats(l).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {feats(l).slice(0, 3).map((f) => (
                    <span key={f} style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)', color: 'var(--c-text)' }}>
                      {f}
                    </span>
                  ))}
                  {feats(l).length > 3 && (
                    <span style={{ fontSize: 11, color: 'var(--c-text-muted)', alignSelf: 'center' }}>+{feats(l).length - 3}</span>
                  )}
                </div>
              )}
            </div>
            </button>
          )
        ))}
      </div>
      {detail && <ListingModal listing={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StatusPill({ status, lang }: { status: Listing['status']; lang: string }) {
  const label =
    status === 'ACTIVE'
      ? lang === 'es' ? 'En venta' : lang === 'zh' ? '出售中' : 'For sale'
      : status === 'PENDING'
        ? lang === 'es' ? 'Pendiente' : lang === 'zh' ? '洽談中' : 'Pending'
        : lang === 'es' ? 'Vendida' : lang === 'zh' ? '已售' : 'Sold';
  return (
    <span
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '3px 10px',
        borderRadius: 999,
        background: status === 'ACTIVE' ? 'var(--c-primary)' : 'var(--c-accent)',
        // --c-accent-fg is derived from the accent itself; --c-text is chosen
        // for the page and goes invisible the moment the accent is light
        color: status === 'ACTIVE' ? 'var(--c-primary-fg)' : 'var(--c-accent-fg)',
      }}
    >
      {label}
    </span>
  );
}

function ListingModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const { lang } = useSiteLang();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: `I'd like to know more about ${listing.title}.` });
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogFocus(cardRef, onClose);
  return (
    <BodyPortal>
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={listing.title} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div ref={cardRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} className="ls-card ls-fade-up" style={{ width: 640, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', padding: 0, outline: 'none' }}>
        <ListingPhoto listing={listing} height={240} />
        <div style={{ padding: 26 }}>
          <div className="font-heading" style={{ fontSize: 26, fontWeight: 800 }}>{money(listing.priceCents)}</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{listing.title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--c-text-muted)' }}>{listing.address} · {listing.beds} bd · {listing.baths} ba · {listing.sqft.toLocaleString()} sqft · {listing.propertyType}</div>
          <p style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--c-text-muted)', margin: '14px 0 14px' }}>{listing.description}</p>
          {feats(listing).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, margin: '0 0 20px' }}>
              {feats(listing).map((f) => (
                <span key={f} style={{ fontSize: 12, fontWeight: 600, padding: '3px 11px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 14%, transparent)' }}>
                  {f}
                </span>
              ))}
            </div>
          )}
          {sent ? (
            <p style={{ color: 'var(--c-primary)', fontWeight: 600 }}>✓ {lang === 'es' ? 'Enviado. Un agente te contactará pronto.' : lang === 'zh' ? '已送出，經紀人將盡快聯繫你。' : 'Sent. An agent will reach out shortly.'}</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                // a lost inquiry is a lost buyer: show failures, block double-clicks
                setBusy(true);
                setErr('');
                try {
                  await apiPost('/listings/inquiry', { listingId: listing.id, ...form });
                  setSent(true);
                } catch {
                  setErr(lang === 'es' ? 'No se pudo enviar. Inténtalo de nuevo.' : lang === 'zh' ? '送出失敗，請再試一次。' : "Couldn't send. Please try again.");
                } finally {
                  setBusy(false);
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <strong style={{ fontSize: 14.5 }}>{lang === 'es' ? 'Preguntar por esta casa' : lang === 'zh' ? '詢問這個房源' : 'Ask about this home'}</strong>
              <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" required placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input aria-label="Email *" className="ls-input" required type="email" placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              {/* the endpoint always accepted a phone; the form never asked, so
                  every buyer lead reached the brokerage without a number */}
              <input aria-label={lang === 'es' ? 'Teléfono' : lang === 'zh' ? '電話' : 'Phone'} className="ls-input" type="tel" placeholder={lang === 'es' ? 'Teléfono' : lang === 'zh' ? '電話' : 'Phone'} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <textarea className="ls-input" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              {err && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{err}</div>}
              <button className="ls-btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>
                {busy ? '…' : lang === 'es' ? 'Enviar consulta' : lang === 'zh' ? '送出詢問' : 'Send inquiry'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  </BodyPortal>
  );
}

/* ── order / repair tracker ── */

const STEPS = ['AWAITING_APPROVAL', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];

export function RtOrderTracker({ heading, headingZh, className, style }: Sty & { heading: string; headingZh?: string | null }) {
  const { lang, pick } = useSiteLang();
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<{ code: string; status: string; totalCents: number } | null>(null);
  const [error, setError] = useState('');
  const stepLabels: Record<string, [string, string]> = {
    AWAITING_APPROVAL: ['Received', '已收件'],
    PENDING: ['Received', '已收件'],
    CONFIRMED: ['Confirmed', '已確認'],
    PREPARING: ['In progress', '進行中'],
    READY: ['Ready', '完成可取'],
    COMPLETED: ['Done', '已完成'],
  };

  async function track() {
    setError('');
    setResult(null);
    try {
      const res = await apiPost<{ code: string; status: string; totalCents: number }>('/orders/track', { code, phone });
      setResult(res);
    } catch {
      setError(lang === 'es' ? 'Sin coincidencia. Revisa el número de pedido y el teléfono.' : lang === 'zh' ? '找不到符合的訂單，請確認單號與電話。' : 'No match. Check the order number and phone.');
    }
  }

  const activeIdx = result ? Math.max(0, STEPS.indexOf(result.status === 'PENDING' ? 'AWAITING_APPROVAL' : result.status)) : -1;

  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      <strong className="font-heading" style={{ fontSize: 19 }}>{pick(heading, headingZh)}</strong>
      <div className="flex gap-2 max-md:flex-col">
        <input aria-label={lang === 'es' ? 'N.º de pedido (ej. A-014)' : lang === 'zh' ? '單號（例：A-014）' : 'Order # (e.g. A-014)'} className="ls-input" style={{ flex: 1 }} placeholder={lang === 'es' ? 'N.º de pedido (ej. A-014)' : lang === 'zh' ? '單號（例：A-014）' : 'Order # (e.g. A-014)'} value={code} onChange={(e) => setCode(e.target.value)} />
        <input aria-label={lang === 'es' ? 'Teléfono' : lang === 'zh' ? '電話' : 'Phone'} className="ls-input" style={{ flex: 1 }} placeholder={lang === 'es' ? 'Teléfono' : lang === 'zh' ? '電話' : 'Phone'} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="ls-btn" onClick={track}>{lang === 'es' ? 'Rastrear' : lang === 'zh' ? '查詢' : 'Track'}</button>
      </div>
      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13.5 }}>{error}</div>}
      {result && (
        <div className="ls-fade-up">
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, position: 'relative' }}>
                {i > 0 && (
                  <span style={{ position: 'absolute', top: 10, right: '50%', width: '100%', height: 2, background: i <= activeIdx ? 'var(--c-primary)' : 'var(--c-border)', zIndex: 0 }} />
                )}
                <span style={{ position: 'relative', zIndex: 1, width: 21, height: 21, borderRadius: 999, background: i <= activeIdx ? 'var(--c-primary)' : 'var(--c-surface)', border: `2px solid ${i <= activeIdx ? 'var(--c-primary)' : 'var(--c-border)'}` }} />
                <span style={{ fontSize: 11, color: i <= activeIdx ? 'var(--c-text)' : 'var(--c-text-muted)', fontWeight: i === activeIdx ? 700 : 500, textAlign: 'center' }}>
                  {lang === 'zh' ? stepLabels[s]?.[1] : stepLabels[s]?.[0]}
                </span>
              </div>
            ))}
          </div>
          {result.totalCents > 0 && (
            <p style={{ textAlign: 'center', marginTop: 14, fontSize: 14 }}>
              {lang === 'es' ? 'Presupuesto' : lang === 'zh' ? '估價金額' : 'Estimate'}: <strong>{money(result.totalCents)}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
