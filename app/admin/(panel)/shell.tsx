'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AdmIcon, admGet, admPost, ConfirmHost, money, useAdmLang, useAdmTheme } from '../ui';
import { site } from '@/lib/site-config';
import { useLiveBusiness } from '@/lib/business-client';

interface LatestOrder {
  id: string;
  code: string;
  contactName: string;
  totalCents: number;
  status: string;
}

/* short two-note chime via WebAudio — no audio asset shipped */
function playChime() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    [880, 1320].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      g.connect(ac.destination);
      const t0 = ac.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.start(t0);
      o.stop(t0 + 0.24);
    });
    setTimeout(() => ac.close(), 800);
  } catch {
    /* audio may be blocked until a user gesture — the banner still shows */
  }
}

/* content types are defined in the editor, not here — an empty Content screen
   would just be a dead end */
const hasCollections = ((site as unknown as { collections?: unknown[] }).collections ?? []).length > 0;

/* A brokerage opens its inventory first, so Listings sits directly under the
   dashboard — the same seat Orders takes for a restaurant. Driven by the
   site's own data flag, not by which component happens to be on a page. */
const hasListings = (site as unknown as { features?: { listings?: boolean } }).features?.listings === true;

/* Nav follows the site's modules — a law firm's back office must not grow a POS
   register. An entry shows when ANY of its `mod` is enabled; `mod: []` means the
   screen is core and ships with every site. `mod` is REQUIRED on purpose: an
   OPTIONAL one is how Customers and Reports drifted into showing on sites that
   had neither, since a forgotten field silently read as "always".
   `when` = an extra condition the module flags alone cannot express.

   This list must agree with ADMIN_SCREENS in codegen's module-map.ts, which
   decides whether the page behind the link is exported at all. */
const NAV: { href: string; en: string; zh: string; icon: string; mod: string[]; when?: boolean }[] = [
  { href: '/admin', en: 'Dashboard', zh: '總覽', icon: 'dashboard', mod: [] },
  { href: '/admin/listings', en: 'Listings', zh: '物件', icon: 'catalog', mod: ['content'], when: hasListings },
  { href: '/admin/orders', en: 'Orders', zh: '訂單', icon: 'orders', mod: ['orders'] },
  { href: '/admin/pos', en: 'POS register', zh: 'POS 收銀', icon: 'pos', mod: ['orders'] },
  { href: '/admin/catalog', en: 'Catalog', zh: '目錄', icon: 'catalog', mod: ['catalog'] },
  { href: '/admin/bookings', en: 'Bookings', zh: '預約', icon: 'bookings', mod: ['reservations', 'appointments'] },
  // three tabs: profiles + inbox (customers), moderation queue (reviews)
  { href: '/admin/customers', en: 'Customers', zh: '顧客', icon: 'customers', mod: ['customers', 'reviews'] },
  // above Content on purpose: an editor opens the desk first and the story second
  { href: '/admin/desk', en: 'The desk', zh: '編輯檯', icon: 'collections', mod: ['desk'] },

  { href: '/admin/collections', en: 'Content', zh: '內容', icon: 'collections', mod: ['collections'], when: hasCollections },
  // coupons + gift cards (promotions), announcements/posts/listings (content),
  // the audience list (customers)
  { href: '/admin/marketing', en: 'Marketing', zh: '行銷', icon: 'marketing', mod: ['promotions', 'content', 'customers'] },
  // selling space is its own business with its own screen: inventory, who
  // booked it, and what it delivered
  { href: '/admin/ads', en: 'Ads', zh: '廣告', icon: 'marketing', mod: ['ads'] },
  // the whole page is /stats/reports
  /* The door to Naratake Operations: inquiries, missed calls and texts live
     there (one inbox per BUSINESS, not per website), and this jumps straight
     in — same session, no second password.

     `mod` only says the CODE shipped; whether the site is actually WIRED is a
     deploy-time fact (three envs), so this entry is filtered again below on a
     live probe. A nav item that only ever apologises is worse than no item.

     No unread badge on purpose: a count would mean a cross-service call on
     every back-office page load, tying this shell's speed to the platform's
     uptime. New leads reach the owner by SMS and email the moment they land —
     that is the notification channel, and it works when nobody is logged in. */
  { href: '/admin/inbox', en: 'Inquiries', zh: '詢價', icon: 'customers', mod: ['platform_link'] },
  { href: '/admin/reports', en: 'Reports', zh: '報表', icon: 'reports', mod: ['analytics'] },
  { href: '/admin/settings', en: 'Settings', zh: '設定', icon: 'settings', mod: [] },
].filter((n) => (n.mod.length === 0 || n.mod.some((m) => site.enabledModules.includes(m))) && n.when !== false);

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const business = useLiveBusiness();
  /* Phone nav drawer. Closes on route change too — tapping a link navigates
     client-side, so without this the drawer would still be covering the screen
     the merchant just asked for. */
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [path]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  const [unread, setUnread] = useState(0);
  // 'mock' = no keys at all; 'testkey' = real Stripe keys, but the TEST pair
  const [testPay, setTestPay] = useState<'mock' | 'testkey' | null>(null);
  /* a live-key site whose register has no reader charges nobody at the counter
     while the settings page says "live charges enabled" */
  const [noReader, setNoReader] = useState(false);
  // exported ≠ wired: ask once whether the three platform envs are actually set
  const [inboxReady, setInboxReady] = useState<boolean | null>(null);
  const [alert, setAlert] = useState<LatestOrder | null>(null);
  const lastOrderId = useRef<string | null>(null);
  const { lang, setLang, t } = useAdmLang();
  const { theme, setTheme } = useAdmTheme();

  useEffect(() => {
    admGet<{ unreadInbox: number; pendingReviews: number }>('/stats/overview')
      .then((s) => setUnread(s.unreadInbox + s.pendingReviews))
      .catch(() => {});
  }, [path]);

  /* Payment mode — a merchant must never mistake simulated charges for revenue.
     TEST KEYS are the dangerous half of this: with sk_test_ set, the provider is
     'stripe', every order lands with a green PAID pill and this banner used to
     stay hidden — a shop could trade all week and be paid nothing. */
  useEffect(() => {
    admGet<{ payments?: { provider: string; mode?: string | null; terminal?: boolean } }>('/settings')
      .then((s) => {
        setTestPay(
          s.payments?.provider === 'mock' ? 'mock' : s.payments?.mode === 'test' ? 'testkey' : null,
        );
        setNoReader(s.payments?.provider === 'stripe' && s.payments?.terminal === false);
      })
      .catch(() => {});
  }, []);

  /* Is the inbox actually wired to this site? Only asked when the module
     shipped, and a failure hides the door rather than showing a dead one. */
  useEffect(() => {
    // named literally, not inferred from NAV: the hot-plug gate reads this
    // line to prove a core screen never calls a module's endpoint blind
    if (!site.enabledModules.includes('platform_link')) return;
    admGet<{ configured: boolean }>('/platform/status')
      .then((r) => setInboxReady(r.configured))
      .catch(() => setInboxReady(false));
  }, []);

  // watch for new orders — leave the admin open at the counter and get pinged
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await admGet<{ latestOrder: LatestOrder | null }>('/stats/overview');
        if (!alive) return;
        const o = s.latestOrder;
        if (!o) return;
        if (lastOrderId.current === null) {
          lastOrderId.current = o.id; // baseline: don't announce orders already there
          return;
        }
        if (o.id !== lastOrderId.current) {
          lastOrderId.current = o.id;
          setAlert(o);
          playChime();
          window.setTimeout(() => setAlert((c) => (c?.id === o.id ? null : c)), 7000);
        }
      } catch {
        /* offline / logged out — retry next tick */
      }
    };
    poll();
    const iv = window.setInterval(poll, 18000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  return (
    <div className="adm">
      <div className="adm-shell">
        <aside className="adm-side">
          {/* The merchant's own mark, when they have one. The gradient chip in
              admin.css is the fallback identity for a business that uploaded no
              logo; a brand that HAS one should meet it here every morning —
              this is the screen its owner opens more often than the site. */}
          <div className="adm-brand" data-haslogo={site.business.logo ? 'true' : undefined}>
            {site.business.logo ? (
              // width+height on the element, not only in CSS: the box has to be
              // reserved before the file arrives or the whole sidebar steps down
              // as it loads. eslint-disable-next-line @next/next/no-img-element
              <img src={site.business.logo} alt="" width={26} height={26} className="adm-brand-logo" />
            ) : null}
            <span>
              {/* the live name: the sidebar sitting next to the Settings form
                  must not be the last place still showing the old one */}
              {business.name}
              <small>{t('Backoffice', '後台管理')}</small>
            </span>
          </div>
          {/* Phone: everything but the brand lives behind this, the way the
              storefront's own nav does. A top bar that tried to show 14 links
              at once was a wall of chrome; a strip you scroll sideways hides
              where you can go. A drawer shows the whole map at once and gives
              the screen back. */}
          <button
            type="button"
            className="adm-burger"
            aria-label={t('Menu', '選單')}
            aria-expanded={navOpen}
            aria-controls="adm-drawer"
            onClick={() => setNavOpen((v) => !v)}
          >
            <span aria-hidden>{navOpen ? '✕' : '☰'}</span>
          </button>
          {/* `display: contents` on the desktop column, so the nav links and the
              foot stay direct flex children of .adm-side and that layout is
              untouched; on a phone this box IS the drawer, and it has to be one
              box — two independently-sliding panels drift apart. */}
          <div className="adm-drawer" id="adm-drawer" data-open={navOpen || undefined}>
          {/* client-side navigation — a full-page <a> reload would reboot every
              store and refetch the world on each sidebar click */}
          <nav className="adm-nav" onClick={() => setNavOpen(false)}>
            {NAV.filter((n) => n.href !== '/admin/inbox' || inboxReady).map((n) => (
              <Link key={n.href} href={n.href} className="adm-nav-item" data-active={path === n.href}>
                <span aria-hidden style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}><AdmIcon name={n.icon} /></span>
                {lang === 'zh' ? n.zh : n.en}
                {n.href === '/admin/customers' && unread > 0 && <span className="adm-nav-badge">{unread}</span>}
              </Link>
            ))}
          </nav>
          {/* styled in admin.css, not inline: the phone layout has to change this
              box's `display`, and an inline style outranks every stylesheet */}
          <div className="adm-side-foot">
            <div className="adm-lang" role="group" aria-label={t('Theme', '主題')}>
              {(['aurora', 'onyx', 'helvetia'] as const).map((v) => (
                <button
                  key={v}
                  className="adm-lang-btn"
                  data-active={theme === v}
                  onClick={() => setTheme(v)}
                  type="button"
                >
                  {v === 'aurora' ? 'Aurora' : v === 'onyx' ? 'Onyx' : 'Helvetia'}
                </button>
              ))}
            </div>
            <div className="adm-lang" role="group" aria-label={t('Language', '語言')}>
              <button
                className="adm-lang-btn"
                data-active={lang === 'en'}
                onClick={() => setLang('en')}
                type="button"
              >
                EN
              </button>
              <button
                className="adm-lang-btn"
                data-active={lang === 'zh'}
                onClick={() => setLang('zh')}
                type="button"
              >
                中文
              </button>
            </div>
            <a href="/" target="_blank" className="adm-nav-item">
              ↗ {t('View site', '前往網站')}
            </a>
            <button
              className="adm-btn"
              onClick={async () => {
                await admPost('/auth/logout', {});
                window.location.href = '/admin/login';
              }}
            >
              {t('Sign out', '登出')}
            </button>
          </div>
          </div>
          {/* tap-anywhere-else to close. Rendered inside the bar so it inherits
              nothing from the page and can never trap a click on the content. */}
          {navOpen && <div className="adm-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
        </aside>
        <main className="adm-main">
          {testPay && (
            <div style={{ margin: '0 0 14px', padding: '7px 14px', borderRadius: 10, border: '1px solid var(--a-warn)', background: 'var(--a-warn-soft)', color: 'var(--a-warn)', fontSize: 12.5, fontWeight: 700 }}>
              {testPay === 'mock'
                ? t('TEST MODE: online payments are simulated', '測試模式:線上付款不會真的扣款')
                : t(
                    'TEST KEYS: orders marked PAID were never charged. Switch to your sk_live_ / pk_live_ keys to be paid.',
                    '測試金鑰:標示「已付」的訂單其實沒有扣到款。換成 sk_live_ / pk_live_ 才會真的收到錢。',
                  )}
            </div>
          )}
          {noReader && (
            <div style={{ margin: '0 0 14px', padding: '7px 14px', borderRadius: 10, border: '1px solid var(--a-warn)', background: 'var(--a-warn-soft)', color: 'var(--a-warn)', fontSize: 12.5, fontWeight: 700 }}>
              {t(
                'No card reader connected: the register\u2019s Card button SIMULATES the charge and takes no money. Take cash, or connect a Stripe Terminal reader.',
                '未連接讀卡機:收銀台的「刷卡」是模擬的,不會真的收到錢。請收現金,或接上 Stripe Terminal 讀卡機。',
              )}
            </div>
          )}
          {children}
        </main>
      </div>
      <ConfirmHost />
      {alert && (
        <Link
          href="/admin/orders"
          className="adm-order-alert"
          onClick={() => setAlert(null)}
        >
          <span className="adm-order-alert-bell" aria-hidden><AdmIcon name="bell" size={18} /></span>
          <span>
            <strong>{t('New order', '新訂單')} · {alert.code}</strong>
            <br />
            <span style={{ color: 'var(--a-faint)', fontSize: 12.5 }}>
              {alert.contactName} · {money(alert.totalCents)}
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}
