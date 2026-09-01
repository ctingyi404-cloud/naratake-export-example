'use client';

import { useEffect, useState } from 'react';
import { admPatch, admPost, confirmDlg, downloadCsv, Empty, Field, Modal, money, ORDER_TONES, Skel, statusLabel, TableLoading, useLoad, useAdmLang, type AdmLang } from '../../ui';

interface Order {
  id: string;
  code: string;
  type: string;
  status: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string | null;
  itemsSnapshot: { name: string; qty: number; unitCents: number; modifiers: { name: string }[] }[];
  totalCents: number;
  tipCents: number;
  notes?: string | null;
  fulfillment: { mode: string; scheduledFor?: string; address?: string };
  quoteMeta?: { photos?: string[]; estimatedCents?: number; sentAt?: string } | null;
  giftAppliedCents?: number;
  staffName?: string | null;
  payment: {
    provider: 'STRIPE' | 'MOCK' | 'CASH';
    status: string;
    amountCents: number;
    /** cents already handed back (partial refunds included) */
    refundedCents?: number;
    /** cents the card can still give back — 0 for cash and gift tender */
    refundableCents?: number;
  } | null;
  createdAt: string;
}

const BOARD: { key: string; en: string; zh: string; next?: { to: string; en: string; zh: string } }[] = [
  { key: 'PENDING', en: 'New', zh: '新單', next: { to: 'CONFIRMED', en: 'Confirm', zh: '確認' } },
  { key: 'CONFIRMED', en: 'Confirmed', zh: '已確認', next: { to: 'PREPARING', en: 'Start', zh: '開始製作' } },
  { key: 'PREPARING', en: 'Preparing', zh: '製作中', next: { to: 'READY', en: 'Ready', zh: '完成' } },
  { key: 'READY', en: 'Ready', zh: '待取', next: { to: 'COMPLETED', en: 'Complete', zh: '結案' } },
];

// quote jobs get their own column so they can be confirmed/advanced/canceled
// like any other order instead of dead-ending (audit leads#1)
const QUOTE_COL: (typeof BOARD)[number] = {
  key: 'AWAITING_APPROVAL',
  en: 'Quotes / estimating',
  zh: '待報價/估價中',
  next: { to: 'CONFIRMED', en: 'Confirm', zh: '確認' },
};

const REC_STATUSES = ['ALL', 'PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELED'] as const;
const PAGE_SIZE = 25;

function when(iso: string, lang: AdmLang): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (today) return `${lang === 'zh' ? '今天' : 'Today'} ${time}`;
  return `${d.toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

/* tiny paid/test/refunded marker shown next to the total wherever an order appears */
function PayPill({ p }: { p: Order['payment'] }) {
  const { t } = useAdmLang();
  if (!p) return null;
  const [tone, label] =
    p.status === 'REFUNDED' ? ['muted', t('REFUNDED', '已退款')] :
    // a partly refunded ticket is still a sale — it must not read as PAID
    p.status === 'PARTIALLY_REFUNDED' ? ['warn', t(`−${money(p.refundedCents ?? 0)}`, `已退 ${money(p.refundedCents ?? 0)}`)] :
    p.provider === 'MOCK' ? ['warn', t('TEST', '測試')] :
    p.status === 'SUCCEEDED' ? ['ok', t('PAID', '已付')] : [];
  return tone ? <span className="adm-pill" data-tone={tone}>{label}</span> : null;
}

export default function OrdersPage() {
  // active=true: every non-terminal order, uncapped — the board must never
  // silently lose a PENDING order past a page boundary (audit dining#11)
  const { data, reload, loading } = useLoad<{ orders: Order[] }>('/orders?active=true');
  const { lang, t } = useAdmLang();
  const [view, setView] = useState<'board' | 'records'>('board');
  const [detail, setDetail] = useState<Order | null>(null);
  const [quoteFor, setQuoteFor] = useState<Order | null>(null);
  // reports chart click-through: /admin/orders?rdate=YYYY-MM-DD opens that day's records
  const [rdate, setRdate] = useState<string | null>(null);
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('rdate');
    if (d) {
      setRdate(d);
      setView('records');
    }
  }, []);

  // poll for new orders every 15s — the kitchen view stays live
  useEffect(() => {
    const iv = setInterval(reload, 15000);
    return () => clearInterval(iv);
  }, [reload]);

  const orders = data?.orders ?? [];
  const quotes = orders.filter((o) => o.status === 'AWAITING_APPROVAL');
  const activeCount = orders.filter((o) => !['COMPLETED', 'CANCELED'].includes(o.status)).length;

  async function setStatus(o: Order, status: string) {
    try {
      await admPatch(`/orders/${o.id}/status`, { status });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : lang === 'zh' ? '操作失敗,請再試一次' : 'Action failed. Please try again');
    }
  }

  /** what cancel would give back: whatever the card still owes + gift tender.
      The server computes the card side (cash and gift carry no charge to
      reverse, and a partial refund already took its share). */
  function refundableCents(o: Order): number {
    return (o.payment?.refundableCents ?? 0) + (o.giftAppliedCents ?? 0);
  }

  // board ✕: cancel routes through the server-side restitution (refund card,
  // restore gift/coupon/loyalty) — a failed card refund must not pass silently
  async function cancelOrder(o: Order) {
    try {
      const res = await admPatch<{ restitution?: { ok: boolean; failMessage?: string } }>(`/orders/${o.id}/status`, { status: 'CANCELED' });
      if (res.restitution && !res.restitution.ok)
        alert(t(
          `Order canceled, but the card refund failed: ${res.restitution.failMessage ?? 'unknown error'}. Open it under All records and press "Refund & cancel" to retry.`,
          `訂單已取消,但卡片退款失敗:${res.restitution.failMessage ?? '未知錯誤'}。請到「全部紀錄」開啟此訂單,按「退款並取消」重試。`,
        ));
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : lang === 'zh' ? '操作失敗,請再試一次' : 'Action failed. Please try again');
    }
  }

  return (
    <>
      <h1 className="adm-page-title">{t('Orders', '訂單')}</h1>
      <p className="adm-page-sub">{t('New orders appear automatically. The full history lives under All records.', '新訂單會自動出現。完整歷史在「全部紀錄」。')}</p>

      <div className="adm-tabs" style={{ marginBottom: 16 }}>
        <button className="adm-tab" data-active={view === 'board'} onClick={() => setView('board')}>
          {t('Board', '看板')} <span style={{ color: 'var(--a-faint)' }}>{activeCount}</span>
        </button>
        <button className="adm-tab" data-active={view === 'records'} onClick={() => setView('records')}>
          {t('All records', '全部紀錄')}
        </button>
      </div>

      {view === 'board' && (
        <>
          {data && orders.length === 0 && (
            <Empty style={{ marginBottom: 14 }}>
              {t(
                'No active orders right now — new orders appear here the moment a customer checks out on your site or at the register.',
                '目前沒有進行中的訂單——顧客在網站或櫃台一下單，就會立刻出現在這裡。',
              )}
            </Empty>
          )}
          <div className="adm-board" data-cols={quotes.length > 0 ? '5' : undefined} style={{ marginBottom: 22 }}>
            {(quotes.length > 0 ? [QUOTE_COL, ...BOARD] : BOARD).map((col) => {
              const list = orders.filter((o) => o.status === col.key);
              return (
                <div key={col.key} className="adm-board-col">
                  <div className="adm-board-head">
                    {lang === 'zh' ? col.zh : col.en} <span>{loading && !data ? '' : list.length}</span>
                  </div>
                  {loading && !data && (
                    <div className="adm-order-card" aria-hidden>
                      <Skel w="55%" h={13} />
                      <Skel w="80%" h={10} style={{ marginTop: 8, display: 'block' }} />
                      <Skel w="40%" h={10} style={{ marginTop: 6, display: 'block' }} />
                    </div>
                  )}
                  {list.map((o) => (
                    <div key={o.id} className="adm-order-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <button onClick={() => setDetail(o)} style={{ background: 'none', border: 'none', padding: 0, fontWeight: 800, fontSize: 14, cursor: 'pointer', color: 'var(--a-info)' }}>
                          {o.code}
                        </button>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <PayPill p={o.payment} />
                          <strong>{money(o.totalCents)}</strong>
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--a-dim)' }}>
                        {o.contactName} · {o.fulfillment.mode}
                        {o.fulfillment.scheduledFor && o.fulfillment.scheduledFor !== 'asap' ? ` · ${o.fulfillment.scheduledFor}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--a-faint)', margin: '6px 0' }}>
                        {o.itemsSnapshot.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {col.next && (
                          <button className="adm-btn adm-btn-sm adm-btn-primary" onClick={() => setStatus(o, col.next!.to)}>
                            {lang === 'zh' ? col.next.zh : col.next.en} →
                          </button>
                        )}
                        <button
                          className="adm-btn adm-btn-sm adm-btn-danger"
                          onClick={async () => {
                            // a mis-tap here used to cancel a paying customer's live order instantly —
                            // and a PAID order now says up front that cancel means refund
                            const back = refundableCents(o);
                            const ask = back > 0
                              ? t(`Cancel & refund ${money(back)}?`, `將取消並退款 ${money(back)}?`)
                              : t('Cancel this order?', '確定取消這筆訂單?');
                            if (await confirmDlg(ask, { confirmLabel: t('Cancel order', '取消訂單') })) cancelOrder(o);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {quotes.length > 0 && (
            <div className="adm-card" style={{ marginBottom: 22 }}>
              <div style={{ padding: '14px 16px', fontWeight: 700, fontSize: 14, borderBottom: '1px solid var(--a-border)' }}>
                {t('Quote requests awaiting your estimate', '待你報價的估價請求')}
              </div>
              <table className="adm-table">
                <tbody>
                  {quotes.map((o) => (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 700 }}>{o.code}</td>
                      <td>
                        {o.contactName}
                        <div style={{ fontSize: 12, color: 'var(--a-faint)' }}>{o.contactPhone}</div>
                      </td>
                      <td style={{ maxWidth: 380, fontSize: 13 }}>{o.notes}</td>
                      <td>
                        {(o.quoteMeta?.photos ?? []).map((p) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={p} src={p} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 6, marginRight: 4 }} />
                        ))}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {o.quoteMeta?.sentAt && (
                          <span className="adm-pill" data-tone="ok" style={{ marginRight: 8 }}>
                            {t('Sent', '已報價')}{o.quoteMeta.estimatedCents ? ` ${money(o.quoteMeta.estimatedCents)}` : ''}
                          </span>
                        )}
                        <button className="adm-btn adm-btn-sm adm-btn-primary" onClick={() => setQuoteFor(o)}>
                          {o.quoteMeta?.sentAt ? t('Send again', '再次報價') : t('Send estimate', '送出報價')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view === 'records' && <Records onOpen={setDetail} exactDate={rdate} onClearDate={() => setRdate(null)} />}

      {detail && (
        <Modal title={t(`Order ${detail.code}`, `訂單 ${detail.code}`)} onClose={() => setDetail(null)}>
          <div style={{ fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <strong>{detail.contactName}</strong> · {detail.contactPhone}
              {detail.contactEmail ? ` · ${detail.contactEmail}` : ''}
            </div>
            <div style={{ color: 'var(--a-dim)' }}>
              {detail.type} · {detail.fulfillment.scheduledFor ?? ''} {detail.fulfillment.address ?? ''}
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid var(--a-border)' }} />
            {detail.itemsSnapshot.map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {l.qty} × {l.name}
                  {l.modifiers?.length > 0 && (
                    <span style={{ color: 'var(--a-faint)' }}> ({l.modifiers.map((m) => m.name).join(', ')})</span>
                  )}
                </span>
                <span>{money(l.unitCents * l.qty)}</span>
              </div>
            ))}
            {detail.tipCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-dim)' }}>
                <span>{t('Tip', '小費')}</span>
                <span>{money(detail.tipCents)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
              <span>{t('Total', '總計')}</span>
              <span>{money(detail.totalCents)}</span>
            </div>
            {detail.payment && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--a-dim)' }}>
                <span>
                  {t('Payment', '付款')} · {detail.payment.provider} <PayPill p={detail.payment} />
                </span>
                <span>{money(detail.payment.amountCents)}</span>
              </div>
            )}
            {detail.notes && <div style={{ color: 'var(--a-dim)' }}>“{detail.notes}”</div>}
            <RefundBox
              order={detail}
              onDone={() => {
                reload();
                setDetail(null);
              }}
            />
            {/* a fully refunded card leaves the box hidden — say so instead of nothing */}
            {detail.payment && detail.payment.status === 'REFUNDED' && (
              <div style={{ fontSize: 12.5, color: 'var(--a-faint)' }}>
                {t(`${money(detail.payment.amountCents)} was refunded to the card.`, `已退回卡片 ${money(detail.payment.amountCents)}。`)}
              </div>
            )}
          </div>
        </Modal>
      )}

      {quoteFor && <QuoteModal order={quoteFor} onClose={() => setQuoteFor(null)} onSent={reload} />}
    </>
  );
}

/* Two refunds, two verbs, because they are not the same decision.

   "Refund part" moves only the card and leaves the ticket standing — one dish
   off a table of six is not a canceled order, and before this the only way to
   do it was to refund the whole ticket and re-ring everything the kitchen had
   already made. "Refund & cancel" gives back everything (card, gift card,
   points, coupon) and cancels the order. */
function RefundBox({ order, onDone }: { order: Order; onDone: () => void }) {
  const { t } = useAdmLang();
  const p = order.payment;
  const left = p?.refundableCents ?? 0;
  const refunded = p?.refundedCents ?? 0;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!p || left <= 0) return null;

  async function send(body: { amountCents?: number }, confirm?: string) {
    if (confirm && !(await confirmDlg(confirm, { confirmLabel: t('Refund', '退款') }))) return;
    setBusy(true);
    setErr('');
    try {
      await admPost(`/orders/${order.id}/refund`, body);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Refund failed', '退款失敗'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--a-border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12.5, color: 'var(--a-dim)' }}>
        {t(`Refundable to card: ${money(left)}`, `可退回卡片：${money(left)}`)}
        {refunded > 0 && ` · ${t(`already refunded ${money(refunded)}`, `已退 ${money(refunded)}`)}`}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="adm-input"
          style={{ maxWidth: 130 }}
          type="number"
          min="0.01"
          step="0.01"
          max={(left / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t('Amount ($)', '金額（$）')}
        />
        <button
          className="adm-btn adm-btn-sm"
          disabled={busy || !amount}
          onClick={() => {
            const cents = Math.round(parseFloat(amount) * 100);
            // the server checks this too; catching it here saves a round trip
            // and says the limit out loud instead of just refusing
            if (!Number.isFinite(cents) || cents <= 0 || cents > left) {
              setErr(t(`Enter an amount between ${money(1)} and ${money(left)}`, `請輸入 ${money(1)} 到 ${money(left)} 之間的金額`));
              return;
            }
            void send({ amountCents: cents }, t(`Refund ${money(cents)} to the card? The order stays as it is.`, `要退 ${money(cents)} 到卡片嗎？訂單本身維持不變。`));
          }}
        >
          {t('Refund part', '部分退款')}
        </button>
        <button
          className="adm-btn adm-btn-sm adm-btn-danger"
          disabled={busy}
          onClick={() =>
            void send(
              {},
              t(
                'Refund everything and cancel this order? This cannot be undone.',
                '要退還全部款項並取消這筆訂單嗎？此操作無法復原。',
              ),
            )
          }
        >
          {t('Refund & cancel', '退款並取消')}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--a-faint)' }}>
        {t(
          'A partial refund leaves the order standing. “Refund & cancel” also returns gift-card value and loyalty points, and cancels the order.',
          '部分退款不會取消訂單。「退款並取消」會連禮物卡金額與點數一起退回，並取消訂單。',
        )}
      </div>
      {err && <div style={{ fontSize: 13, color: 'var(--a-danger)' }}>{err}</div>}
    </div>
  );
}

/* full, searchable order history backed by the real database */
type RecRange = 'all' | 'today' | '7d' | '30d' | 'month';

function Records({ onOpen, exactDate, onClearDate }: { onOpen: (o: Order) => void; exactDate: string | null; onClearDate: () => void }) {
  const { lang, t } = useAdmLang();
  const [status, setStatus] = useState<(typeof REC_STATUSES)[number]>('ALL');
  const [range, setRange] = useState<RecRange>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  // small debounce so we don't refetch per keystroke
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status !== 'ALL') params.set('status', status);
  if (q) params.set('q', q);
  if (exactDate) params.set('date', exactDate);
  else if (range === 'today') params.set('date', new Date().toLocaleDateString('en-CA'));
  else if (range === '7d') params.set('days', '7');
  else if (range === '30d') params.set('days', '30');
  else if (range === 'month') params.set('month', 'current');
  const { data, loading } = useLoad<{ orders: Order[]; total: number }>(`/orders?${params.toString()}`);
  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasStaff = orders.some((o) => o.staffName);

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <input
          className="adm-input"
          style={{ maxWidth: 240 }}
          placeholder={t('Search code / customer / phone', '搜尋編號/顧客/電話')}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        {REC_STATUSES.map((s) => (
          <button
            key={s}
            className="adm-btn adm-btn-sm"
            style={status === s ? { background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' } : undefined}
            onClick={() => { setStatus(s); setPage(1); }}
          >
            {s === 'ALL' ? t('All', '全部') : statusLabel(s, lang)}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--a-dim)' }}>{t('Date:', '日期：')}</span>
        {([['all', t('All', '全部')], ['today', t('Today', '今天')], ['7d', t('7 days', '近 7 天')], ['30d', t('30 days', '近 30 天')], ['month', t('This month', '這個月')]] as [RecRange, string][]).map(([r, label]) => (
          <button
            key={r}
            className="adm-btn adm-btn-sm"
            style={range === r && !exactDate ? { background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' } : undefined}
            onClick={() => { setRange(r); setPage(1); onClearDate(); }}
          >
            {label}
          </button>
        ))}
        {exactDate && (
          <button
            className="adm-btn adm-btn-sm"
            style={{ background: 'var(--a-primary-soft)', borderColor: 'var(--a-primary)', color: 'var(--a-primary)' }}
            onClick={() => { onClearDate(); setPage(1); }}
            title={t('Clear day filter', '清除單日篩選')}
          >
            {exactDate} ✕
          </button>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--a-dim)' }}>
            {loading ? t('Loading…', '載入中…') : t(`${total} orders`, `${total} 筆訂單`)}
          </span>
          <button
            className="adm-btn adm-btn-sm"
            onClick={() =>
              downloadCsv('order-records.csv', [
                ['Code', 'Customer', 'Phone', 'Items', 'Staff', 'Type', 'Status', 'Total', 'Placed'],
                ...orders.map((o) => [
                  o.code,
                  o.contactName,
                  o.contactPhone,
                  o.itemsSnapshot.map((l) => `${l.qty}x ${l.name}`).join('; '),
                  o.staffName ?? '',
                  o.type,
                  o.status,
                  (o.totalCents / 100).toFixed(2),
                  o.createdAt,
                ]),
              ])
            }
          >
            {/* honest label: this dumps the visible page, not all `total` rows */}
            ⬇ {t(`Export page (${orders.length})`, `匯出本頁 (${orders.length})`)}
          </button>
        </span>
      </div>

      <div className="adm-card">
        <table className="adm-table">
          <thead>
            <tr>
              <th>{t('Order', '訂單')}</th>
              <th>{t('Customer', '顧客')}</th>
              <th>{t('Items', '內容')}</th>
              {hasStaff && <th>{t('Staff', '服務人員')}</th>}
              <th>{t('Type', '類型')}</th>
              <th>{t('Status', '狀態')}</th>
              <th style={{ textAlign: 'right' }}>{t('Total', '總計')}</th>
              <th>{t('Placed', '時間')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 && <TableLoading colSpan={8} />}
            {orders.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="adm-empty">
                  {t('No matching orders — loosen the status, date, or search filters above.', '沒有符合的訂單——放寬上方的狀態、日期或搜尋條件試試。')}
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} onClick={() => onOpen(o)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 700 }}>{o.code}</td>
                <td>
                  {o.contactName}
                  <div style={{ fontSize: 12, color: 'var(--a-faint)' }}>{o.contactPhone}</div>
                </td>
                <td style={{ maxWidth: 260, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.itemsSnapshot.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                </td>
                {hasStaff && <td style={{ fontSize: 13 }}>{o.staffName ?? '—'}</td>}
                <td style={{ fontSize: 12.5 }}>{o.type}</td>
                <td>
                  <span className="adm-pill" data-tone={ORDER_TONES[o.status] ?? 'muted'}>{statusLabel(o.status, lang)}</span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  <PayPill p={o.payment} /> {money(o.totalCents)}
                </td>
                <td style={{ fontSize: 12, color: 'var(--a-faint)', whiteSpace: 'nowrap' }}>{when(o.createdAt, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← {t('Prev', '上一頁')}
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--a-dim)' }}>{page} / {pages}</span>
          <button className="adm-btn adm-btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('Next', '下一頁')} →
          </button>
        </div>
      )}
    </>
  );
}

function QuoteModal({ order, onClose, onSent }: { order: Order; onClose: () => void; onSent: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const { t } = useAdmLang();
  // no email = no delivery channel — never fake a success (audit leads#2)
  const noEmail = !order.contactEmail;
  return (
    <Modal title={t(`Estimate for ${order.code}`, `為 ${order.code} 報價`)} onClose={onClose}>
      <Field label={t('Estimate amount (USD)', '報價金額（美元）')}>
        <input className="adm-input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="249.00" />
      </Field>
      <Field label={t('Note to customer', '給顧客的說明')}>
        <textarea className="adm-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Parts + labor. Ready two days after approval.', '零件＋工錢。確認後兩天可完成。')} />
      </Field>
      {noEmail ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--a-danger)', marginBottom: 10 }}>
            {t('This customer left no email. Call them instead:', '此客戶未留 email,請電話聯繫:')}{' '}
            <strong>{order.contactPhone || t('no phone on file either', '也沒有留電話')}</strong>
          </div>
          <button
            className="adm-btn"
            disabled={!amount}
            onClick={async () => {
              const text = `${t('Estimate for', '報價')} ${order.code}: $${amount}${note ? `. ${note}` : ''}`;
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              } catch {
                setErr(t('Copy failed. Please note it down manually.', '複製失敗,請手動抄下。'));
              }
            }}
          >
            {copied ? t('Copied ✓', '已複製 ✓') : t('Copy estimate text', '複製報價內容')}
          </button>
        </>
      ) : (
        <button
          className="adm-btn adm-btn-primary"
          disabled={busy || !amount}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await admPost(`/orders/${order.id}/quote-approval`, {
                amountCents: Math.round(parseFloat(amount) * 100),
                note,
              });
              onSent();
              onClose();
            } catch (e) {
              // a 400/500/network failure must land in the modal, not vanish
              setErr(e instanceof Error ? e.message : t('Send failed. Please try again.', '送出失敗,請再試一次。'));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('Sending…', '送出中…') : t('Email estimate to customer', '把報價 Email 給顧客')}
        </button>
      )}
      {err && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--a-danger)' }}>{err}</div>}
    </Modal>
  );
}
