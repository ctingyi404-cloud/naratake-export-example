'use client';

import { AdmIcon, money, useLoad, useAdmLang } from '../ui';
import { TrendChart } from '@/components/admin-charts';
import { site } from '@/lib/site-config';
import { publishedBusiness, type PublicBusiness } from '@/lib/business-profile';

interface Stats {
  todayRevenueCents: number;
  todayOrders: number;
  upcomingReservations: number;
  upcomingAppointments: number;
  pendingReviews: number;
  unreadInbox: number;
  publishedPosts: number;
  revenueByDay: { date: string; cents: number }[];
  topItems: { name: string; qty: number }[];
}

/* Local SEO health — five checks against what Google actually ranks a small
   business on. Reads the LIVE business profile + the stats the dashboard
   already loads.

   It used to read site.config.json, which made the second check unwinnable:
   it told the merchant "Replace the placeholder phone and address in Settings",
   they did exactly that, Settings wrote the database — and the check went on
   reading the file that only a republish can change. A checklist that stays red
   after you do what it asks teaches people to ignore checklists. */
function seoChecks(publishedPosts: number, b: PublicBusiness) {
  return [
    {
      ok: !!b.socials?.google,
      label: ['Google Business Profile linked', '已連結 Google 商家檔案'],
      fix: ['Add your Google review link in Studio → Site → Socials.', '到 Studio → 網站設定 → 社群,補上 Google 商家連結。'],
    },
    {
      ok: !!b.phone && !b.phone.includes('555') && !!b.address.line1 && !!b.address.city,
      label: ['Name, address & phone complete', '名稱/地址/電話完整'],
      fix: ['Replace the placeholder phone and address in Settings.', '到「設定」把占位電話與地址換成真實資料。'],
    },
    {
      ok: Object.values(b.hours ?? {}).some((spans) => spans && spans.length),
      label: ['Business hours published', '已刊出營業時間'],
      fix: ['Fill in opening hours in Settings. Google shows them in search.', '到「設定」填寫營業時間,Google 搜尋會直接顯示。'],
    },
    {
      ok: true, // sitemap.xml + robots.txt ship with every export
      label: ['Sitemap & robots.txt live', 'Sitemap 與 robots.txt 已上線'],
      fix: ['', ''],
    },
    {
      ok: publishedPosts > 0,
      label: ['At least one published post', '至少一篇已發佈文章'],
      fix: ['Add an article to your Blog section in Studio, then redeploy. Fresh content lifts local rankings.', '到 Studio 的部落格區塊新增文章後重新導出,新內容能提升在地排名。'],
    },
  ];
}

/* The dashboard is the one screen that reads every module, so it must adapt
   rather than depend: it shows a tile only when the module behind it is
   installed. Without this a job board's owner opens their back office to
   "Today's revenue: —" and four dead numbers. */
const has = (m: string) => site.enabledModules.includes(m);

export default function Dashboard() {
  const { data } = useLoad<Stats>('/stats/overview');
  /* The same resolved profile the Settings screen edits and the storefront
     renders — not the row, and not the config. Falls back to the published
     values until it lands, which is what the checks used to read anyway. */
  const { data: settings } = useLoad<{ name: string; phone: string; email: string; address: PublicBusiness['address']; hours: PublicBusiness['hours'] }>('/settings');
  const business: PublicBusiness = settings ? { ...publishedBusiness(), ...settings } : publishedBusiness();
  const { t } = useAdmLang();

  const tiles = [
    has('orders') && { label: t('Today’s revenue', '今日營收'), value: data ? money(data.todayRevenueCents) : '—' },
    has('orders') && { label: t('Today’s orders', '今日訂單'), value: data?.todayOrders ?? '—' },
    has('reservations') && { label: t('Upcoming reservations', '即將到來的訂位'), value: data?.upcomingReservations ?? '—' },
    has('appointments') && { label: t('Upcoming appointments', '即將到來的預約'), value: data?.upcomingAppointments ?? '—' },
    has('reviews') && { label: t('Reviews awaiting you', '待審核評論'), value: data?.pendingReviews ?? '—' },
    has('content') && { label: t('Published posts', '已發佈文章'), value: data?.publishedPosts ?? '—' },
    { label: t('Unread messages', '未讀訊息'), value: data?.unreadInbox ?? '—' },
  ].filter(Boolean) as { label: string; value: string | number }[];

  return (
    <>
      <h1 className="adm-page-title">{t('Dashboard', '總覽')}</h1>
      <p className="adm-page-sub">{t('A live look at today and the past week.', '即時掌握今天與過去一週的營運。')}</p>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(tiles.length, 4)}, 1fr)`, gap: 14, marginBottom: 20 }}>
        {tiles.map((tile) => (
          <div key={tile.label} className="adm-card adm-stat">
            <div className="adm-stat-label">{tile.label}</div>
            <div className="adm-stat-value">{tile.value}</div>
          </div>
        ))}
      </div>

      {has('orders') && (
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, alignItems: 'stretch' }}>
        <div className="adm-card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div className="adm-stat-label" style={{ marginBottom: 0 }}>{t('Revenue · last 7 days', '營收 · 近 7 天')}</div>
            <strong style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
              {data ? money(data.revenueByDay.reduce((s, d) => s + d.cents, 0)) : '—'}
            </strong>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
            {data && (
              <TrendChart
                data={data.revenueByDay}
                height={130}
                format={money}
                onPick={(date) => { window.location.href = `/admin/orders?rdate=${date}`; }}
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10.5, color: 'var(--a-faint)' }}>
              {data?.revenueByDay.map((d) => <span key={d.date}>{d.date.slice(5)}</span>)}
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--a-faint)' }}>
            {t('Hover for a day’s detail · click to open its records', '滑過看單日明細，點一下開當日紀錄')}
          </div>
        </div>
        <div className="adm-card" style={{ padding: 20 }}>
          <div className="adm-stat-label" style={{ marginBottom: 12 }}>{t('Top items this week', '本週熱銷品項')}</div>
          {(data?.topItems.length ?? 0) === 0 && <div style={{ color: 'var(--a-faint)', fontSize: 13 }}>{t('No orders yet.', '尚無訂單。')}</div>}
          {data?.topItems.map((it, i) => (
            <div key={it.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--a-border)', fontSize: 13.5 }}>
              <span>
                <span style={{ color: 'var(--a-faint)', marginRight: 8 }}>{i + 1}</span>
                {it.name}
              </span>
              <strong>×{it.qty}</strong>
            </div>
          ))}
        </div>
      </div>
      )}

      {data && (
        <div className="adm-card" style={{ padding: 20, marginTop: 14 }}>
          <div className="adm-stat-label" style={{ marginBottom: 12 }}>{t('Local SEO', '本地 SEO 健檢')}</div>
          {seoChecks(data.publishedPosts, business).map((chk) => (
            <div key={chk.label[0]} className="adm-check">
              <span
                aria-hidden
                className="adm-check-dot"
                style={{ background: chk.ok ? 'var(--a-primary)' : 'var(--a-danger)' }}
              />
              <span className="adm-check-label">{t(chk.label[0], chk.label[1])}</span>
              {!chk.ok && <span className="adm-check-fix">{t(chk.fix[0], chk.fix[1])}</span>}
              <span className="adm-pill adm-check-pill" data-tone={chk.ok ? 'ok' : 'danger'}>
                {chk.ok ? t('Pass', '通過') : t('Fix', '待修')}
              </span>
            </div>
          ))}
        </div>
      )}

      {data && (data.pendingReviews > 0 || data.unreadInbox > 0) && (
        <div className="adm-card" style={{ padding: 16, marginTop: 14, display: 'flex', gap: 18, alignItems: 'center' }}>
          <AdmIcon name="bell" size={18} />
          {data.unreadInbox > 0 && (
            <a href="/admin/customers" style={{ color: 'var(--a-info)', fontWeight: 600, fontSize: 13.5 }}>
              {t(
                `${data.unreadInbox} unread message${data.unreadInbox > 1 ? 's' : ''} in the inbox`,
                `收件匣有 ${data.unreadInbox} 則未讀訊息`,
              )}
            </a>
          )}
          {data.pendingReviews > 0 && (
            <a href="/admin/customers" style={{ color: 'var(--a-warn)', fontWeight: 600, fontSize: 13.5 }}>
              {t(
                `${data.pendingReviews} review${data.pendingReviews > 1 ? 's' : ''} awaiting approval`,
                `${data.pendingReviews} 則評論待審核`,
              )}
            </a>
          )}
        </div>
      )}
    </>
  );
}
