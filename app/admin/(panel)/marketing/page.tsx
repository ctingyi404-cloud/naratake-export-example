'use client';

import { useState } from 'react';
import { admDelete, admPatch, admPost, confirmDlg, downloadCsv, EmptyRow, Field, ImageUpload, Modal, money, TableLoading, useLoad, useAdmLang } from '../../ui';
import { site } from '@/lib/site-config';

/* tabs follow the site: coupons/gift cards need promotions, announcements need
   content. Property listings used to be a tab here — they are a brokerage's
   inventory, not a marketing asset, so they moved to their own screen. */
const VISIBLE_TABS: Tab[] = [
  ...(site.enabledModules.includes('promotions') ? (['coupons', 'giftcards'] as Tab[]) : []),
  ...(site.enabledModules.includes('content') ? (['announcements', 'posts'] as Tab[]) : []),
  'broadcast', // newsletter subscribers exist on every site
  'audience',
];

type Tab = 'coupons' | 'giftcards' | 'announcements' | 'posts' | 'broadcast' | 'audience';

const TAB_LABELS: Record<Tab, [string, string]> = {
  coupons: ['Coupons', '優惠券'],
  giftcards: ['Gift cards', '禮品卡'],
  announcements: ['Announcements', '公告'],
  posts: ['Blog', '部落格'],
  broadcast: ['Email blast', '郵件群發'],
  audience: ['Audience', '名單'],
};

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>(VISIBLE_TABS[0] ?? 'coupons');
  const { lang, t } = useAdmLang();
  return (
    <>
      <h1 className="adm-page-title">{t('Marketing & content', '行銷與內容')}</h1>
      <p className="adm-page-sub">{t('Promotions and content shown on your site.', '網站上的促銷與內容。')}</p>
      <div className="adm-tabs">
        {VISIBLE_TABS.map((tb) => (
          <button key={tb} className="adm-tab" data-active={tab === tb} onClick={() => setTab(tb)}>
            {lang === 'zh' ? TAB_LABELS[tb][1] : TAB_LABELS[tb][0]}
          </button>
        ))}
      </div>
      {tab === 'coupons' && <Coupons />}
      {tab === 'giftcards' && <GiftCards />}
      {tab === 'announcements' && <Announcements />}
      {tab === 'posts' && <Posts />}
      {tab === 'broadcast' && <Broadcast />}
      {tab === 'audience' && <Audience />}
    </>
  );
}

interface PastBroadcast {
  subject: string;
  first: string;
  sent: number;
  failed: number;
  /* present when the campaign body carried a coupon code */
  couponCode?: string;
  redeemed?: number;
}

interface FeaturedItem {
  id: string;
  name: string;
  nameZh?: string | null;
  priceCents: number;
  available: boolean;
}

function Broadcast() {
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const { data: history, reload: reloadHistory } = useLoad<{ broadcasts: PastBroadcast[] }>('/marketing/broadcasts');
  const { data: catalog } = useLoad<{ categories: { items: FeaturedItem[] }[] }>('/catalog');
  const { lang, t } = useAdmLang();
  const items = (catalog?.categories ?? []).flatMap((c) => c.items).filter((it) => it.available);
  return (
    <>
    <div className="adm-card" style={{ padding: 16, maxWidth: 620 }}>
      <p style={{ fontSize: 13, color: 'var(--a-faint)', margin: '0 0 14px' }}>
        {t(
          'Goes to every customer who opted in to marketing emails. An unsubscribe link is added automatically.',
          '寄給所有訂閱行銷郵件的顧客;每封信會自動附上退訂連結。',
        )}
      </p>
      <Field label={t('Subject', '主旨')}>
        <input className="adm-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('This week at the shop…', '本週店內消息…')} />
      </Field>
      <Field label={t('Message: each line becomes a paragraph', '內文:每行會成為一段')}>
        <textarea className="adm-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {items.length > 0 && (
        <Field label={t('Feature items (up to 3)', '精選品項(最多 3 個)')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {items.map((it) => {
              const checked = itemIds.includes(it.id);
              const capped = !checked && itemIds.length >= 3;
              return (
                <label
                  key={it.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    border: `1px solid ${checked ? 'var(--a-primary)' : 'var(--a-border)'}`,
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: checked ? 600 : 400,
                    opacity: capped ? 0.45 : 1,
                    cursor: capped ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={capped}
                    onChange={() => setItemIds((ids) => (checked ? ids.filter((x) => x !== it.id) : [...ids, it.id]))}
                  />
                  {lang === 'zh' && it.nameZh ? it.nameZh : it.name}
                  <span style={{ color: 'var(--a-faint)' }}>{money(it.priceCents)}</span>
                </label>
              );
            })}
          </div>
        </Field>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="adm-btn adm-btn-primary"
          disabled={!subject || !text || sending}
          onClick={async () => {
            if (sending) return;
            setSending(true);
            setResult(null);
            try {
              setResult(await admPost<{ sent: number; failed: number }>('/marketing/broadcast', { subject, text, itemIds }));
              reloadHistory();
            } catch (e) {
              alert(e instanceof Error ? e.message : t('Could not send. Please try again', '寄送失敗,請再試一次'));
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? t('Sending…', '寄送中…') : t('Send to subscribers', '寄給訂閱顧客')}
        </button>
        <button
          className="adm-btn"
          disabled={!subject || !text || testing || sending}
          onClick={async () => {
            if (testing) return;
            setTesting(true);
            try {
              const r = await admPost<{ ok: boolean; to: string }>('/marketing/broadcast/test', { subject, text, itemIds });
              if (!r.ok) throw new Error(t('Could not send. Please try again', '寄送失敗,請再試一次'));
              setTestTo(r.to);
              setTimeout(() => setTestTo(null), 1600);
            } catch (e) {
              alert(e instanceof Error ? e.message : t('Could not send. Please try again', '寄送失敗,請再試一次'));
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? t('Sending…', '寄送中…') : t('Send test to me', '寄測試信給我')}
        </button>
        {testTo && (
          <span style={{ fontSize: 13, color: 'var(--a-faint)' }}>{t(`[Test] sent to ${testTo}`, `[Test] 已寄至 ${testTo}`)}</span>
        )}
      </div>
      {result && (
        <p style={{ fontSize: 13.5, marginTop: 12 }}>
          {t(
            `Sent to ${result.sent} subscriber${result.sent === 1 ? '' : 's'}${result.failed ? `, ${result.failed} failed` : ''}.`,
            `已寄出 ${result.sent} 封${result.failed ? `,失敗 ${result.failed} 封` : ''}。`,
          )}
        </p>
      )}
    </div>
    {(history?.broadcasts.length ?? 0) > 0 && (
      <div className="adm-card" style={{ padding: 16, maxWidth: 620, marginTop: 14 }}>
        <div className="adm-stat-label" style={{ marginBottom: 4 }}>{t('Past campaigns', '歷史群發')}</div>
        {history!.broadcasts.map((b) => (
          <div
            key={`${b.subject}|${b.first}`}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '8px 0', borderBottom: '1px solid var(--a-border)', fontSize: 13.5 }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
              {b.subject}
              {b.couponCode && (
                <span className="adm-pill" data-tone="info" style={{ marginLeft: 8 }}>
                  {t(`${b.couponCode} · ${b.redeemed ?? 0} redeemed`, `${b.couponCode} · 已用 ${b.redeemed ?? 0} 次`)}
                </span>
              )}
            </span>
            <span style={{ whiteSpace: 'nowrap', color: 'var(--a-faint)' }}>
              {new Date(b.first).toLocaleDateString()} · {t(`${b.sent} sent`, `寄出 ${b.sent}`)}
              {b.failed > 0 && <span style={{ color: 'var(--a-danger, #d33)' }}> · {t(`${b.failed} failed`, `失敗 ${b.failed}`)}</span>}
            </span>
          </div>
        ))}
      </div>
    )}
    </>
  );
}

interface Subscriber {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
}

function Audience() {
  const { data, reload, loading } = useLoad<{ total: number; weekNew: number; customers: Subscriber[] }>('/marketing/audience');
  const [copied, setCopied] = useState(false);
  const { t } = useAdmLang();
  const subs = data?.customers ?? [];
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 220px))', gap: 14, marginBottom: 14 }}>
        <div className="adm-card adm-stat">
          <div className="adm-stat-label">{t('Total subscribers', '訂閱總數')}</div>
          <div className="adm-stat-value">{data?.total ?? '—'}</div>
        </div>
        <div className="adm-card adm-stat">
          <div className="adm-stat-label">{t('New this week', '本週新增')}</div>
          <div className="adm-stat-value">{data?.weekNew ?? '—'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          className="adm-btn adm-btn-sm"
          disabled={!subs.length}
          onClick={() =>
            downloadCsv('subscribers.csv', [
              ['email', 'name', 'joined'],
              ...subs.map((s) => [s.email, s.name ?? '', s.createdAt.slice(0, 10)]),
            ])
          }
        >
          {t('Export CSV', '匯出 CSV')}
        </button>
      </div>
      <div className="adm-card">
        <table className="adm-table">
          <thead>
            <tr>
              <th>{t('Email', '電子郵件')}</th>
              <th>{t('Name', '姓名')}</th>
              <th>{t('Joined', '加入日期')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !data && <TableLoading colSpan={4} />}
            {!loading && subs.length === 0 && (
              <EmptyRow colSpan={4}>
                {t(
                  'No subscribers yet — the /join page below and the checkout opt-in box both grow this list.',
                  '還沒有訂閱者——下方的 /join 頁面與結帳時的訂閱勾選框都會累積這份名單。',
                )}
              </EmptyRow>
            )}
            {subs.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.email}</td>
                <td>{s.name || '—'}</td>
                <td style={{ fontSize: 12.5, color: 'var(--a-faint)' }}>{new Date(s.createdAt).toLocaleDateString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="adm-btn adm-btn-sm"
                    onClick={async () => {
                      if (!(await confirmDlg(t('Unsubscribe this customer?', '要為這位顧客退訂嗎？'), { confirmLabel: t('Unsubscribe', '退訂') }))) return;
                      await admPost(`/marketing/audience/${s.id}/unsubscribe`, {});
                      reload();
                    }}
                  >
                    {t('Unsubscribe', '退訂')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="adm-card" style={{ padding: 16, marginTop: 14, maxWidth: 620 }}>
        <strong style={{ fontSize: 13.5 }}>{t('In-store signup page', '店內訂閱頁')}</strong>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0' }}>
          <code style={{ fontSize: 13.5, fontWeight: 700, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--a-border)' }}>/join</code>
          <button
            className="adm-btn adm-btn-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(`${window.location.origin}/join`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? t('Copied', '已複製') : t('Copy link', '複製連結')}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--a-faint)', margin: 0 }}>
          {t(
            'Print it or add it to a table QR. Customers join your list in one tap.',
            '印出來或做成桌上 QR,顧客一鍵加入你的名單。',
          )}
        </p>
      </div>
    </>
  );
}

interface GiftCardRow {
  id: string;
  code: string;
  initialCents: number;
  balanceCents: number;
  active: boolean;
  purchaserEmail?: string | null;
  createdAt: string;
}

function GiftCards() {
  const { data, reload, loading } = useLoad<{ giftcards: GiftCardRow[] }>('/giftcards');
  const [amount, setAmount] = useState('50');
  const [issuing, setIssuing] = useState(false);
  const { t } = useAdmLang();
  return (
    <>
      <div className="adm-card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('Issue a card in store:', '在店內發卡：')}</span>
        <input className="adm-input" style={{ width: 120 }} type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button
          className="adm-btn adm-btn-primary"
          disabled={issuing}
          onClick={async () => {
            if (issuing) return; // one tap = one card (was minting a funded card per tap)
            setIssuing(true);
            try {
              await admPost('/giftcards/issue', { amountCents: Math.round(parseFloat(amount || '0') * 100) });
              reload();
            } catch (e) {
              alert(e instanceof Error ? e.message : t('Could not issue card', '發卡失敗'));
            } finally {
              setIssuing(false);
            }
          }}
        >
          {issuing ? t('Issuing…', '發行中…') : t(`Issue $${amount}`, `發行 $${amount}`)}
        </button>
      </div>
      <div className="adm-card">
        <table className="adm-table">
          <thead>
            <tr>
              <th>{t('Code', '卡號')}</th>
              <th>{t('Balance', '餘額')}</th>
              <th>{t('Original', '原始面額')}</th>
              <th>{t('Purchaser', '購買人')}</th>
              <th>{t('Issued', '發行日')}</th>
              <th>{t('Status', '狀態')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !data && <TableLoading colSpan={7} />}
            {!loading && (data?.giftcards ?? []).length === 0 && (
              <EmptyRow colSpan={7}>
                {t(
                  'No gift cards yet — issue one above for an in-store sale, or customers buy them on your site and they appear here.',
                  '還沒有禮品卡——用上方欄位在店內發卡，顧客在網站購買的卡也會出現在這裡。',
                )}
              </EmptyRow>
            )}
            {(data?.giftcards ?? []).map((g) => (
              <tr key={g.id} style={{ opacity: g.active ? 1 : 0.55 }}>
                <td style={{ fontWeight: 800, letterSpacing: '0.06em' }}>{g.code}</td>
                <td style={{ fontWeight: 700, color: g.balanceCents > 0 ? 'var(--a-primary)' : 'var(--a-faint)' }}>{money(g.balanceCents)}</td>
                <td>{money(g.initialCents)}</td>
                <td style={{ fontSize: 13 }}>{g.purchaserEmail ?? t('in-store', '店內')}</td>
                <td style={{ fontSize: 12.5, color: 'var(--a-faint)' }}>{new Date(g.createdAt).toLocaleDateString()}</td>
                <td>
                  <span className="adm-pill" data-tone={g.active ? 'ok' : 'danger'}>{g.active ? t('active', '可用') : t('Deactivated', '停卡')}</span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="adm-btn adm-btn-sm" onClick={async () => { await admPatch(`/giftcards/${g.id}`, { active: !g.active }); reload(); }}>
                    {g.active ? t('Deactivate', '停卡') : t('Reactivate', '恢復')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface Coupon {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotalCents?: number | null;
  description?: string | null;
  redeemed: number;
  active: boolean;
  endsAt?: string | null;
  signupReward: boolean;
}

function Coupons() {
  const { data, reload, loading } = useLoad<{ coupons: Coupon[] }>('/coupons');
  const [creating, setCreating] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const { t } = useAdmLang();
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="adm-btn adm-btn-primary" onClick={() => setCreating(true)}>
          + {t('New coupon', '新增優惠券')}
        </button>
      </div>
      <div className="adm-card">
        <table className="adm-table">
          <thead>
            <tr>
              <th>{t('Code', '代碼')}</th>
              <th>{t('Discount', '折扣')}</th>
              <th>{t('Minimum', '最低消費')}</th>
              <th>{t('Used', '已使用')}</th>
              <th>{t('Status', '狀態')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !data && <TableLoading colSpan={6} />}
            {!loading && (data?.coupons ?? []).length === 0 && (
              <EmptyRow colSpan={6}>
                {t(
                  'No coupons yet — + New coupon creates one, and the Email button sends it straight to your subscriber list.',
                  '還沒有優惠券——用「+ 新增優惠券」建立，再按「寄送」直接寄給訂閱名單。',
                )}
              </EmptyRow>
            )}
            {(data?.coupons ?? []).map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 800, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  {c.code}
                  {c.signupReward && (
                    <span className="adm-pill" data-tone="info" style={{ marginLeft: 8, letterSpacing: 0 }}>{t('SIGNUP REWARD', '訂閱獎勵')}</span>
                  )}
                </td>
                <td>{c.kind === 'PERCENT' ? t(`${c.value}% off`, `${c.value}% 折扣`) : t(`${money(c.value)} off`, `折抵 ${money(c.value)}`)}</td>
                <td>{c.minSubtotalCents ? money(c.minSubtotalCents) : '—'}</td>
                <td>{c.redeemed}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="adm-pill" data-tone={c.active ? 'ok' : 'muted'}>{c.active ? t('active', '啟用') : t('off', '停用')}</span>
                  {c.endsAt && new Date(c.endsAt) < new Date() && (
                    <span className="adm-pill" data-tone="muted" style={{ marginLeft: 6 }}>{t('Expired', '已過期')}</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="adm-btn adm-btn-sm"
                    style={{ marginRight: 6 }}
                    disabled={sendingId === c.id}
                    onClick={async () => {
                      if (!(await confirmDlg(t('Email this coupon to all subscribed customers?', '要把這張優惠券寄給所有訂閱顧客嗎？'), { tone: 'primary', confirmLabel: t('Send to all', '寄給全部') }))) return;
                      setSendingId(c.id);
                      try {
                        const r = await admPost<{ sent: number; failed: number }>(`/marketing/coupons/${c.id}/send`, {});
                        alert(t(`Sent to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}.`, `已寄給 ${r.sent} 位訂閱顧客${r.failed ? `,失敗 ${r.failed} 封` : ''}。`));
                      } catch (e) {
                        alert(e instanceof Error ? e.message : t('Could not send', '寄送失敗'));
                      } finally {
                        setSendingId(null);
                      }
                    }}
                  >
                    {sendingId === c.id ? t('Sending…', '寄送中…') : t('Email', '寄送')}
                  </button>
                  <button className="adm-btn adm-btn-sm" style={{ marginRight: 6 }} onClick={async () => { await admPatch(`/coupons/${c.id}`, { active: !c.active }); reload(); }}>
                    {c.active ? t('Disable', '停用') : t('Enable', '啟用')}
                  </button>
                  <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={async () => { if (await confirmDlg(t('Delete coupon?', '要刪除優惠券嗎？'), { confirmLabel: t('Delete', '刪除') })) { await admDelete(`/coupons/${c.id}`); reload(); } }}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && (
        <CouponModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function CouponModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('10');
  const [saving, setSaving] = useState(false);
  const [min, setMin] = useState('');
  const [ends, setEnds] = useState('');
  const [description, setDescription] = useState('');
  const [reward, setReward] = useState(false);
  const { t } = useAdmLang();
  return (
    <Modal title={t('New coupon', '新增優惠券')} onClose={onClose}>
      <Field label={t('Code', '代碼')}>
        <input className="adm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="SUMMER15" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={t('Type', '類型')}>
          <select className="adm-input" value={kind} onChange={(e) => setKind(e.target.value as 'PERCENT')}>
            <option value="PERCENT">{t('Percent off', '百分比折扣')}</option>
            <option value="FIXED">{t('Dollars off', '固定金額折抵')}</option>
          </select>
        </Field>
        <Field label={kind === 'PERCENT' ? t('Percent', '百分比') : t('Amount (USD)', '金額（美元）')}>
          <input className="adm-input" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={t('Minimum subtotal (USD, optional)', '最低小計（美元，選填）')}>
          <input className="adm-input" type="number" value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label={t('Expires (optional)', '到期日（選填）')}>
          <input className="adm-input" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </Field>
      </div>
      <Field label={t('Description shown to customers', '顯示給顧客的說明')}>
        <input className="adm-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('15% off summer orders', '夏季訂單 85 折')} />
      </Field>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, fontSize: 13.5 }}>
        <input type="checkbox" checked={reward} onChange={(e) => setReward(e.target.checked)} />
        {t('Signup reward: email this code to new subscribers', '訂閱獎勵:新訂閱者自動收到此券')}
      </label>
      <button
        className="adm-btn adm-btn-primary"
        disabled={!code || !value || saving}
        onClick={async () => {
          if (saving) return;
          setSaving(true);
          try {
            await admPost('/coupons', {
              code,
              kind,
              value: kind === 'PERCENT' ? Number(value) : Math.round(parseFloat(value) * 100),
              minSubtotalCents: min ? Math.round(parseFloat(min) * 100) : null,
              // date → end of that day, so the coupon still works all day on its last day
              endsAt: ends ? new Date(ends + 'T23:59:59').toISOString() : null,
              description: description || null,
              signupReward: reward,
            });
            onSaved();
          } catch (e) {
            alert(e instanceof Error ? e.message : t('Could not create. Please try again', '建立失敗,請再試一次'));
          } finally {
            setSaving(false);
          }
        }}
      >
        {t('Create coupon', '建立優惠券')}
      </button>
    </Modal>
  );
}

interface Ann {
  id: string;
  text: string;
  active: boolean;
}

function Announcements() {
  const { data, reload, loading } = useLoad<{ announcements: Ann[] }>('/content');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const { t } = useAdmLang();
  return (
    <>
      <div className="adm-card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 10 }}>
        <input className="adm-input" placeholder={t('New announcement: shows in the site banner', '新公告:會顯示在網站橫幅')} value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="adm-btn adm-btn-primary"
          disabled={!text || saving}
          onClick={async () => {
            if (saving) return;
            setSaving(true);
            try {
              await admPost('/content/announcements', { text });
              setText('');
              reload();
            } catch (e) {
              alert(e instanceof Error ? e.message : t('Could not post. Please try again', '發布失敗,請再試一次'));
            } finally {
              setSaving(false);
            }
          }}
        >
          {t('Publish', '發布')}
        </button>
      </div>
      <div className="adm-card">
        <table className="adm-table">
          <tbody>
            {loading && !data && <TableLoading colSpan={3} />}
            {!loading && (data?.announcements ?? []).length === 0 && (
              <EmptyRow colSpan={3}>
                {t(
                  'No announcements — publish one above and it shows in your site banner the moment you press Publish.',
                  '還沒有公告——在上方輸入並按「發布」，馬上就會出現在網站橫幅。',
                )}
              </EmptyRow>
            )}
            {(data?.announcements ?? []).map((a) => (
              <tr key={a.id}>
                <td>{a.text}</td>
                <td style={{ width: 90 }}>
                  <span className="adm-pill" data-tone={a.active ? 'ok' : 'muted'}>{a.active ? t('live', '上架中') : t('off', '關閉')}</span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="adm-btn adm-btn-sm" style={{ marginRight: 6 }} onClick={async () => { await admPatch(`/content/announcements/${a.id}`, { active: !a.active }); reload(); }}>
                    {a.active ? t('Hide', '隱藏') : t('Show', '顯示')}
                  </button>
                  {/* was the one destructive button in the backoffice with NO confirm */}
                  <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={async () => { if (!(await confirmDlg(t('Delete this announcement?', '要刪除這則公告嗎？'), { confirmLabel: t('Delete', '刪除') }))) return; await admDelete(`/content/announcements/${a.id}`); reload(); }}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  bodyMd: string;
  imageUrl?: string | null;
  publishedAt?: string | null;
}

function Posts() {
  const { data, reload, loading } = useLoad<{ posts: Post[] }>('/content');
  const [editing, setEditing] = useState<Partial<Post> | null>(null);
  const { t, lang } = useAdmLang();
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="adm-btn adm-btn-primary" onClick={() => setEditing({})}>
          + {t('New post', '新增文章')}
        </button>
      </div>
      <div className="adm-card">
        <table className="adm-table">
          <thead>
            <tr>
              <th>{t('Post', '文章')}</th>
              <th>{t('Status', '狀態')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && !data && <TableLoading colSpan={3} />}
            {!loading && (data?.posts ?? []).length === 0 && (
              <EmptyRow colSpan={3}>
                {t(
                  'No posts yet — + New post starts your first article; it stays a private draft until you press Publish.',
                  '還沒有文章——用「+ 新增文章」寫第一篇；按「發布」之前都是私人草稿。',
                )}
              </EmptyRow>
            )}
            {(data?.posts ?? []).map((p) => (
              <tr key={p.id}>
                <td>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {p.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--a-border)' }} />
                    )}
                    <div>
                      <strong>{p.title}</strong>
                      <div style={{ fontSize: 12, color: 'var(--a-faint)' }}>/posts/{p.slug}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: 130 }}>
                  <span className="adm-pill" data-tone={p.publishedAt ? 'ok' : 'muted'}>
                    {p.publishedAt
                      ? new Date(p.publishedAt).toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { month: 'short', day: 'numeric' })
                      : t('draft', '草稿')}
                  </span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="adm-btn adm-btn-sm" style={{ marginRight: 6 }} onClick={async () => { await admPatch(`/content/posts/${p.id}`, { published: !p.publishedAt }); reload(); }}>
                    {p.publishedAt ? t('Unpublish', '下架') : t('Publish', '發布')}
                  </button>
                  <button className="adm-btn adm-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditing(p)}>
                    {t('Edit', '編輯')}
                  </button>
                  <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={async () => { if (await confirmDlg(t('Delete post?', '要刪除文章嗎？'), { confirmLabel: t('Delete', '刪除') })) { await admDelete(`/content/posts/${p.id}`); reload(); } }}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <PostModal
          post={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function PostModal({ post, onClose, onSaved }: { post: Partial<Post>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ ...post });
  const [saving, setSaving] = useState(false);
  const { t } = useAdmLang();
  const set = (p: Partial<Post>) => setForm((f) => ({ ...f, ...p }));
  const save = async (published?: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        excerpt: form.excerpt?.trim() || null,
        bodyMd: form.bodyMd ?? '',
        imageUrl: form.imageUrl ?? null,
        ...(published === undefined ? {} : { published }),
      };
      if (form.id) await admPatch(`/content/posts/${form.id}`, payload);
      else await admPost('/content/posts', payload);
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : t('Could not save. Please try again', '儲存失敗,請再試一次'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={form.id ? t('Edit post', '編輯文章') : t('New post', '新增文章')} onClose={onClose}>
      <Field label={t('Title', '標題')}>
        <input className="adm-input" value={form.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label={t('Cover photo: shows on the blog card and article', '封面照片:顯示在文章卡片與內頁')}>
        <ImageUpload value={form.imageUrl ?? null} onChange={(url) => set({ imageUrl: url })} />
      </Field>
      <Field label={t('Excerpt: one-line summary on the card', '摘要:卡片上的一句話介紹')}>
        <input className="adm-input" value={form.excerpt ?? ''} onChange={(e) => set({ excerpt: e.target.value })} />
      </Field>
      <Field label={t('Body', '內文')}>
        <textarea className="adm-input" rows={8} value={form.bodyMd ?? ''} onChange={(e) => set({ bodyMd: e.target.value })} />
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="adm-btn adm-btn-primary" disabled={!form.title || saving} onClick={() => save(form.id ? undefined : true)}>
          {form.id ? t('Save post', '儲存文章') : t('Publish', '發布')}
        </button>
        {!form.id && (
          <button className="adm-btn" disabled={!form.title || saving} onClick={() => save(false)}>
            {t('Save draft', '存為草稿')}
          </button>
        )}
      </div>
    </Modal>
  );
}
