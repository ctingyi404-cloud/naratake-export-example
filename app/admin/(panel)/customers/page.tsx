'use client';

import { useState } from 'react';
import { admDelete, admPatch, confirmDlg, EmptyRow, money, TableLoading, useLoad, useAdmLang } from '../../ui';

type Tab = 'customers' | 'reviews' | 'inbox';

const TAB_LABELS: Record<Tab, [string, string]> = {
  customers: ['Customers', '顧客'],
  reviews: ['Reviews', '評論'],
  inbox: ['Inbox', '收件匣'],
};

const KIND_LABELS: Record<string, [string, string]> = {
  quote: ['quote', '估價'],
  inquiry: ['inquiry', '諮詢'],
  contact: ['contact', '聯絡'],
  booking: ['booking', '預約'],
};

export default function CustomersPage() {
  const [tab, setTab] = useState<Tab>('customers');
  const { lang, t } = useAdmLang();
  return (
    <>
      <h1 className="adm-page-title">{t('Customers', '顧客')}</h1>
      <p className="adm-page-sub">{t('Profiles, reviews to moderate, and messages from your site.', '顧客檔案、待審核的評論，以及來自網站的訊息。')}</p>
      <div className="adm-tabs">
        {(['customers', 'reviews', 'inbox'] as Tab[]).map((tb) => (
          <button key={tb} className="adm-tab" data-active={tab === tb} onClick={() => setTab(tb)}>
            {lang === 'zh' ? TAB_LABELS[tb][1] : TAB_LABELS[tb][0]}
          </button>
        ))}
      </div>
      {tab === 'customers' && <Customers />}
      {tab === 'reviews' && <Reviews />}
      {tab === 'inbox' && <Inbox />}
    </>
  );
}

interface Cust {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  marketingOptIn: boolean;
  orderCount: number;
  totalCents: number;
  createdAt: string;
}

function Customers() {
  const { data, loading } = useLoad<{ customers: Cust[] }>('/customers');
  const { t } = useAdmLang();
  return (
    <div className="adm-card">
      <table className="adm-table">
        <thead>
          <tr>
            <th>{t('Customer', '顧客')}</th>
            <th>{t('Contact', '聯絡方式')}</th>
            <th>{t('Orders', '訂單數')}</th>
            <th>{t('Lifetime value', '累計消費')}</th>
            <th>{t('Marketing', '行銷訂閱')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && !data && <TableLoading colSpan={5} />}
          {!loading && (data?.customers ?? []).length === 0 && (
            <EmptyRow colSpan={5}>
              {t(
                'No customers yet — profiles build themselves from checkouts, bookings, and newsletter signups.',
                '還沒有顧客——顧客檔案會從結帳、預約與訂閱名單自動累積。',
              )}
            </EmptyRow>
          )}
          {(data?.customers ?? []).map((c) => (
            <tr key={c.id}>
              <td style={{ fontWeight: 700 }}>{c.name ?? '—'}</td>
              <td style={{ fontSize: 13 }}>
                {c.phone}
                {c.email && <div style={{ color: 'var(--a-faint)' }}>{c.email}</div>}
              </td>
              <td>{c.orderCount}</td>
              <td>{money(c.totalCents)}</td>
              <td>
                {c.marketingOptIn ? (
                  <span className="adm-pill" data-tone="ok">{t('subscribed', '已訂閱')}</span>
                ) : (
                  <span className="adm-pill" data-tone="muted">{t('no', '未訂閱')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Review {
  id: string;
  rating: number;
  text?: string | null;
  authorName: string;
  approved: boolean;
  createdAt: string;
}

function Reviews() {
  const { data, reload, loading } = useLoad<{ reviews: Review[] }>('/reviews');
  const { t } = useAdmLang();
  const list = data?.reviews ?? [];
  return (
    <div className="adm-card">
      <table className="adm-table">
        <tbody>
          {loading && list.length === 0 && <TableLoading colSpan={4} />}
          {!loading && list.length === 0 && (
            <EmptyRow colSpan={4}>
              {t(
                'No reviews yet — reviews customers leave on your site wait here for approval before going live.',
                '還沒有評論——顧客在網站留下的評論會先到這裡等你審核，通過才會上架。',
              )}
            </EmptyRow>
          )}
          {list.map((r) => (
            <tr key={r.id}>
              <td style={{ width: 110, color: 'var(--a-warn)', letterSpacing: 2 }}>{'★'.repeat(r.rating)}</td>
              <td>
                <strong>{r.authorName}</strong>
                <div style={{ fontSize: 13, color: 'var(--a-dim)', maxWidth: 520 }}>{r.text}</div>
              </td>
              <td>
                <span className="adm-pill" data-tone={r.approved ? 'ok' : 'warn'}>
                  {r.approved ? t('live', '已上架') : t('pending', '待審核')}
                </span>
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button
                  className="adm-btn adm-btn-sm"
                  style={{ marginRight: 6 }}
                  onClick={async () => {
                    await admPatch(`/reviews/${r.id}`, { approved: !r.approved });
                    reload();
                  }}
                >
                  {r.approved ? t('Hide', '隱藏') : t('Approve', '核准')}
                </button>
                <button
                  className="adm-btn adm-btn-sm adm-btn-danger"
                  onClick={async () => {
                    if (await confirmDlg(t('Delete this review?', '要刪除這則評論嗎？'), { confirmLabel: t('Delete', '刪除') })) {
                      await admDelete(`/reviews/${r.id}`);
                      reload();
                    }
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Submission {
  id: string;
  kind: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  meta?: { photos?: string[]; listing?: string } | null;
  read: boolean;
  createdAt: string;
}

function Inbox() {
  const { data, reload, loading } = useLoad<{ submissions: Submission[] }>('/inbox');
  const { lang, t } = useAdmLang();
  return (
    <div className="adm-card">
      <table className="adm-table">
        <tbody>
          {loading && !data && <TableLoading colSpan={5} />}
          {!loading && (data?.submissions ?? []).length === 0 && (
            <EmptyRow colSpan={5}>
              {t(
                'Inbox is empty — contact, quote, and inquiry forms on your site all deliver here.',
                '收件匣是空的——網站上的聯絡、估價與諮詢表單都會寄到這裡。',
              )}
            </EmptyRow>
          )}
          {(data?.submissions ?? []).map((s) => (
            <tr key={s.id} style={{ fontWeight: s.read ? 400 : 600 }}>
              <td style={{ width: 100 }}>
                <span className="adm-pill" data-tone={s.kind === 'quote' ? 'warn' : s.kind === 'inquiry' ? 'info' : 'muted'}>
                  {KIND_LABELS[s.kind] ? (lang === 'zh' ? KIND_LABELS[s.kind][1] : KIND_LABELS[s.kind][0]) : s.kind}
                </span>
              </td>
              <td>
                {s.name ?? '—'}
                <div style={{ fontSize: 12, color: 'var(--a-faint)', fontWeight: 400 }}>
                  {[s.email, s.phone].filter(Boolean).join(' · ')}
                </div>
              </td>
              <td style={{ maxWidth: 460, fontSize: 13 }}>
                {s.meta?.listing && <em style={{ color: 'var(--a-info)' }}>{t('Re:', '關於:')} {s.meta.listing} · </em>}
                {s.message}
              </td>
              <td style={{ fontSize: 12, color: 'var(--a-faint)', whiteSpace: 'nowrap' }}>
                {new Date(s.createdAt).toLocaleDateString()}
              </td>
              <td style={{ textAlign: 'right' }}>
                {!s.read && (
                  <button
                    className="adm-btn adm-btn-sm"
                    onClick={async () => {
                      await admPatch(`/inbox/${s.id}`, {});
                      reload();
                    }}
                  >
                    {t('Mark read', '標為已讀')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
