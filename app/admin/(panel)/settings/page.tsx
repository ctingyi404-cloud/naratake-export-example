'use client';

import { useEffect, useState } from 'react';
import { admDelete, admGet, admPatch, admPost, confirmDlg, Field, Skel, useAdmLang, useLoad } from '../../ui';
import { site } from '@/lib/site-config';
import {
  differsFromPublished,
  PUBLIC_BUSINESS_FIELDS,
  sameBusinessValue,
  type PublicBusiness,
  type PublicBusinessField,
} from '@/lib/business-profile';

interface Business {
  name: string;
  phone: string;
  email: string;
  address: { line1: string; city: string; state: string; zip: string };
  taxRateBp: number;
  hours: Record<string, [string, string][] | null>;
  delivery: { enabled: boolean; feeCents: number; minCents: number; zips: string[] } | null;
  payments?: { provider: 'stripe' | 'mock'; mode?: 'test' | 'live' | null; publishableKey: string | null; connect: boolean };
  /* Where each public field currently comes from. `overrides` are the ones this
     back office has taken over from the published site; `stranded` are the ones
     someone edited here BEFORE the site could read them, which the storefront
     has been ignoring ever since. */
  profile?: {
    overrides: PublicBusinessField[];
    stranded: PublicBusinessField[];
    published: PublicBusiness;
    /* 每個欄位「真的公開出去會是什麼」。null = 消毒器不接受這個值,所以網站上
       不會有它 —— 但輸入框裡仍然是商家自己打的字。這兩件事分開,是因為把它們
       合成一件會毀資料:表單填消毒後的值,拒絕就變空字串,一按儲存就寫回去。 */
    wouldPublish?: Partial<Record<PublicBusinessField, string | null>>;
  };
}

const FIELD_LABEL: Record<PublicBusinessField, [string, string]> = {
  name: ['Name', '名稱'],
  phone: ['Phone', '電話'],
  email: ['Email', 'Email'],
  address: ['Address', '地址'],
  hours: ['Opening hours', '營業時間'],
};

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_ZH: Record<string, string> = { mon: '週一', tue: '週二', wed: '週三', thu: '週四', fri: '週五', sat: '週六', sun: '週日' };

export default function SettingsPage() {
  const [biz, setBiz] = useState<Business | null>(null);
  /* What the server last confirmed for the five public fields. The badges have
     to distinguish "the site is showing this" from "you have typed this", and
     the override list alone cannot: it says the field is taken over, which
     stays true while the merchant edits the value it was taken over with. */
  const [live, setLive] = useState<Pick<Business, PublicBusinessField> | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');
  const { lang, t } = useAdmLang();

  const remember = (b: Business) => {
    setLive({ name: b.name, phone: b.phone, email: b.email, address: b.address, hours: b.hours });
  };

  useEffect(() => {
    admGet<Business>('/settings')
      .then((b) => {
        setBiz(b);
        remember(b);
      })
      .catch(console.error);
  }, []);

  /* Same signal the nav uses. A site without the orders module has no delivery
     to configure, and saying otherwise on the settings page is how a gym owner
     learns this back office was written for a restaurant. */
  const takesOrders = site.enabledModules.includes('orders');

  // skeleton in the shape of the settings screen: title, then the two-column cards
  if (!biz)
    return (
      <div aria-busy="true">
        <h1 className="adm-page-title">{t('Settings', '設定')}</h1>
        <p className="adm-page-sub">{takesOrders
        ? t('Business details, hours, delivery zone, and your account.', '商家資料、營業時間、外送範圍與你的帳號。')
        : t('Business details, hours, and your account.', '商家資料、營業時間與你的帳號。')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          {[0, 1].map((i) => (
            <div key={i} className="adm-card" style={{ padding: 20 }}>
              <Skel w={120} h={14} />
              {[64, 82, 46, 70].map((w, j) => (
                <Skel key={j} w={`${w}%`} h={12} style={{ marginTop: 16, display: 'block' }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );

  const set = (patch: Partial<Business>) => setBiz({ ...biz, ...patch });

  /* Provenance, computed with the SAME function the server uses to decide it
     (lib/business-profile.ts). A field whose value differs from what Studio
     published is one this shop has taken over; typing the published value back
     in hands it back. Reading that from a shared predicate rather than
     re-deriving it here is what stops the badge and the behaviour from drifting. */
  const owned = (f: PublicBusinessField) => differsFromPublished(f, biz);
  const unsaved = (f: PublicBusinessField) => !live || !sameBusinessValue(biz[f], live[f]);
  const isLive = (f: PublicBusinessField) => !unsaved(f) && owned(f) && (biz.profile?.overrides ?? []).includes(f);
  const pending = PUBLIC_BUSINESS_FIELDS.filter((f) => unsaved(f) || (owned(f) && !isLive(f)));
  const restore = (f: PublicBusinessField) => {
    const published = biz.profile?.published;
    if (published) set({ [f]: published[f] } as Partial<Business>);
  };

  /* One line per field, so nobody has to guess which of the two copies of their
     phone number the public is actually reading.

     A function that returns markup, not a component declared inside a render:
     a nested component is a NEW type on every keystroke, which unmounts and
     remounts the subtree each time the merchant types a character. */
  const provenance = (field: PublicBusinessField) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '-8px 0 14px', fontSize: 12, lineHeight: 1.5 }}>
      {isLive(field) ? (
        <span style={{ color: 'var(--a-primary)', fontWeight: 600 }}>● {t('Live on your site', '已顯示在網站上')}</span>
      ) : owned(field) || unsaved(field) ? (
        <span style={{ color: 'var(--a-warn)', fontWeight: 600 }}>● {t('Not live yet — press Save', '尚未生效,請按儲存')}</span>
      ) : (
        <span style={{ color: 'var(--a-faint)' }}>{t('Same as your published site', '與已發佈的網站相同')}</span>
      )}
      {owned(field) && (
        <button
          type="button"
          className="adm-btn adm-btn-sm"
          onClick={() => restore(field)}
          style={{ padding: '1px 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
        >
          {t('Use published value', '改回發佈時的值')}
        </button>
      )}
    </div>
  );

  async function save() {
    if (!biz || saving) return;
    setSaving(true);
    setSaveErr('');
    try {
      /* The response carries the resolved profile and the new provenance, so
         the badges flip to "Live" from the server's verdict rather than from an
         optimistic guess here. Merged, not replaced: the payments block is
         GET-only and dropping it would blank the TEST MODE warning. */
      const next = await admPatch<Business>('/settings', {
        name: biz.name,
        phone: biz.phone,
        email: biz.email,
        address: biz.address,
        taxRateBp: biz.taxRateBp,
        hours: biz.hours,
        delivery: biz.delivery,
      });
      setBiz((prev) => ({ ...(prev as Business), ...next }));
      remember(next);
      // only claim success if the PATCH actually resolved — was showing "✓ Saved"
      // even when the tax rate / hours never persisted
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : t('Save failed. Please try again', '儲存失敗,請再試一次'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="adm-page-title">{t('Settings', '設定')}</h1>
      <p className="adm-page-sub">{takesOrders
        ? t('Business details, hours, delivery zone, and your account.', '商家資料、營業時間、外送範圍與你的帳號。')
        : t('Business details, hours, and your account.', '商家資料、營業時間與你的帳號。')}</p>

      <div className="adm-card" style={{ padding: '14px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          {t(
            'Your name, phone, email, address and opening hours go live on your website the moment you save — no re-publishing. Anything you have not changed here keeps following the version Naratake published.',
            '名稱、電話、Email、地址與營業時間一按儲存就會顯示在網站上，不需要重新發佈。沒有改過的欄位，會繼續跟著 Naratake 發佈的版本走。',
          )}
        </div>
      </div>

      {/* A shop that edited these fields before the site could read them has a
          backlog: the values are stored, the storefront never showed them. Say
          so, name the fields, and make it one button to fix. */}
      {(biz.profile?.stranded.length ?? 0) > 0 && (
        <div className="adm-card" style={{ padding: '14px 20px', marginBottom: 16, border: '1px solid var(--a-warn)', background: 'var(--a-warn-soft)' }}>
          <strong style={{ fontSize: 13.5, color: 'var(--a-warn)' }}>
            {t('Saved here, but not on your site yet', '已儲存，但網站上還沒顯示')}
          </strong>
          <div style={{ fontSize: 13, color: 'var(--a-warn)', marginTop: 4, lineHeight: 1.6 }}>
            {t(
              `Your ${biz.profile!.stranded.map((f) => FIELD_LABEL[f][0].toLowerCase()).join(', ')} differ from what your website shows. Press Save settings to publish them.`,
              `你的${biz.profile!.stranded.map((f) => FIELD_LABEL[f][1]).join('、')}和網站上顯示的不一樣。按下「儲存設定」就會生效。`,
            )}
          </div>
        </div>
      )}

      {biz.payments &&
        (biz.payments.provider === 'stripe' ? (
          <div className="adm-card" style={{ padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13.5 }}>{t('Payments', '收款')}</strong>
            {/* 'stripe' alone never meant 'live' — a sk_test_ key reads the same
                here, and calling it live is how a shop trades a week for free */}
            {biz.payments.mode === 'test' ? (
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--a-warn)' }}>
                ● {t('Stripe: TEST keys — no card is really charged', 'Stripe:測試金鑰,不會真的扣款')}
              </span>
            ) : (
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--a-primary)' }}>
                ● {t('Stripe: live charges enabled', 'Stripe:已啟用真實收款')}
              </span>
            )}
            {biz.payments.connect && <span className="adm-pill" data-tone="info">Connect</span>}
            {!biz.payments.publishableKey && (
              <span style={{ fontSize: 12.5, color: 'var(--a-faint)' }}>
                {t('Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. The checkout card form cannot load', '缺 NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY 公開金鑰，結帳表單無法載入')}
              </span>
            )}
          </div>
        ) : (
          <div className="adm-card" style={{ padding: '14px 20px', marginBottom: 16, border: '1px solid var(--a-warn)', background: 'var(--a-warn-soft)' }}>
            <strong style={{ fontSize: 13.5, color: 'var(--a-warn)' }}>{t('Payments: TEST MODE', '收款:測試模式')}</strong>
            <div style={{ fontSize: 13, color: 'var(--a-warn)', marginTop: 4 }}>
              {t(
                'Online payments are simulated. Nobody is charged. Set STRIPE_SECRET_KEY and redeploy to switch to live charges automatically.',
                '線上付款是模擬的，不會真的扣款。填入 STRIPE_SECRET_KEY 重新部署後自動切換。',
              )}
            </div>
          </div>
        ))}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="adm-card" style={{ padding: 20 }}>
          <strong style={{ display: 'block', marginBottom: 16 }}>{t('Business', '商家')}</strong>
          <Field label={t('Name', '名稱')}>
            <input className="adm-input" value={biz.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          {provenance('name')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Field label={t('Phone', '電話')}>
                <input className="adm-input" value={biz.phone} onChange={(e) => set({ phone: e.target.value })} />
              </Field>
              {provenance('phone')}
            </div>
            <div>
              <Field label="Email">
                <input className="adm-input" value={biz.email} onChange={(e) => set({ email: e.target.value })} />
              </Field>
              {provenance('email')}
            </div>
          </div>
          <Field label={t('Street address', '街道地址')}>
            <input className="adm-input" value={biz.address.line1} onChange={(e) => set({ address: { ...biz.address, line1: e.target.value } })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <Field label={t('City', '城市')}>
              <input className="adm-input" value={biz.address.city} onChange={(e) => set({ address: { ...biz.address, city: e.target.value } })} />
            </Field>
            <Field label={t('State', '州')}>
              <input className="adm-input" value={biz.address.state} onChange={(e) => set({ address: { ...biz.address, state: e.target.value } })} />
            </Field>
            <Field label={t('ZIP', '郵遞區號')}>
              <input className="adm-input" value={biz.address.zip} onChange={(e) => set({ address: { ...biz.address, zip: e.target.value } })} />
            </Field>
          </div>
          {provenance('address')}
          <Field label={t('Sales tax rate (%)', '銷售稅率 (%)')}>
            <input
              className="adm-input"
              type="number"
              step="0.01"
              value={(biz.taxRateBp / 100).toString()}
              onChange={(e) => set({ taxRateBp: Math.round(parseFloat(e.target.value || '0') * 100) })}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <OrderingControls />
          <div className="adm-card" style={{ padding: 20 }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>{t('Opening hours', '營業時間')}</strong>
            {provenance('hours')}
            {DAYS.map((d) => {
              const spans = biz.hours[d];
              return (
                <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 40, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--a-dim)' }}>{lang === 'zh' ? DAY_ZH[d] : d}</span>
                  {spans ? (
                    <>
                      <input
                        className="adm-input"
                        style={{ width: 90 }}
                        value={spans[0][0]}
                        onChange={(e) => set({ hours: { ...biz.hours, [d]: [[e.target.value, spans[0][1]]] } })}
                      />
                      <span style={{ color: 'var(--a-faint)' }}>–</span>
                      <input
                        className="adm-input"
                        style={{ width: 90 }}
                        value={spans[0][1]}
                        onChange={(e) => set({ hours: { ...biz.hours, [d]: [[spans[0][0], e.target.value]] } })}
                      />
                      <button className="adm-btn adm-btn-sm" onClick={() => set({ hours: { ...biz.hours, [d]: null } })}>
                        {t('Close', '公休')}
                      </button>
                    </>
                  ) : (
                    <button className="adm-btn adm-btn-sm" onClick={() => set({ hours: { ...biz.hours, [d]: [['11:00', '21:00']] } })}>
                      {t('Closed. Open this day', '公休,設為營業')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Delivery is a question only a business that takes orders can answer.
              Ungated, this card offered a gym a delivery fee, an order minimum
              and a list of ZIP codes to deliver personal training to. Same rule
              the nav already uses to keep a law firm from growing a POS. */}
          {takesOrders && (
          <div className="adm-card" style={{ padding: 20 }}>
            <strong style={{ display: 'block', marginBottom: 14 }}>{t('Delivery', '外送')}</strong>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={biz.delivery?.enabled ?? false}
                onChange={(e) =>
                  set({
                    delivery: {
                      enabled: e.target.checked,
                      feeCents: biz.delivery?.feeCents ?? 399,
                      minCents: biz.delivery?.minCents ?? 2000,
                      zips: biz.delivery?.zips ?? [],
                    },
                  })
                }
              />
              {t('Offer delivery', '提供外送')}
            </label>
            {biz.delivery?.enabled && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label={t('Fee (USD)', '外送費（美元）')}>
                    <input className="adm-input" type="number" step="0.01" value={(biz.delivery.feeCents / 100).toString()} onChange={(e) => set({ delivery: { ...biz.delivery!, feeCents: Math.round(parseFloat(e.target.value || '0') * 100) } })} />
                  </Field>
                  <Field label={t('Minimum order (USD)', '最低訂購額（美元）')}>
                    <input className="adm-input" type="number" step="0.01" value={(biz.delivery.minCents / 100).toString()} onChange={(e) => set({ delivery: { ...biz.delivery!, minCents: Math.round(parseFloat(e.target.value || '0') * 100) } })} />
                  </Field>
                </div>
                <Field label={t('Delivery ZIP codes (comma-separated)', '外送郵遞區號（以逗號分隔）')}>
                  <input className="adm-input" value={biz.delivery.zips.join(', ')} onChange={(e) => set({ delivery: { ...biz.delivery!, zips: e.target.value.split(',').map((z) => z.trim()).filter(Boolean) } })} />
                </Field>
              </>
            )}
          </div>
          )}

          {/* a register belongs to a site that takes orders; without that
              module there is no /terminals route to ask, and the card was a
              404 on the settings screen of every blog and job board */}
          {site.enabledModules.includes('orders') && <TerminalsCard />}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 18, alignItems: 'center' }}>
        <button className="adm-btn adm-btn-primary" onClick={save} disabled={saving}>
          {saving ? t('Saving…', '儲存中…') : t('Save settings', '儲存設定')}
        </button>
        {saved && <span style={{ color: 'var(--a-primary)', fontWeight: 600, fontSize: 13.5 }}>✓ {t('Saved — live on your site', '已儲存，網站已更新')}</span>}
        {saveErr && <span style={{ color: 'var(--a-danger)', fontWeight: 600, fontSize: 13.5 }}>{saveErr}</span>}
        {!saved && !saveErr && pending.length > 0 && (
          <span style={{ color: 'var(--a-faint)', fontSize: 12.5 }}>
            {t(
              `${pending.length} change${pending.length > 1 ? 's' : ''} not on your site yet`,
              `有 ${pending.length} 項變更還沒生效`,
            )}
          </span>
        )}
      </div>

      <div className="adm-card" style={{ padding: 20, marginTop: 24, maxWidth: 480 }}>
        <strong style={{ display: 'block', marginBottom: 14 }}>{t('Change password', '更改密碼')}</strong>
        <Field label={t('Current password', '目前密碼')}>
          <input className="adm-input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <Field label={t('New password (8+ characters)', '新密碼（至少 8 個字元）')}>
          <input className="adm-input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <button
          className="adm-btn"
          disabled={!pw.current || pw.next.length < 8}
          onClick={async () => {
            try {
              await admPost('/auth/change-password', pw);
              setPwMsg('✓ ' + t('Password updated', '密碼已更新'));
              setPw({ current: '', next: '' });
            } catch (err) {
              setPwMsg(err instanceof Error ? err.message : t('Failed', '失敗'));
            }
          }}
        >
          {t('Update password', '更新密碼')}
        </button>
        {pwMsg && <div style={{ marginTop: 10, fontSize: 13, color: pwMsg.startsWith('✓') ? 'var(--a-primary)' : 'var(--a-danger)' }}>{pwMsg}</div>}
      </div>

      <UsersCard />
    </>
  );
}

/* Back-office users.

   Owner-only, and the card knows it only so it can stay out of the way: the
   permission table grants the `users` resource to OWNER alone and the API
   enforces that before any handler runs, so hiding this is presentation, not
   protection. A manager who guesses the URL still gets a 403. */
function UsersCard() {
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  useEffect(() => {
    admGet<{ id: string; role: string }>('/me').then(setMe).catch(() => {});
  }, []);
  if (me?.role !== 'OWNER') return null;
  return <OwnerUsers meId={me.id} />;
}

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
}

function OwnerUsers({ meId }: { meId: string }) {
  const { t } = useAdmLang();
  const { data, reload } = useLoad<{ users: AdminUserRow[] }>('/users');
  const [draft, setDraft] = useState({ name: '', email: '', password: '', role: 'STAFF' });
  const [msg, setMsg] = useState('');
  if (!data) return null;

  const ROLE_LABEL: Record<string, string> = {
    OWNER: t('Owner', '擁有者'),
    MANAGER: t('Manager', '經理'),
    STAFF: t('Staff', '員工'),
  };

  /* every write goes through here so the server's refusal (last owner, email
     already taken) is what the merchant reads, instead of a silent no-op */
  const run = async (work: () => Promise<unknown>) => {
    setMsg('');
    try {
      await work();
      reload();
      return true;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t('Failed', '失敗'));
      return false;
    }
  };

  return (
    <div className="adm-card" style={{ padding: 20, marginTop: 24, maxWidth: 720 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>{t('Who can sign in', '可以登入的人')}</strong>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--a-faint)', lineHeight: 1.55 }}>
        {t(
          'Owners run everything, including this list. Managers run the business but cannot add logins. Staff work the floor: they take orders and bookings, but cannot issue refunds, change prices or tax, or delete anything.',
          '擁有者可以做所有事，包含管理這份名單。經理可以經營生意，但不能新增帳號。員工負責日常：可以處理訂單與預約，但不能退款、改價格或稅率，也不能刪除資料。',
        )}
      </p>

      {data.users.map((u) => (
        <div
          key={u.id}
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, opacity: u.active ? 1 : 0.55 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, ...(u.active ? {} : { textDecoration: 'line-through' }) }}>
              {u.name}
              {u.id === meId && (
                <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 12, color: 'var(--a-faint)' }}>
                  {t('you', '你')}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--a-faint)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
          </div>
          <select
            className="adm-input"
            style={{ width: 130 }}
            value={u.role}
            aria-label={t('Role', '角色')}
            onChange={(e) => void run(() => admPatch(`/users/${u.id}`, { role: e.target.value }))}
          >
            {Object.entries(ROLE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="adm-btn adm-btn-sm"
            onClick={() => void run(() => admPatch(`/users/${u.id}`, { active: !u.active }))}
          >
            {u.active ? t('Suspend', '停用') : t('Restore', '啟用')}
          </button>
          <button
            className="adm-btn adm-btn-sm"
            onClick={async () => {
              if (await confirmDlg(t(`Remove ${u.name}? They lose access immediately.`, `移除 ${u.name}？對方會立刻失去存取權限。`), { confirmLabel: t('Remove', '移除') }))
                void run(() => admDelete(`/users/${u.id}`));
            }}
          >
            {t('Remove', '移除')}
          </button>
        </div>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 1fr 130px auto', gap: 8, alignItems: 'end', marginTop: 16 }}>
        <Field label={t('Name', '名稱')}>
          <input className="adm-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="adm-input" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </Field>
        <Field label={t('Password (8+)', '密碼（8 字元以上）')}>
          <input className="adm-input" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
        </Field>
        <Field label={t('Role', '角色')}>
          <select className="adm-input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
            {Object.entries(ROLE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="adm-btn"
          style={{ marginBottom: 12 }}
          disabled={!draft.name.trim() || !draft.email.trim() || draft.password.length < 8}
          onClick={async () => {
            if (await run(() => admPost('/users', draft))) setDraft({ name: '', email: '', password: '', role: 'STAFF' });
          }}
        >
          {t('Add', '新增')}
        </button>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--a-danger)' }}>{msg}</div>}
    </div>
  );
}

/* POS terminals: one row per register or station. Each POS device picks which
   one it is; Z-reports show per-terminal totals. Deactivate, never delete —
   historical orders keep pointing at the row. */
function TerminalsCard() {
  const { t } = useAdmLang();
  const { data, reload } = useLoad<{ terminals: { id: string; name: string; active: boolean }[] }>('/terminals');
  const [adding, setAdding] = useState('');
  if (!data) return null;

  const rename = async (id: string, next: string, prev: string) => {
    const name = next.trim();
    if (!name || name === prev) return;
    await admPatch(`/terminals/${id}`, { name });
    reload();
  };

  return (
    <div className="adm-card" style={{ padding: 20 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>{t('POS terminals', 'POS 櫃台')}</strong>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--a-faint)' }}>
        {t(
          'One per register or station. Each POS device picks which one it is; Z-reports break totals down per terminal.',
          '每台收銀機或工作站一個。每台 POS 裝置選擇自己是哪個櫃台,Z 報表會分櫃台統計。',
        )}
      </p>
      {data.terminals.map((tm) => (
        <div key={tm.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            className="adm-input"
            defaultValue={tm.name}
            disabled={!tm.active}
            style={{ flex: 1, ...(tm.active ? {} : { opacity: 0.55, textDecoration: 'line-through' }) }}
            onBlur={(e) => void rename(tm.id, e.target.value, tm.name)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <button
            className="adm-btn adm-btn-sm"
            onClick={async () => { await admPatch(`/terminals/${tm.id}`, { active: !tm.active }); reload(); }}
          >
            {tm.active ? t('Deactivate', '停用') : t('Reactivate', '啟用')}
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="adm-input"
          style={{ flex: 1 }}
          placeholder={t('New terminal name', '新櫃台名稱')}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <button
          className="adm-btn adm-btn-sm"
          disabled={!adding.trim()}
          onClick={async () => { await admPost('/terminals', { name: adding.trim() }); setAdding(''); reload(); }}
        >
          {t('Add', '新增')}
        </button>
      </div>
    </div>
  );
}

/* Pause the kitchen / mark holidays. Server-enforced: the public order and
   booking routes 409 while paused or on a blackout date — not just hidden UI. */
function OrderingControls() {
  const { t } = useAdmLang();
  const [state, setState] = useState<{ pausedUntil: string | null; blackoutDates: string[] } | null>(null);
  const [newDate, setNewDate] = useState('');

  useEffect(() => {
    admGet<{ pausedUntil: string | null; blackoutDates: string[] }>('/settings/ordering').then(setState).catch(console.error);
  }, []);
  if (!state) return null;

  const patch = async (body: { pausedUntil?: string | null; blackoutDates?: string[] }) =>
    setState(await admPatch<typeof state>('/settings/ordering', body));
  const pauseFor = (min: number) => patch({ pausedUntil: new Date(Date.now() + min * 60_000).toISOString() });

  return (
    <div className="adm-card" style={{ padding: 20 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>{t('Ordering controls', '接單控制')}</strong>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--a-faint)' }}>
        {t('Pausing blocks new online orders instantly (kitchen slammed, sold out).', '暫停後前台立即無法下單（爆單、售完時用）。')}
      </p>
      {state.pausedUntil ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--a-danger)' }}>
            ⏸ {t('Paused until', '已暫停至')} {new Date(state.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button className="adm-btn adm-btn-sm" onClick={() => void patch({ pausedUntil: null })}>{t('Resume now', '立即恢復')}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className="adm-btn adm-btn-sm" onClick={() => void pauseFor(30)}>{t('Pause 30 min', '暫停 30 分')}</button>
          <button className="adm-btn adm-btn-sm" onClick={() => void pauseFor(60)}>{t('Pause 1 hour', '暫停 1 小時')}</button>
          <button className="adm-btn adm-btn-sm" onClick={() => void pauseFor(24 * 60)}>{t('Pause today', '今天不接單')}</button>
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--a-dim)', marginBottom: 6 }}>
        {t('Holiday closures', '公休日')}
      </div>
      {state.blackoutDates.map((d) => (
        <div key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 8px 8px 0', padding: '4px 10px', border: '1px solid var(--a-border)', borderRadius: 999, fontSize: 13 }}>
          {d}
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--a-faint)', padding: 0 }}
            aria-label={t('Remove', '移除')}
            onClick={() => void patch({ blackoutDates: state.blackoutDates.filter((x) => x !== d) })}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input className="adm-input" type="date" style={{ width: 170 }} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        <button
          className="adm-btn adm-btn-sm"
          disabled={!newDate}
          onClick={() => { void patch({ blackoutDates: [...state.blackoutDates, newDate] }); setNewDate(''); }}
        >
          {t('Add closure', '新增公休')}
        </button>
      </div>
    </div>
  );
}
