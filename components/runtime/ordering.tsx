'use client';

/* Online ordering: menu browsing, modifier selection, cart, and a full
   checkout that works in mock mode (zero keys) or with Stripe. */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { RtGlyph } from './basics';
import { BodyPortal } from './BodyPortal';
import { apiGet, apiPost } from '@/lib/client';
import { trackConversion } from '@/lib/track';
import { loyaltyRedeemOptions, maxLoyaltyRedeemCents } from '@/lib/loyalty';
import { money } from '@/lib/money';
import { site } from '@/lib/site-config';
import { useSiteLang } from '@/lib/site-i18n';
import { localePath } from '@/lib/locale-path';

type Sty = { className?: string; style?: CSSProperties };

export interface ModifierGroup {
  name: string;
  min: number;
  max: number;
  options: { name: string; priceCents: number }[];
}

export interface MenuItem {
  id: string;
  name: string;
  nameZh?: string | null;
  description?: string | null;
  descriptionZh?: string | null;
  priceCents: number;
  imageUrl?: string | null;
  badges?: string[];
  modifiers?: ModifierGroup[];
}

export interface MenuCategory {
  id?: string;
  name: string;
  nameZh?: string | null;
  items: MenuItem[];
}

interface CartLine {
  key: string;
  item: MenuItem;
  qty: number;
  modifiers: string[]; // option names
  unitCents: number;
}

interface CartState {
  lines: CartLine[];
  add: (item: MenuItem, modifiers: string[], qty: number) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  subtotal: number;
}

const CartCtx = createContext<CartState | null>(null);

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('Cart used outside OrderingWidget');
  return ctx;
}

/** Cart if one exists in context (site-wide provider or an OrderingWidget),
    else null — lets a standalone menu decide between "add to cart" and view-only. */
export function useOptionalCart(): CartState | null {
  return useContext(CartCtx);
}

/* Cart state machine. `persist` mirrors it to localStorage so items added on the
   menu page survive the walk to the order page (and a refresh). */
function useCartState(persist: boolean): CartState {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    if (!persist) return;
    try {
      const raw = localStorage.getItem('site.cart');
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      /* ignore malformed storage */
    }
  }, [persist]);
  useEffect(() => {
    if (!persist) return;
    try {
      localStorage.setItem('site.cart', JSON.stringify(lines));
    } catch {
      /* storage full / unavailable */
    }
  }, [lines, persist]);
  return useMemo<CartState>(
    () => ({
      lines,
      add: (item, modifiers, qty) => {
        const key = `${item.id}|${modifiers.slice().sort().join(',')}`;
        setLines((prev) => {
          const existing = prev.find((l) => l.key === key);
          if (existing) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l));
          return [...prev, { key, item, qty, modifiers, unitCents: unitPrice(item, modifiers) }];
        });
      },
      setQty: (key, qty) =>
        setLines((prev) => (qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, qty } : l)))),
      clear: () => setLines([]),
      subtotal: lines.reduce((s, l) => s + l.unitCents * l.qty, 0),
    }),
    [lines],
  );
}

/* Site-wide cart. Mounted once in the layout when the orders module is on, so the
   menu page and the order page share one persistent cart. Without it (view-only
   sites), the menu shows no add-to-cart controls.

   The provider also owns the floating cart pill: the moment anything lands in
   the cart, a checkout affordance exists on EVERY page — a customer must never
   add a dish and see nothing happen. Pages that already carry explicit cart
   chrome (the ordering widget, a placed CartButton) claim the slot and the
   pill yields. */
/* Anchor id of the ordering widget's own cart column. On a phone the auto pill
   scrolls here instead of navigating away, so checkout is always one tap
   reachable even though the cart sits below a tall menu. */
const ORDER_CART_ANCHOR = 'ls-order-cart';

const CartChrome = createContext<{ claim: (anchor?: string) => () => void }>({ claim: () => () => {} });

/** Explicit cart chrome calls this to yield the automatic pill while mounted.
    A CartButton claims fully (it is its own all-size pill). An OrderingWidget
    passes its cart's `anchor`: desktop shows the widget's cart column so the
    pill hides, but on mobile the pill stays as the reachable checkout affordance
    and scrolls to that same-page cart rather than navigating away. */
export function useCartChromeClaim(active = true, anchor?: string) {
  const { claim } = useContext(CartChrome);
  useEffect(() => {
    if (!active) return;
    return claim(anchor);
  }, [active, claim, anchor]);
}

export function RtCartProvider({ children }: { children: ReactNode }) {
  const cart = useCartState(true);
  // `full` = claimers that already render an all-size pill (CartButton) → the
  // auto pill fully yields. `anchors` = same-page carts (OrderingWidget) → the
  // pill survives on mobile only, pointing at the cart.
  const [full, setFull] = useState(0);
  const [anchors, setAnchors] = useState<string[]>([]);
  const chrome = useMemo(
    () => ({
      claim: (anchor?: string) => {
        if (anchor) {
          setAnchors((a) => [...a, anchor]);
          return () =>
            setAnchors((a) => {
              const i = a.indexOf(anchor);
              return i < 0 ? a : [...a.slice(0, i), ...a.slice(i + 1)];
            });
        }
        setFull((c) => c + 1);
        return () => setFull((c) => c - 1);
      },
    }),
    [],
  );
  return (
    <CartCtx.Provider value={cart}>
      <CartChrome.Provider value={chrome}>
        {children}
        {full === 0 && <RtCartPill anchor={anchors[0]} />}
      </CartChrome.Provider>
    </CartCtx.Provider>
  );
}

function RtCartPill({ anchor }: { anchor?: string }) {
  const cart = useCart();
  const { lang } = useSiteLang();
  const count = cart.lines.reduce((s, l) => s + l.qty, 0);
  const prev = useRef(count);
  const [bump, setBump] = useState(false);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (count > prev.current) {
      setBump(true);
      setFlash(true);
      const t1 = setTimeout(() => setBump(false), 400);
      const t2 = setTimeout(() => setFlash(false), 1500);
      prev.current = count;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    prev.current = count;
  }, [count]);
  if (count === 0) return null;
  // same-page mode: scroll to the widget's cart instead of leaving the page
  const toCart = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!anchor) return;
    const el = document.getElementById(anchor);
    if (!el) return; // let the href (#anchor) handle it if not yet mounted
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const cta = anchor
    ? lang === 'es' ? `Ver carrito · ${money(cart.subtotal)}` : lang === 'zh' ? `查看購物車 · ${money(cart.subtotal)}` : `View cart · ${money(cart.subtotal)}`
    : lang === 'es' ? `Pagar · ${money(cart.subtotal)}` : lang === 'zh' ? `結帳 · ${money(cart.subtotal)}` : `Checkout · ${money(cart.subtotal)}`;
  return (
    <a
      href={anchor ? `#${anchor}` : localePath(lang, site.orderPath ?? '/order')}
      onClick={toCart}
      // desktop shows the widget's cart column, so this pill is mobile-only there
      // (globals.css hides [data-scope=page] ≥ md)
      data-scope={anchor ? 'page' : undefined}
      className="ls-btn ls-cart-pill"
      data-bump={bump || undefined}
      aria-label={
        anchor
          ? lang === 'es' ? `Carrito, ${count} artículos, ver` : lang === 'zh' ? `購物車 ${count} 件,查看` : `Cart, ${count} items, view`
          : lang === 'es' ? `Carrito, ${count} artículos, pagar` : lang === 'zh' ? `購物車 ${count} 件,前往結帳` : `Cart, ${count} items, checkout`
      }
    >
      <RtGlyph name="cart" size={17} color="currentColor" />
      <span className="ls-cart-count">{count}</span>
      {flash
        ? lang === 'es' ? 'Añadido ✓' : lang === 'zh' ? '已加入 ✓' : 'Added ✓'
        : cta}
    </a>
  );
}

const BADGE_LABELS: Record<string, [string, string]> = {
  spicy: ['Spicy', '辣'],
  vegan: ['Vegan', '全素'],
  vegetarian: ['Vegetarian', '蛋奶素'],
  gf: ['GF', '無麩質'],
  new: ['New', '新品'],
  popular: ['Popular', '人氣'],
};

function unitPrice(item: MenuItem, chosen: string[]): number {
  const all = (item.modifiers ?? []).flatMap((g) => g.options);
  return (
    item.priceCents +
    chosen.reduce((s, name) => s + (all.find((o) => o.name === name)?.priceCents ?? 0), 0)
  );
}

/* ── dialog focus management ──
   One mechanism for every runtime dialog: on open, remember the opener and move
   focus into the dialog; Escape closes; Tab/Shift+Tab cycle within the dialog's
   focusable elements; on close, hand focus back to the opener. The dialog
   element needs ref + tabIndex={-1}. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
    // runs once per dialog lifetime; ref is stable and onClose is read via close.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ── item detail modal ── */

function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (modifiers: string[], qty: number) => void;
}) {
  const { pick, lang } = useSiteLang();
  const [qty, setQty] = useState(1);
  const [chosen, setChosen] = useState<string[]>([]);
  const groups = item.modifiers ?? [];
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogFocus(cardRef, onClose);

  const groupChosen = (g: ModifierGroup) => chosen.filter((c) => g.options.some((o) => o.name === c));
  // the first requirement still standing — named under the Add button so a
  // dimmed, unresponsive button is never an unexplained dead end (mobile-kbd#7)
  const unmet = groups.find((g) => groupChosen(g).length < g.min);
  const valid = !unmet;
  const hintId = useId();
  const total = unitPrice(item, chosen) * qty;

  function toggle(g: ModifierGroup, name: string) {
    const inGroup = groupChosen(g);
    if (g.max === 1) {
      setChosen([...chosen.filter((c) => !g.options.some((o) => o.name === c)), name]);
    } else if (inGroup.includes(name)) {
      setChosen(chosen.filter((c) => c !== name));
    } else if (inGroup.length < g.max) {
      setChosen([...chosen, name]);
    }
  }

  return (
    <BodyPortal>
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={pick(item.name, item.nameZh)}
      style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="ls-card ls-fade-up ls-modal-card"
        style={{ width: 460, maxWidth: '100%', padding: 0, position: 'relative', outline: 'none' }}
      >
        {/* sticky rail, not absolute: a tall modifier list used to scroll the
            only visible close affordance off the top (mobile-kbd#4) */}
        <div className="ls-modal-close">
          <button type="button" onClick={onClose} aria-label={lang === 'es' ? 'Cerrar' : lang === 'zh' ? '關閉' : 'Close'}>
            <RtGlyph name="x" size={17} color="currentColor" />
          </button>
        </div>
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} className="ls-photo" style={{ width: '100%', height: 180, objectFit: 'cover' }} />
        )}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <strong style={{ fontSize: 18 }}>{pick(item.name, item.nameZh)}</strong>
            <span style={{ fontWeight: 700, color: 'color-mix(in srgb, var(--c-text) 92%, transparent)', fontVariantNumeric: 'tabular-nums' }}>{money(item.priceCents)}</span>
          </div>
          {item.description && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-muted)', lineHeight: 1.55 }}>
              {pick(item.description, item.descriptionZh)}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.name}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {g.name}
                <span style={{ fontWeight: 500, color: 'var(--c-text-muted)', marginLeft: 8, fontSize: 12 }}>
                  {g.min > 0 ? (lang === 'es' ? 'obligatorio' : lang === 'zh' ? '必選' : 'required') : lang === 'es' ? 'opcional' : lang === 'zh' ? '可選' : 'optional'}
                  {g.max > 1 ? ` · max ${g.max}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.options.map((o) => {
                  const active = chosen.includes(o.name);
                  return (
                    <button
                      key={o.name}
                      onClick={() => toggle(g, o.name)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '9px 13px',
                        borderRadius: 'var(--r-md)',
                        border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-border)'}`,
                        background: active ? 'color-mix(in srgb, var(--c-primary) 7%, transparent)' : 'var(--c-surface)',
                        fontSize: 14,
                        cursor: 'pointer',
                        color: 'var(--c-text)',
                      }}
                    >
                      <span>{o.name}</span>
                      {o.priceCents > 0 && <span style={{ color: 'var(--c-text-muted)' }}>+{money(o.priceCents)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--c-border)', borderRadius: 999, padding: 3 }}>
              <QtyBtn label={lang === 'es' ? 'Menos' : lang === 'zh' ? '減少數量' : 'Decrease quantity'} disabled={qty <= 1} onClick={() => setQty(Math.max(1, qty - 1))}>−</QtyBtn>
              <span style={{ minWidth: 26, textAlign: 'center', fontWeight: 700 }}>{qty}</span>
              <QtyBtn label={lang === 'es' ? 'Más' : lang === 'zh' ? '增加數量' : 'Increase quantity'} onClick={() => setQty(qty + 1)}>+</QtyBtn>
            </div>
            <button className="ls-btn" style={{ flex: 1, justifyContent: 'center', opacity: valid ? 1 : 0.5 }} disabled={!valid} aria-describedby={unmet ? hintId : undefined} onClick={() => onAdd(chosen, qty)}>
              {lang === 'es' ? 'Añadir' : lang === 'zh' ? '加入' : 'Add'} · {money(total)}
            </button>
          </div>
          {unmet && (
            <p id={hintId} role="status" style={{ margin: '-6px 0 0', fontSize: 13, color: 'var(--c-text-muted)' }}>
              {lang === 'es'
                ? `Elige “${unmet.name}” para continuar`
                : lang === 'zh'
                  ? `請先選擇「${unmet.name}」`
                  : `Choose “${unmet.name}” to continue`}
            </p>
          )}
        </div>
      </div>
    </div>
  </BodyPortal>
  );
}

function QtyBtn({ children, onClick, label, disabled }: { children: ReactNode; onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      style={{ width: 36, height: 36, borderRadius: 999, border: 'none', background: 'var(--c-bg)', fontSize: 16, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, color: 'var(--c-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {children}
    </button>
  );
}

/* ── menu list (standalone browsing, also used inside OrderingWidget) ── */

/* Line-icon dietary glyphs for the classic menu layout — a flame for spicy, a
   leaf for vegan/vegetarian, tiny small-caps text for anything else (GF, NEW…).
   Mirrors MenuBadgeGlyph in the studio's components/src/shared.tsx VERBATIM. */
function MenuBadgeGlyph({ badge, color }: { badge: string; color: string }) {
  const s: CSSProperties = { width: 14, height: 14, flexShrink: 0 };
  if (badge === 'spicy')
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="spicy">
        <path d="M12 21c-3.8 0-6.5-2.6-6.5-6.2 0-2.9 1.8-4.6 3-6.3.9-1.3 1.6-2.6 1.7-4.5 2.4 1.2 3.4 3 3.3 5.2 1-.4 1.7-1.2 2-2.4 1.9 1.7 3 4 3 6.4 0 4.4-2.7 7.8-6.5 7.8z" />
      </svg>
    );
  if (badge === 'vegan' || badge === 'vegetarian')
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="vegetarian">
        <path d="M5 20c0-8 5-13 14-14-.5 9-5 14-11.5 14H5z" />
        <path d="M5 20c2-5 5.5-8.5 10-10.5" />
      </svg>
    );
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color }}>{badge}</span>
  );
}

export function RtMenuList({
  initialData,
  showImages = true,
  layout = 'cards',
  searchLabel,
  searchLabelZh,
  interactive,
  className,
  style,
}: Sty & { initialData?: MenuCategory[]; showImages?: boolean; layout?: 'cards' | 'classic' | 'gallery'; searchLabel?: string; searchLabelZh?: string; interactive?: boolean }) {
  const { pick, lang } = useSiteLang();
  const [cats, setCats] = useState<MenuCategory[]>(initialData ?? []);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [diet, setDiet] = useState<string[]>([]);
  const [detail, setDetail] = useState<MenuItem | null>(null);
  const cart = useContext(CartCtx);
  const classic = layout === 'classic';
  /* gallery: the photograph leads. Built for catalogs where the picture IS the
     product — garments, cakes, cocktails — where an 84px thumbnail undersells
     everything the photo law put in place. */
  const gallery = layout === 'gallery';
  const uid = useId(); // anchor prefix — two menus on one page must not collide

  useEffect(() => {
    apiGet<{ categories: MenuCategory[] }>('/catalog?type=MENU')
      .then((r) => {
        const withProducts = r.categories.length
          ? r.categories
          : undefined;
        if (withProducts) setCats(withProducts);
        // a shop that emptied its product list must see it empty, not the seed
        else return apiGet<{ categories: MenuCategory[] }>('/catalog?type=PRODUCT').then((p) => setCats(p.categories));
      })
      .catch(() => {});
  }, []);

  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  // dietary badges that actually appear on this menu (spicy/vegan/gf…)
  const allBadges = [...new Set(cats.flatMap((c) => c.items.flatMap((it) => it.badges ?? [])))];
  const needle = q.trim().toLowerCase();
  const matches = (it: MenuItem) =>
    (needle === '' ||
      `${it.name} ${it.nameZh ?? ''} ${it.description ?? ''} ${it.descriptionZh ?? ''}`.toLowerCase().includes(needle)) &&
    diet.every((b) => (it.badges ?? []).includes(b));
  const filtering = needle !== '' || diet.length > 0;
  // searching or filtering scans the whole menu; classic stacks every category
  // (its chips JUMP to sections); cards shows the active tab only
  const withIdx = cats.map((c, idx) => ({ c, idx }));
  const shown = (filtering || classic ? withIdx : withIdx[active] ? [withIdx[active]] : withIdx)
    .map(({ c, idx }) => ({ idx, ...c, items: c.items.filter(matches) }))
    .filter((c) => c.items.length > 0);
  const hits = shown.reduce((s, c) => s + c.items.length, 0);

  // no menu yet → a friendly placeholder, not an orphaned search box over nothing
  if (cats.length === 0) {
    return (
      <div className={className} style={{ padding: '36px 0', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 15, ...style }}>
        {t3('Menu coming soon.', '菜單即將推出。', 'Menú próximamente.')}
      </div>
    );
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {/* pinned below the navbar so the category tabs never scroll away mid-menu;
          the negative margins cancel the sticky surface padding so spacing is unchanged */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          position: 'sticky',
          top: 76,
          zIndex: 5,
          background: 'color-mix(in srgb, var(--c-bg) 96%, transparent)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          padding: '10px 0',
          margin: allBadges.length ? '-10px 0 -2px' : '-10px 0 4px',
        }}
      >
        {cats.map((c, i) => {
          const on = !classic && !filtering && i === active;
          return (
            <button
              key={c.id ?? i}
              onClick={() =>
                classic
                  ? document.getElementById(`${uid}-cat-${i}`)?.scrollIntoView({ block: 'start' }) // instant — smooth is silently cancelled inside the scaled preview stage
                  : setActive(i)
              }
              style={{
                padding: '7px 16px',
                borderRadius: 999,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                background: on ? 'var(--c-primary)' : 'var(--c-surface)',
                color: on ? 'var(--c-primary-fg)' : 'var(--c-text-muted)',
                border: `1px solid ${on ? 'var(--c-primary)' : 'var(--c-border)'}`,
                opacity: !classic && filtering ? 0.6 : 1,
              }}
            >
              {pick(c.name, c.nameZh)}
            </button>
          );
        })}
        <input
          aria-label={searchLabel ? pick(searchLabel, searchLabelZh) : t3('Search the menu', '搜尋菜單', 'Buscar en el menú')}
          className="ls-input"
          style={{ width: 210, marginLeft: 'auto' }}
          placeholder={searchLabel ? pick(searchLabel, searchLabelZh) : t3('Search the menu…', '搜尋菜單…', 'Buscar en el menú…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {allBadges.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{t3('Filter by', '篩選', 'Filtrar por')}</span>
          {allBadges.map((b) => {
            const on = diet.includes(b);
            return (
              <button
                key={b}
                aria-pressed={on}
                onClick={() => setDiet(on ? diet.filter((x) => x !== b) : [...diet, b])}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: on ? 'var(--c-primary)' : 'color-mix(in srgb, var(--c-accent) 16%, transparent)',
                  color: on ? 'var(--c-primary-fg)' : 'var(--c-text)',
                  border: `1px solid ${on ? 'var(--c-primary)' : 'transparent'}`,
                  transition: 'background 130ms ease, color 130ms ease',
                }}
              >
                {lang === 'zh' ? (BADGE_LABELS[b]?.[1] ?? b) : (BADGE_LABELS[b]?.[0] ?? b)}
              </button>
            );
          })}
          {filtering && (
            <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)', marginLeft: 'auto' }}>
              {hits} {t3('dishes', '道菜', 'platos')}
            </span>
          )}
        </div>
      )}
      {filtering && hits === 0 && (
        <p style={{ color: 'var(--c-text-muted)', fontSize: 14, padding: '14px 0' }}>
          {t3('No dishes match. Try clearing a filter.', '沒有符合的菜色，試著清除篩選。', 'Ningún plato coincide. Prueba quitar un filtro.')}
        </p>
      )}
      {shown.map((cat, ci) => {
        const clickable = interactive || !!cart;
        if (classic) {
          // classic list: hairline rows in two columns, category hero photo tops
          // the right column (Chasu-style), badges as line glyphs beside the name
          const mid = Math.ceil(cat.items.length / 2);
          const cols = [cat.items.slice(0, mid), cat.items.slice(mid)];
          const hero = showImages ? cat.items.find((it) => it.imageUrl)?.imageUrl : undefined;
          const row = (it: MenuItem, i: number) => (
            <button
              key={it.id ?? i}
              onClick={() => clickable && setDetail(it)}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '13px 0', background: 'none', border: 'none', borderBottom: '1px solid var(--c-border)', cursor: clickable ? 'pointer' : 'default', color: 'var(--c-text)' }}
            >
              {showImages && it.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.imageUrl} alt={it.name} loading="lazy" decoding="async" className="ls-photo" style={{ width: 54, height: 54, borderRadius: 'var(--r-sm)', objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 16, fontWeight: 700 }}>{pick(it.name, it.nameZh)}</strong>
                  {/* bilingual gloss — the other language, so every row reads English + 中文 (gap gives the 8px) */}
                  {it.nameZh && (
                    <span style={{ fontSize: '0.85em', fontWeight: 500, color: 'color-mix(in srgb, var(--c-text) 62%, transparent)' }}>
                      {lang === 'zh' ? it.name : it.nameZh}
                    </span>
                  )}
                  {(it.badges?.length ?? 0) > 0 && (
                    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', transform: 'translateY(2px)' }}>
                      {it.badges!.map((b) => <MenuBadgeGlyph key={b} badge={b} color="var(--c-accent)" />)}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', color: 'color-mix(in srgb, var(--c-text) 92%, transparent)' }}>{money(it.priceCents)}</span>
                </div>
                {it.description && (
                  <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--c-text-muted)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {pick(it.description, it.descriptionZh)}
                  </p>
                )}
              </div>
            </button>
          );
          return (
            // scrollMarginTop clears the navbar plus the sticky chips row on jump
            <div key={cat.id ?? ci} id={`${uid}-cat-${cat.idx}`} style={{ marginBottom: 34, scrollMarginTop: 150 }}>
              <h3 className="font-heading" style={{ fontSize: 30, margin: '0 0 14px', fontWeight: 800, letterSpacing: '0.02em' }}>
                {pick(cat.name, cat.nameZh)}
              </h3>
              {hero && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero} alt="" loading="lazy" decoding="async" className="ls-photo md:hidden" style={{ width: '100%', height: 190, borderRadius: 'var(--r-sm)', objectFit: 'cover', marginBottom: 4 }} />
              )}
              <div className="grid gap-x-10 md:grid-cols-2">
                <div style={{ borderTop: '1px solid var(--c-border)' }}>{cols[0].map(row)}</div>
                <div style={{ borderTop: hero ? 'none' : '1px solid var(--c-border)' }}>
                  {hero && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={hero} alt="" loading="lazy" decoding="async" className="ls-photo max-md:hidden" style={{ width: '100%', height: 220, borderRadius: 'var(--r-sm)', objectFit: 'cover', marginBottom: 6 }} />
                  )}
                  {cols[1].map(row)}
                </div>
              </div>
            </div>
          );
        }
        if (gallery) {
          return (
            <div key={cat.id ?? ci} style={{ marginBottom: 26 }}>
              <h3 className="font-heading" style={{ fontSize: 22, margin: '0 0 16px', fontWeight: 700 }}>
                {pick(cat.name, cat.nameZh)}
              </h3>
              <div className="grid gap-5 md:grid-cols-3 max-md:grid-cols-1">
                {cat.items.map((it, i) => (
                  <button
                    key={it.id ?? i}
                    className="ls-card"
                    onClick={() => clickable && setDetail(it)}
                    style={{
                      padding: 0,
                      overflow: 'hidden',
                      cursor: clickable ? 'pointer' : 'default',
                      textAlign: 'left',
                      color: 'var(--c-text)',
                      border: '1px solid color-mix(in srgb, var(--c-text) 10%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {showImages && it.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        loading="lazy"
                        decoding="async"
                        className="ls-photo"
                        style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                      />
                    )}
                    <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                        <strong style={{ fontSize: 15.5 }}>{pick(it.name, it.nameZh)}</strong>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(it.priceCents)}</span>
                      </div>
                      {it.description && (
                        <p style={{ margin: 0, fontSize: 13, color: 'color-mix(in srgb, var(--c-text) 76%, transparent)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {pick(it.description, it.descriptionZh)}
                        </p>
                      )}
                      {(it.badges?.length ?? 0) > 0 && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
                          {it.badges!.map((b) => (
                            <span key={b} style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 22%, transparent)' }}>
                              {lang === 'zh' ? (BADGE_LABELS[b]?.[1] ?? b) : (BADGE_LABELS[b]?.[0] ?? b)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
        <div key={cat.id ?? ci} style={{ marginBottom: 18 }}>
          <h3 className="font-heading" style={{ fontSize: 22, margin: '0 0 16px', fontWeight: 700 }}>
            {pick(cat.name, cat.nameZh)}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {cat.items.map((it, i) => (
              <button
                key={it.id ?? i}
                className="ls-card"
                onClick={() => clickable && setDetail(it)}
                style={{
                  padding: 14,
                  display: 'flex',
                  gap: 14,
                  cursor: clickable ? 'pointer' : 'default',
                  textAlign: 'left',
                  color: 'var(--c-text)',
                  border: '1px solid color-mix(in srgb, var(--c-text) 10%, transparent)',
                }}
              >
                {showImages && it.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt={it.name} loading="lazy" decoding="async" className="ls-photo" style={{ width: 84, height: 84, borderRadius: 'var(--r-md)', objectFit: 'cover', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <strong style={{ fontSize: 15.5 }}>{pick(it.name, it.nameZh)}</strong>
                    <span style={{ color: 'color-mix(in srgb, var(--c-text) 92%, transparent)', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(it.priceCents)}</span>
                  </div>
                  {it.description && (
                    <p style={{ margin: '5px 0 0', fontSize: 13, color: 'color-mix(in srgb, var(--c-text) 76%, transparent)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {pick(it.description, it.descriptionZh)}
                    </p>
                  )}
                  {(it.badges?.length ?? 0) > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {it.badges!.map((b) => (
                        <span key={b} style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 22%, transparent)' }}>
                          {lang === 'zh' ? (BADGE_LABELS[b]?.[1] ?? b) : (BADGE_LABELS[b]?.[0] ?? b)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
        );
      })}
      {detail && (
        <ItemModal
          item={detail}
          onClose={() => setDetail(null)}
          onAdd={(mods, qty) => {
            cart?.add(detail, mods, qty);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

/* ── ordering widget with cart + checkout ── */

export function RtOrderingWidget({
  initialData,
  allowDelivery = true,
  allowTips = true,
  catalogKind = 'MENU',
  className,
  style,
}: Sty & { initialData?: MenuCategory[]; allowDelivery?: boolean; allowTips?: boolean; catalogKind?: 'MENU' | 'PRODUCT' }) {
  const { lang } = useSiteLang();
  // share the site-wide cart when the layout provides one (so items added on the
  // menu page show up here); otherwise fall back to a local, widget-scoped cart.
  const shared = useContext(CartCtx);
  // desktop has the sticky cart column right beside the menu, so the auto pill
  // yields; on a phone the column sits below a tall menu, so the pill stays and
  // scrolls to it — adding a dish must never be a one-way trip (mobile-kbd#1)
  useCartChromeClaim(true, ORDER_CART_ANCHOR);
  const local = useCartState(false);
  const cart = shared ?? local;
  const [checkout, setCheckout] = useState(false);
  const [done, setDone] = useState<{ code: string; totalCents: number; email?: string; notified?: { email: boolean; sms: boolean } } | null>(null);
  const [promo, setPromo] = useState<string | null>(null);
  const [tableNo, setTableNo] = useState<string | null>(null);
  /* mock/no-key deploys log notifications instead of sending — the success screen
     must not promise a text that will never arrive (audit dining#12). The answer
     rides on the order response (`notified`), not on the payment config: keyed to
     Stripe, this promised a receipt on every card-enabled site, wired or not. */

  // scan-to-order / win-back QR lands here with ?promo=CODE — welcome the customer;
  // a dine-in table card carries ?table=N — pin the table on the whole order flow
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const c = q.get('promo');
      if (c) setPromo(c.trim().toUpperCase());
      const t = q.get('table');
      if (t) setTableNo(t.trim().slice(0, 12));
    } catch {
      /* no query string */
    }
  }, []);

  if (done) {
    return (
      <div className={`ls-card ls-fade-up ${className ?? ''}`} style={{ padding: 40, textAlign: 'center', ...style }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><RtGlyph name="check" size={44} color="var(--c-primary)" /></div>
        <h3 className="font-heading" style={{ fontSize: 26, margin: '10px 0 6px' }}>
          {lang === 'es' ? '¡Pedido realizado!' : lang === 'zh' ? '訂單成立！' : 'Order placed!'}
        </h3>
        <p style={{ color: 'var(--c-text-muted)', margin: 0 }}>
          {lang === 'es' ? 'Número de pedido' : lang === 'zh' ? '單號' : 'Order number'} <strong style={{ color: 'var(--c-primary)' }}>{done.code}</strong> · {money(done.totalCents)}
        </p>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 13.5, marginTop: 10 }}>
          {/* Promise only what is actually wired. This used to read the STRIPE
              config, so a site with card payments but no Resend/Twilio key told
              every customer a text and an email were on the way while notify.ts
              logged them to the database and dropped them. */}
          {(() => {
            const email = !!done.notified?.email && !!done.email;
            const sms = !!done.notified?.sms;
            if (email && sms) return lang === 'es' ? 'Te enviaremos un SMS y correo de confirmación.' : lang === 'zh' ? '確認簡訊與 email 已寄出。' : 'A confirmation text & email are on the way.';
            if (email) return lang === 'es' ? 'Te enviaremos un correo de confirmación.' : lang === 'zh' ? '確認 email 已寄出。' : 'A confirmation email is on the way.';
            if (sms) return lang === 'es' ? 'Te enviaremos un SMS de confirmación.' : lang === 'zh' ? '確認簡訊已寄出。' : 'A confirmation text is on the way.';
            return lang === 'es' ? 'Pedido enviado. El negocio lo ha recibido.' : lang === 'zh' ? '訂單已送出，店家已收到。' : 'Your order is in. The shop has received it.';
          })()}
        </p>
        <button className="ls-btn" style={{ marginTop: 18 }} onClick={() => { setDone(null); setCheckout(false); cart.clear(); }}>
          {lang === 'es' ? 'Iniciar otro pedido' : lang === 'zh' ? '再點一單' : 'Start a new order'}
        </button>
      </div>
    );
  }

  return (
    <CartCtx.Provider value={cart}>
      <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
        {promo && (
          <div
            className="ls-fade-up"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12,
              background: 'var(--c-primary)', color: 'var(--c-primary-fg, #fff)', fontSize: 14,
            }}
          >
            <RtGlyph name="spark" size={18} color="var(--c-primary-fg, #fff)" />
            <span>
              {lang === 'es' ? (
                <>Cupón <b>{promo}</b> aplicado. Descuento al pagar.</>
              ) : lang === 'zh' ? (
                <>首單優惠 <b>{promo}</b> 已為你套用,結帳自動折扣。</>
              ) : (
                <>First-order offer <b>{promo}</b> applied. Discount at checkout.</>
              )}
            </span>
          </div>
        )}
        <div className="grid items-start gap-6 md:grid-cols-[1.7fr_1fr]">
          <RtMenuList initialData={initialData} interactive />
          {/* scrollMarginTop clears the sticky navbar when the mobile pill jumps here */}
          <div id={ORDER_CART_ANCHOR} className="md:sticky md:top-24" style={{ scrollMarginTop: 92 }}>
            {tableNo && (
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '4px 12px',
                  borderRadius: 999, border: '1px solid var(--c-primary)', color: 'var(--c-primary)',
                  fontSize: 12.5, fontWeight: 700,
                }}
              >
                {lang === 'es' ? `Mesa ${tableNo}` : lang === 'zh' ? `桌號 ${tableNo}` : `Table ${tableNo}`}
              </div>
            )}
            {!checkout ? (
              <CartPanel onCheckout={() => setCheckout(true)} catalogKind={catalogKind} />
            ) : (
              <CheckoutPanel
                allowDelivery={allowDelivery}
                allowTips={allowTips}
                onBack={() => setCheckout(false)}
                // the sale is done — empty the shared cart NOW, or the site-wide
                // pill keeps advertising the already-purchased items (dining#9)
                onDone={(d) => {
                  setDone(d);
                  cart.clear();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </CartCtx.Provider>
  );
}

function CartPanel({ onCheckout, catalogKind = 'MENU' }: { onCheckout: () => void; catalogKind?: 'MENU' | 'PRODUCT' }) {
  const cart = useCart();
  const { lang, pick } = useSiteLang();
  return (
    <div className="ls-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong style={{ fontSize: 15.5 }}>{lang === 'es' ? 'Tu pedido' : lang === 'zh' ? '你的訂單' : 'Your order'}</strong>
      {cart.lines.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-muted)' }}>
          {catalogKind === 'MENU'
            ? (lang === 'es' ? 'Toca un plato para empezar tu pedido.' : lang === 'zh' ? '點選菜色加入訂單。' : 'Tap a dish to start your order.')
            : (lang === 'es' ? 'Toca un artículo para empezar tu pedido.' : lang === 'zh' ? '點選商品加入訂單。' : 'Tap an item to start your order.')}
        </p>
      ) : (
        <>
          {cart.lines.map((l) => (
            <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{pick(l.item.name, l.item.nameZh)}</div>
                {l.modifiers.length > 0 && (
                  <div style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>{l.modifiers.join(', ')}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <QtyBtn label={lang === 'es' ? 'Menos' : lang === 'zh' ? '減少數量' : 'Decrease quantity'} onClick={() => cart.setQty(l.key, l.qty - 1)}>−</QtyBtn>
                <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{l.qty}</span>
                <QtyBtn label={lang === 'es' ? 'Más' : lang === 'zh' ? '增加數量' : 'Increase quantity'} onClick={() => cart.setQty(l.key, l.qty + 1)}>+</QtyBtn>
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 58, textAlign: 'right' }}>{money(l.unitCents * l.qty)}</span>
            </div>
          ))}
          <hr style={{ border: 'none', borderTop: '1px solid var(--c-border)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}>
            <span>{lang === 'es' ? 'Subtotal' : lang === 'zh' ? '小計' : 'Subtotal'}</span>
            <span>{money(cart.subtotal)}</span>
          </div>
          <button className="ls-btn" style={{ justifyContent: 'center' }} onClick={onCheckout}>
            {lang === 'es' ? 'Pagar' : lang === 'zh' ? '去結帳' : 'Checkout'}
          </button>
        </>
      )}
    </div>
  );
}

interface QuoteResp {
  lines: { itemId: string }[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  feeCents: number;
  tipCents: number;
  giftAppliedCents: number;
  loyaltyAppliedCents?: number;
  totalCents: number;
  couponError?: string;
  giftCardError?: string;
  loyaltyError?: string;
  deliveryError?: string;
}

function CheckoutPanel({
  allowDelivery,
  allowTips,
  onBack,
  onDone,
}: {
  allowDelivery: boolean;
  allowTips: boolean;
  onBack: () => void;
  onDone: (d: { code: string; totalCents: number; email?: string; notified?: { email: boolean; sms: boolean } }) => void;
}) {
  const cart = useCart();
  const { lang, pick } = useSiteLang();
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  const [mode, setMode] = useState<'pickup' | 'delivery'>('pickup');
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [slot, setSlot] = useState('asap');
  const [slots, setSlots] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [address, setAddress] = useState('');
  const [zip, setZip] = useState('');
  const [tipPct, setTipPct] = useState(allowTips ? 15 : 0);
  const [coupon, setCoupon] = useState('');
  const [giftCard, setGiftCard] = useState('');
  const [tableNo, setTableNo] = useState('');
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [quoteSig, setQuoteSig] = useState('');
  const [payMethod, setPayMethod] = useState<'online' | 'store'>('online');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState<'paused' | 'blackout' | ''>('');
  // loyalty redemption — balance looked up by phone, then $5 chunks as tender
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyAcct, setLoyaltyAcct] = useState<{ phone: string; points: number } | null>(null);
  const [loyaltyError, setLoyaltyError] = useState('');
  const [redeemCents, setRedeemCents] = useState(0);
  // last captured-but-unconsumed payment: a retry after a failed submit must
  // REUSE it, never charge the card a second time
  const captured = useRef<{ intentId: string; amountCents: number } | null>(null);

  // tip is computed on the SERVER subtotal once known — a stale local cart line
  // must not inflate the tip base (audit dining#4)
  const tipBase = quote?.subtotalCents ?? cart.subtotal;

  const quoteInput = useMemo(
    () => ({
      items: cart.lines.map((l) => ({ itemId: l.item.id, qty: l.qty, modifiers: l.modifiers })),
      mode,
      zip: zip || undefined,
      couponCode: coupon || undefined,
      giftCardCode: giftCard || undefined,
      tipCents: Math.round((tipBase * tipPct) / 100),
      loyalty:
        redeemCents > 0 && loyaltyAcct ? { phone: loyaltyAcct.phone, redeemCents } : undefined,
    }),
    [cart.lines, mode, zip, coupon, giftCard, tipPct, tipBase, redeemCents, loyaltyAcct],
  );

  // signature of the cart the current quote answered — stale-line detection must
  // never flag a line the server simply hasn't been asked about yet
  const idsSig = cart.lines.map((l) => l.item.id).join(',');
  useEffect(() => {
    if (cart.lines.length === 0) {
      setQuote(null); // nothing to price — never show totals for an empty cart
      return;
    }
    const sig = idsSig;
    const t = setTimeout(() => {
      apiPost<QuoteResp>('/orders/quote', quoteInput)
        .then((r) => {
          setQuote(r);
          setQuoteSig(sig);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [quoteInput, cart.lines.length, idsSig]);

  useEffect(() => {
    const date = new Date(Date.now() + (day === 'tomorrow' ? 86400000 : 0)).toLocaleDateString('en-CA');
    apiGet<{ slots: string[]; closed?: 'paused' | 'blackout' }>(`/orders/slots?date=${date}`)
      .then((r) => {
        setSlots(r.slots);
        if (day === 'today') setClosed(r.closed ?? '');
      })
      .catch(() => {});
  }, [day]);

  // tomorrow has no "asap" — land on the first real slot once it loads
  useEffect(() => {
    if (day === 'tomorrow' && slot === '' && slots.length > 0) setSlot(slots[0]);
  }, [day, slot, slots]);

  // items the customer still sees locally but the server no longer sells —
  // surfaced as "Unavailable" and they block submit (audit dining#4)
  const staleLines =
    quote && quoteSig === idsSig
      ? cart.lines.filter((l) => !quote.lines.some((s) => s.itemId === l.item.id))
      : [];

  // amount still due before the loyalty tender (invariant across redemption)
  const dueBeforeLoyalty = quote ? quote.totalCents + (quote.loyaltyAppliedCents ?? 0) : 0;
  const redeemOptions = loyaltyAcct ? loyaltyRedeemOptions(loyaltyAcct.points, dueBeforeLoyalty) : [];
  useEffect(() => {
    if (!loyaltyAcct || redeemCents === 0 || !quote) return;
    const max = maxLoyaltyRedeemCents(loyaltyAcct.points, dueBeforeLoyalty);
    if (redeemCents > max) setRedeemCents(max);
  }, [loyaltyAcct, redeemCents, quote, dueBeforeLoyalty]);

  async function checkLoyalty() {
    const p = (loyaltyPhone || phone).trim();
    setLoyaltyError('');
    if (!p) {
      setLoyaltyError(t3('Enter your phone number', '請輸入手機號碼', 'Ingresa tu número de teléfono'));
      return;
    }
    try {
      const r = await apiPost<{ points: number }>('/loyalty/balance', { phone: p });
      setLoyaltyAcct({ phone: p, points: r.points });
      setRedeemCents(0);
    } catch {
      setLoyaltyError(t3('No member found for that number.', '找不到這個號碼的會員資料。', 'No se encontró ningún miembro con ese número.'));
    }
  }

  // a scan-to-order / win-back QR link carries ?promo=CODE — auto-apply it so the
  // customer's first direct order gets the discount without typing anything;
  // a dine-in table card carries ?table=N — ride it along on the order
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const code = q.get('promo');
      if (code) setCoupon(code.trim().toUpperCase());
      const t = q.get('table');
      if (t) setTableNo(t.trim().slice(0, 12));
    } catch {
      /* no query string */
    }
  }, []);

  async function placeOrder() {
    setError('');
    if (!name || !phone) {
      setError(lang === 'es' ? 'Nombre y teléfono obligatorios' : lang === 'zh' ? '請填寫姓名與電話' : 'Name and phone are required');
      return;
    }
    if (staleLines.length > 0) {
      setError(t3('Remove the unavailable items first.', '請先移除已下架的品項。', 'Quita primero los artículos no disponibles.'));
      return;
    }
    if (day === 'tomorrow' && !slot) {
      setError(t3('Pick a time for tomorrow.', '請選擇明天的時段。', 'Elige una hora para mañana.'));
      return;
    }
    setBusy(true);
    try {
      let intentId: string | undefined;
      if (payMethod === 'online' && quote && quote.totalCents > 0) {
        if (captured.current?.amountCents === quote.totalCents) {
          // the card was already charged this exact amount on a failed submit —
          // reuse that intent instead of charging again
          intentId = captured.current.intentId;
        } else {
          // card reader first, THEN the charge: minting the intent before we knew
          // Stripe.js could load left orphan intents in the merchant's dashboard
          const { cardUnavailable, collectStripePayment, siteStripeOrNull } = await import('./stripe-sheet');
          const stripe = await siteStripeOrNull(lang);
          const intent = await apiPost<{ provider: string; clientSecret: string; externalId: string }>(
            '/payments/intent',
            { quote: quoteInput },
          );
          if (intent.provider === 'STRIPE') {
            if (!stripe) throw cardUnavailable(lang); // keys landed mid-checkout
            const ok = await collectStripePayment(stripe, intent.clientSecret);
            if (!ok) {
              setBusy(false);
              return;
            }
          }
          intentId = intent.externalId;
          captured.current = { intentId, amountCents: quote.totalCents };
        }
      }
      const fullyCovered = quote != null && quote.totalCents === 0;
      const res = await apiPost<{ code: string; totalCents: number; notified?: { email: boolean; sms: boolean } }>('/orders', {
        quote: quoteInput,
        contact: { name, phone, email, marketingOptIn: optIn },
        scheduledFor: day === 'tomorrow' ? `${new Date(Date.now() + 86400000).toLocaleDateString('en-CA')} ${slot}` : slot,
        address: address || undefined,
        zip: zip || undefined,
        tableNo: tableNo || undefined,
        payment: { method: fullyCovered ? 'store' : payMethod, intentId },
      });
      captured.current = null;
      // report the sale to GA4 / Meta so the merchant's ad dashboards see revenue
      trackConversion('purchase', {
        value: res.totalCents / 100,
        items: cart.lines.map((l) => ({ name: l.item.name, quantity: l.qty })),
      });
      onDone({ ...res, email: email || undefined });
    } catch (err) {
      // a consumed/refunded intent can't be reused — let the retry re-collect
      const code = (err as { code?: string }).code;
      if (code === 'PAYMENT_ALREADY_USED' || code === 'PAYMENT_REQUIRED') captured.current = null;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const q = quote;
  const testMode = payMethod === 'online';

  return (
    <div className="ls-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} aria-label={lang === 'es' ? 'Volver al carrito' : lang === 'zh' ? '返回購物車' : 'Back to cart'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-muted)', minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <RtGlyph name="arrow-left" size={18} color="currentColor" />
        </button>
        <strong style={{ fontSize: 15.5 }}>{lang === 'es' ? 'Pagar' : lang === 'zh' ? '結帳' : 'Checkout'}</strong>
      </div>

      {closed && (
        <div role="status" style={{ background: 'color-mix(in srgb, var(--c-primary) 12%, var(--c-surface))', border: '1px solid var(--c-primary)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, fontWeight: 600 }}>
          {closed === 'paused'
            ? lang === 'zh' ? '目前暫停接單，請稍後再試。' : lang === 'es' ? 'Pedidos pausados temporalmente.' : 'Ordering is temporarily paused. Please check back soon.'
            : lang === 'zh' ? '本日公休，明天見！' : lang === 'es' ? 'Hoy estamos cerrados.' : 'We are closed today. See you tomorrow!'}
        </div>
      )}

      {staleLines.length > 0 && (
        <div role="alert" style={{ border: '1px solid #c0392b', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <strong style={{ fontSize: 13, color: '#c0392b' }}>
            {t3('Some items are no longer available', '部分品項已下架', 'Algunos artículos ya no están disponibles')}
          </strong>
          {staleLines.map((l) => (
            <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ flex: 1, textDecoration: 'line-through' }}>{pick(l.item.name, l.item.nameZh)}</span>
              <span style={{ color: '#c0392b', fontWeight: 600 }}>{t3('Unavailable', '已下架', 'No disponible')}</span>
              <button
                onClick={() => cart.setQty(l.key, 0)}
                style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface)', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--c-text)' }}
              >
                {t3('Remove', '移除', 'Quitar')}
              </button>
            </div>
          ))}
        </div>
      )}

      {allowDelivery && (
        <div style={{ display: 'flex', gap: 8 }}>
          {(['pickup', 'delivery'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 999,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === m ? 'var(--c-primary)' : 'var(--c-surface)',
                color: mode === m ? 'var(--c-primary-fg)' : 'var(--c-text-muted)',
                border: `1px solid ${mode === m ? 'var(--c-primary)' : 'var(--c-border)'}`,
              }}
            >
              {m === 'pickup' ? (lang === 'es' ? 'Recoger' : lang === 'zh' ? '自取' : 'Pickup') : lang === 'es' ? 'Entrega' : lang === 'zh' ? '外送' : 'Delivery'}
            </button>
          ))}
        </div>
      )}

      {/* scheduling for BOTH pickup and delivery, today or tomorrow (dining#8) */}
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ flex: 1 }}>
          <span className="ls-label">{t3('Day', '日期', 'Día')}</span>
          <select
            className="ls-input"
            value={day}
            onChange={(e) => {
              const d = e.target.value as 'today' | 'tomorrow';
              setDay(d);
              setSlot(d === 'today' ? 'asap' : '');
            }}
          >
            <option value="today">{t3('Today', '今天', 'Hoy')}</option>
            <option value="tomorrow">{t3('Tomorrow', '明天', 'Mañana')}</option>
          </select>
        </label>
        <label style={{ flex: 1.4 }}>
          <span className="ls-label">
            {mode === 'pickup' ? t3('Pickup time', '取餐時間', 'Hora de recogida') : t3('Delivery time', '外送時間', 'Hora de entrega')}
          </span>
          <select className="ls-input" value={slot} onChange={(e) => setSlot(e.target.value)}>
            {day === 'today' && (
              <option value="asap">{t3('ASAP (~20 min)', '越快越好（約 20 分鐘）', 'Lo antes posible (~20 min)')}</option>
            )}
            {slots.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {day === 'tomorrow' && slots.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)', marginTop: -8 }}>
          {t3('Closed tomorrow.', '明日公休。', 'Cerrado mañana.')}
        </div>
      )}

      {mode === 'delivery' && (
        <>
          <input aria-label={lang === 'es' ? 'Dirección de entrega' : lang === 'zh' ? '外送地址' : 'Delivery address'} className="ls-input" placeholder={lang === 'es' ? 'Dirección de entrega' : lang === 'zh' ? '外送地址' : 'Delivery address'} value={address} onChange={(e) => setAddress(e.target.value)} />
          <input aria-label="ZIP" className="ls-input" placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} />
          {q?.deliveryError && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{q.deliveryError}</div>}
        </>
      )}

      <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} className="ls-input" placeholder={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input aria-label="Email" className="ls-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--c-text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} style={{ accentColor: 'var(--c-primary)' }} />
        {t3('Email me offers & updates', '寄送優惠與最新消息給我', 'Envíenme ofertas y novedades')}
      </label>

      {allowTips && (
        <div>
          <span className="ls-label">{lang === 'es' ? 'Propina' : lang === 'zh' ? '小費' : 'Tip'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 10, 15, 20].map((p) => (
              <button
                key={p}
                onClick={() => setTipPct(p)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 'var(--r-md)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: tipPct === p ? 'var(--c-primary)' : 'var(--c-surface)',
                  color: tipPct === p ? 'var(--c-primary-fg)' : 'var(--c-text)',
                  border: `1px solid ${tipPct === p ? 'var(--c-primary)' : 'var(--c-border)'}`,
                }}
              >
                {p === 0 ? (lang === 'es' ? 'Ninguna' : lang === 'zh' ? '不給' : 'None') : `${p}%`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input aria-label={lang === 'es' ? 'Código promocional' : lang === 'zh' ? '優惠碼' : 'Promo code'} className="ls-input" placeholder={lang === 'es' ? 'Código promocional' : lang === 'zh' ? '優惠碼' : 'Promo code'} value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
        <input aria-label={lang === 'es' ? 'Tarjeta de regalo' : lang === 'zh' ? '禮品卡' : 'Gift card'} className="ls-input" placeholder={lang === 'es' ? 'Tarjeta de regalo' : lang === 'zh' ? '禮品卡' : 'Gift card'} value={giftCard} onChange={(e) => setGiftCard(e.target.value.toUpperCase())} />
      </div>
      {q?.couponError && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: -8 }}>{q.couponError}</div>}
      {q?.giftCardError && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: -8 }}>{q.giftCardError}</div>}

      {/* loyalty redemption: look up the balance by phone, then apply $5 chunks
          as a tender against what's still due */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="ls-label" style={{ marginBottom: 0 }}>{t3('Loyalty points', '會員點數', 'Puntos de fidelidad')}</span>
        {!loyaltyAcct ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label={t3('Member phone number', '會員手機號碼', 'Teléfono de miembro')}
              className="ls-input"
              style={{ flex: 1 }}
              placeholder={t3('Member phone number', '會員手機號碼', 'Teléfono de miembro')}
              value={loyaltyPhone}
              onFocus={() => {
                if (!loyaltyPhone && phone) setLoyaltyPhone(phone);
              }}
              onChange={(e) => setLoyaltyPhone(e.target.value)}
            />
            <button className="ls-btn ls-btn-outline" style={{ padding: '8px 16px', fontSize: 13 }} onClick={checkLoyalty}>
              {t3('Check', '查詢', 'Ver')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            <span style={{ color: 'var(--c-text-muted)', whiteSpace: 'nowrap' }}>
              {loyaltyAcct.points} {t3('pts', '點', 'pts')}
            </span>
            {redeemOptions.length > 0 ? (
              <select
                aria-label={t3('Points to redeem', '折抵點數', 'Puntos a canjear')}
                className="ls-input"
                style={{ flex: 1 }}
                value={redeemCents}
                onChange={(e) => setRedeemCents(Number(e.target.value))}
              >
                <option value={0}>{t3('No redemption', '不折抵', 'Sin canje')}</option>
                {redeemOptions.map((v) => (
                  <option key={v} value={v}>
                    {`−${money(v)} (${v / 5} ${t3('pts', '點', 'pts')})`}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ color: 'var(--c-text-muted)' }}>
                {t3('Not enough points to redeem yet.', '點數還不足以折抵。', 'Aún no hay puntos suficientes para canjear.')}
              </span>
            )}
          </div>
        )}
        {loyaltyError && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{loyaltyError}</div>}
        {q?.loyaltyError && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{q.loyaltyError}</div>}
      </div>

      {q && (
        <div style={{ fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Row label={lang === 'es' ? 'Subtotal' : lang === 'zh' ? '小計' : 'Subtotal'} value={money(q.subtotalCents)} />
          {q.discountCents > 0 && <Row label={lang === 'es' ? 'Descuento' : lang === 'zh' ? '折扣' : 'Discount'} value={`−${money(q.discountCents)}`} accent />}
          <Row label={lang === 'es' ? 'Impuesto' : lang === 'zh' ? '稅' : 'Tax'} value={money(q.taxCents)} />
          {q.feeCents > 0 && <Row label={lang === 'es' ? 'Costo de entrega' : lang === 'zh' ? '外送費' : 'Delivery fee'} value={money(q.feeCents)} />}
          {q.tipCents > 0 && <Row label={lang === 'es' ? 'Propina' : lang === 'zh' ? '小費' : 'Tip'} value={money(q.tipCents)} />}
          {q.giftAppliedCents > 0 && <Row label={lang === 'es' ? 'Tarjeta de regalo' : lang === 'zh' ? '禮品卡折抵' : 'Gift card'} value={`−${money(q.giftAppliedCents)}`} accent />}
          {(q.loyaltyAppliedCents ?? 0) > 0 && <Row label={lang === 'es' ? 'Puntos de fidelidad' : lang === 'zh' ? '會員點數' : 'Loyalty'} value={`−${money(q.loyaltyAppliedCents!)}`} accent />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15.5, marginTop: 4 }}>
            <span>{lang === 'es' ? 'Total' : lang === 'zh' ? '合計' : 'Total'}</span>
            <span>{money(q.totalCents)}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {(['online', 'store'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPayMethod(m)}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 'var(--r-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: payMethod === m ? 'color-mix(in srgb, var(--c-primary) 10%, transparent)' : 'var(--c-surface)',
              color: 'var(--c-text)',
              border: `1.5px solid ${payMethod === m ? 'var(--c-primary)' : 'var(--c-border)'}`,
            }}
          >
            {m === 'online' ? (lang === 'es' ? 'Pagar en línea' : lang === 'zh' ? '線上付款' : 'Pay online') : lang === 'es' ? 'Pagar en tienda' : lang === 'zh' ? '到店付款' : 'Pay at store'}
          </button>
        ))}
      </div>

      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{error}</div>}

      <button className="ls-btn" style={{ justifyContent: 'center' }} disabled={busy || cart.lines.length === 0 || !!closed || staleLines.length > 0} onClick={placeOrder}>
        {busy ? (lang === 'es' ? 'Procesando…' : lang === 'zh' ? '處理中…' : 'Processing…') : lang === 'es' ? 'Realizar pedido' : lang === 'zh' ? '送出訂單' : 'Place order'}
      </button>
      {testMode && <MockNote />}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: accent ? 'var(--c-primary)' : 'var(--c-text-muted)' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function MockNote() {
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ provider: string }>('/payments/config').then((c) => setProvider(c.provider)).catch(() => {});
  }, []);
  if (provider !== 'mock') return null;
  return (
    <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', textAlign: 'center', padding: '6px 10px', border: '1px dashed var(--c-border)', borderRadius: 'var(--r-md)' }}>
      Test mode, no real charge. Add Stripe keys in .env to take live payments.
    </div>
  );
}

