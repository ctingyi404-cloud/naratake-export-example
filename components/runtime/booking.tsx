'use client';

/* Reservations, appointments, and class enrollment — live availability from
   the API, deposits via mock/Stripe. */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { BodyPortal } from './BodyPortal';
import { apiGet, apiPost } from '@/lib/client';
import { money } from '@/lib/money';
import { useSiteLang } from '@/lib/site-i18n';
import { trackConversion } from '@/lib/track';

type Sty = { className?: string; style?: CSSProperties };

function todayPlus(d: number): string {
  return new Date(Date.now() + d * 86400_000).toLocaleDateString('en-CA');
}

/** Date options computed on the CLIENT only. These pages are statically prerendered,
    so calling todayPlus() during render would bake the build day's dates into the HTML
    and every visit after deploy day would hydration-mismatch (and show past dates before
    JS runs). Start empty (matches SSR) and fill on mount, like countdown.tsx. */
function useDateOptions(count: number, startOffset = 0): string[] {
  const [dates, setDates] = useState<string[]>([]);
  useEffect(() => {
    setDates(Array.from({ length: count }, (_, i) => todayPlus(i + startOffset)));
  }, [count, startOffset]);
  return dates;
}

function niceDate(dateKey: string, lang: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/* marketing opt-in row under the email field — the server only records it when
   an email was actually given */
function OptInRow({ checked, onChange, lang }: { checked: boolean; onChange: (v: boolean) => void; lang: 'en' | 'zh' | 'es' }) {
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--c-text-muted)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--c-primary)' }} />
      {t3('Email me offers & updates', '寄送優惠與最新消息給我', 'Envíenme ofertas y novedades')}
    </label>
  );
}

/* ── reservations ── */

export function RtReservationWidget({ maxParty = 8, className, style }: Sty & { maxParty?: number }) {
  const { lang } = useSiteLang();
  const [party, setParty] = useState(2);
  const dateOptions = useDateOptions(14, 0);
  const [date, setDate] = useState('');
  useEffect(() => { if (!date && dateOptions.length) setDate(dateOptions[0]); }, [dateOptions, date]);
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ code: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setTime('');
    apiGet<{ slots: { time: string; available: boolean }[] }>(
      `/reservations/availability?date=${date}&party=${party}`,
    )
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false));
  }, [date, party]);

  async function submit() {
    setError('');
    if (!time || !name || !phone) {
      setError(lang === 'es' ? 'Elige una hora e ingresa nombre y teléfono' : lang === 'zh' ? '請選擇時段並填寫姓名電話' : 'Pick a time and fill in name & phone');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ code: string }>('/reservations', {
        date,
        time,
        partySize: party,
        name,
        phone,
        email,
        marketingOptIn: optIn,
        notes,
      });
      trackConversion('schedule', { label: 'reservation' });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={`ls-card ls-fade-up ${className ?? ''}`} style={{ padding: 36, textAlign: 'center', ...style }}>
        <div style={{ fontSize: 40 }}>🎉</div>
        <h3 className="font-heading" style={{ fontSize: 24, margin: '10px 0 6px' }}>
          {lang === 'es' ? '¡Mesa reservada!' : lang === 'zh' ? '訂位成功！' : 'Table booked!'}
        </h3>
        <p style={{ color: 'var(--c-text-muted)', margin: 0, fontSize: 14.5 }}>
          {niceDate(date, lang)} · {time} · {party} {lang === 'zh' ? '位' : party === 1 ? 'guest' : 'guests'}
        </p>
        <p style={{ marginTop: 8, fontSize: 14 }}>
          {lang === 'es' ? 'Confirmación' : lang === 'zh' ? '確認碼' : 'Confirmation'}: <strong style={{ color: 'var(--c-primary)' }}>{done.code}</strong>
        </p>
        <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
          {lang === 'es'
            ? 'Guarda este código. Con él puedes buscar o cancelar tu reserva en esta página.'
            : lang === 'zh'
              ? '請保留此確認碼，可在本頁查詢或取消訂位。'
              : 'Keep this code. You can find or cancel your reservation on this page with it.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
      <strong className="font-heading" style={{ fontSize: 19 }}>{lang === 'es' ? 'Reservar mesa' : lang === 'zh' ? '預約訂位' : 'Reserve a table'}</strong>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="ls-label">{lang === 'es' ? 'Número de personas' : lang === 'zh' ? '人數' : 'Party size'}</span>
          <select className="ls-input" value={party} onChange={(e) => setParty(Number(e.target.value))}>
            {Array.from({ length: maxParty }, (_, i) => (
              <option key={i} value={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="ls-label">{lang === 'es' ? 'Fecha' : lang === 'zh' ? '日期' : 'Date'}</span>
          <select className="ls-input" value={date} onChange={(e) => setDate(e.target.value)}>
            {dateOptions.map((dk) => (
              <option key={dk} value={dk}>{niceDate(dk, lang)}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <span className="ls-label">{lang === 'es' ? 'Hora' : lang === 'zh' ? '時段' : 'Time'}</span>
        {loading ? (
          <div className="ls-skeleton" style={{ height: 76 }} />
        ) : slots.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-muted)' }}>
            {lang === 'es' ? 'No hay horarios este día. Prueba otra fecha.' : lang === 'zh' ? '這天沒有可訂時段，換一天試試。' : 'No times this day. Try another date.'}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-md:grid-cols-3">
            {slots.map((s) => (
              <button
                key={s.time}
                disabled={!s.available}
                onClick={() => setTime(s.time)}
                style={{
                  padding: '9px 4px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 'var(--r-md)',
                  cursor: s.available ? 'pointer' : 'not-allowed',
                  background: time === s.time ? 'var(--c-primary)' : 'var(--c-surface)',
                  color: time === s.time ? 'var(--c-primary-fg)' : s.available ? 'var(--c-text)' : 'var(--c-border)',
                  border: `1px solid ${time === s.time ? 'var(--c-primary)' : 'var(--c-border)'}`,
                  textDecoration: s.available ? 'none' : 'line-through',
                }}
              >
                {s.time}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} className="ls-input" placeholder={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <input aria-label="Email" className="ls-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <OptInRow checked={optIn} onChange={setOptIn} lang={lang} />
      <input aria-label={lang === 'es' ? 'Notas (alergias, ocasión…)' : lang === 'zh' ? '備註（過敏、慶祝場合…）' : 'Notes (allergies, occasion…)'} className="ls-input" placeholder={lang === 'es' ? 'Notas (alergias, ocasión…)' : lang === 'zh' ? '備註（過敏、慶祝場合…）' : 'Notes (allergies, occasion…)'} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{error}</div>}
      <button className="ls-btn" style={{ justifyContent: 'center' }} disabled={busy} onClick={submit}>
        {busy ? '…' : lang === 'es' ? 'Confirmar reserva' : lang === 'zh' ? '確認訂位' : 'Confirm reservation'}
      </button>
      <ManageReservation lang={lang} />
    </div>
  );
}

/* guests find + cancel their own reservation with code + phone */
function ManageReservation({ lang }: { lang: 'en' | 'zh' | 'es' }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resv, setResv] = useState<{ code: string; partySize: number; startsAt: string; status: string } | null>(null);
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  const STATUS: Record<string, [string, string, string]> = {
    CONFIRMED: ['Confirmed', '已確認', 'Confirmada'],
    SEATED: ['Seated', '已入座', 'En mesa'],
    COMPLETED: ['Completed', '已完成', 'Completada'],
    NO_SHOW: ['No-show', '未到', 'No asistió'],
    CANCELED: ['Canceled', '已取消', 'Cancelada'],
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-TW' : lang === 'es' ? 'es' : 'en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function lookup() {
    setErr('');
    setBusy(true);
    try {
      const r = await apiPost<{ reservation: NonNullable<typeof resv> }>('/reservations/lookup', { code, phone });
      setResv(r.reservation);
    } catch {
      setResv(null);
      setErr(t3('No match. Check the code and phone.', '找不到，請確認確認碼與電話。', 'Sin coincidencia. Revisa el código y el teléfono.'));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!resv) return;
    if (!window.confirm(t3('Cancel this reservation?', '確定要取消這筆訂位嗎？', '¿Cancelar esta reserva?'))) return;
    setBusy(true);
    setErr('');
    try {
      await apiPost('/reservations/cancel', { code, phone });
      setResv({ ...resv, status: 'CANCELED' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 14 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--c-text-muted)', textDecoration: 'underline' }}
      >
        {t3('Manage reservation: find or cancel', '管理訂位:查詢或取消', 'Gestionar reserva: buscar o cancelar')}
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <input
              aria-label={t3('Confirmation code', '確認碼', 'Código de confirmación')}
              className="ls-input"
              placeholder={t3('Code (e.g. R-012)', '確認碼（如 R-012）', 'Código (ej. R-012)')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              aria-label={t3('Phone', '電話', 'Teléfono')}
              className="ls-input"
              placeholder={t3('Phone used to book', '訂位時的電話', 'Teléfono usado al reservar')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <button className="ls-btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !code || !phone} onClick={lookup}>
            {busy ? '…' : t3('Find my reservation', '查詢訂位', 'Buscar mi reserva')}
          </button>
          {err && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{err}</div>}
          {resv && (
            <div className="ls-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong style={{ fontSize: 14.5 }}>
                {t3(`Table for ${resv.partySize}`, `${resv.partySize} 位訂位`, `Mesa para ${resv.partySize}`)}
              </strong>
              <span style={{ fontSize: 13.5, color: 'var(--c-text-muted)' }}>
                {when(resv.startsAt)} · {resv.code}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: resv.status === 'CANCELED' ? '#c0392b' : 'var(--c-primary)' }}>
                {(STATUS[resv.status] ?? [resv.status, resv.status, resv.status])[lang === 'es' ? 2 : lang === 'zh' ? 1 : 0]}
              </span>
              {resv.status === 'CONFIRMED' && new Date(resv.startsAt).getTime() > Date.now() && (
                <button
                  className="ls-btn"
                  style={{ alignSelf: 'flex-start', background: 'transparent', color: '#c0392b', border: '1.5px solid #c0392b' }}
                  disabled={busy}
                  onClick={cancel}
                >
                  {t3('Cancel this reservation', '取消這筆訂位', 'Cancelar esta reserva')}
                </button>
              )}
              {resv.status === 'CANCELED' && (
                <span role="alert" style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>
                  {t3('Your reservation has been canceled.', '你的訂位已取消。', 'Tu reserva ha sido cancelada.')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── appointments ── */

interface ServiceCat {
  id?: string;
  name: string;
  nameZh?: string | null;
  items: {
    id: string;
    name: string;
    nameZh?: string | null;
    priceCents: number;
    durationMin?: number | null;
    depositCents?: number | null;
    /** codegen bakes the full catalog item — extra display fields are welcome */
    description?: string | null;
    descriptionZh?: string | null;
    imageUrl?: string | null;
    badges?: string[];
    modifiers?: unknown[];
  }[];
}
interface StaffLite {
  id: string;
  name: string;
  role?: string | null;
  /** merchant-uploaded photo (from the admin backoffice) */
  photoUrl?: string | null;
}

export function RtAppointmentBooking({
  initialData,
  collectDeposit = true,
  className,
  style,
}: Sty & { initialData?: ServiceCat[]; collectDeposit?: boolean }) {
  const { lang, pick } = useSiteLang();
  const [cats, setCats] = useState<ServiceCat[]>(initialData ?? []);
  const [catIdx, setCatIdx] = useState(0);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('any');
  const apptDates = useDateOptions(14, 0);
  const [date, setDate] = useState('');
  useEffect(() => { if (!date && apptDates.length) setDate(apptDates[0]); }, [apptDates, date]);
  const [slots, setSlots] = useState<{ time: string; staffId: string }[]>([]);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ code: string; staffName?: string } | null>(null);

  useEffect(() => {
    apiGet<{ categories: ServiceCat[] }>('/appointments/services')
      .then((r) => {
        if (r.categories.length) setCats(r.categories);
      })
      .catch(() => {});
    apiGet<{ staff: StaffLite[] }>('/appointments/staff')
      .then((r) => setStaff(r.staff))
      .catch(() => {});
  }, []);

  const services = useMemo(() => cats.flatMap((c) => c.items), [cats]);
  const service = services.find((s) => s.id === serviceId);
  const deposit = collectDeposit ? (service?.depositCents ?? 0) : 0;

  useEffect(() => {
    if (!serviceId) return;
    setLoadingSlots(true);
    setTime('');
    apiGet<{ slots: { time: string; staffId: string }[] }>(
      `/appointments/availability?serviceId=${serviceId}&staffId=${staffId}&date=${date}`,
    )
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [serviceId, staffId, date]);

  async function submit() {
    setError('');
    if (!service || !time || !name || !phone) {
      setError(lang === 'es' ? 'Completa todos los pasos primero' : lang === 'zh' ? '請完成所有步驟' : 'Complete all steps first');
      return;
    }
    setBusy(true);
    try {
      let intentId: string | undefined;
      if (deposit > 0) {
        // charge exactly the deposit — a full-price intent fails the server's
        // depositCents check under a real Stripe key
        // card reader first, THEN the charge — an intent minted before we knew
        // Stripe.js could load became an orphan in the merchant's dashboard
        const { cardUnavailable, collectStripePayment, siteStripeOrNull } = await import('./stripe-sheet');
        const stripe = await siteStripeOrNull(lang);
        const intent = await apiPost<{ provider: string; clientSecret: string; externalId: string }>(
          '/appointments/deposit-intent',
          { serviceItemId: service.id },
        );
        // deposit is verified server-side against the service's depositCents;
        // mock provider auto-succeeds, stripe uses the payment sheet
        if (intent.provider === 'STRIPE') {
          if (!stripe) throw cardUnavailable(lang);
          const ok = await collectStripePayment(stripe, intent.clientSecret);
          if (!ok) {
            setBusy(false);
            return;
          }
        }
        intentId = intent.externalId;
      }
      const res = await apiPost<{ code: string; staffName?: string }>('/appointments', {
        serviceItemId: service.id,
        staffId,
        date,
        time,
        name,
        phone,
        email,
        marketingOptIn: optIn,
        payment: intentId ? { intentId } : undefined,
      });
      trackConversion('schedule', { label: 'appointment' });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={`ls-card ls-fade-up ${className ?? ''}`} style={{ padding: 36, textAlign: 'center', ...style }}>
        <div style={{ fontSize: 40 }}>✓</div>
        <h3 className="font-heading" style={{ fontSize: 24, margin: '10px 0 6px' }}>
          {lang === 'es' ? '¡Cita confirmada!' : lang === 'zh' ? '預約成功！' : 'You are booked!'}
        </h3>
        <p style={{ color: 'var(--c-text-muted)', margin: 0, fontSize: 14.5 }}>
          {service && pick(service.name, service.nameZh)} · {niceDate(date, lang)} {time}
          {done.staffName ? ` · ${done.staffName}` : ''}
        </p>
        <p style={{ marginTop: 8, fontSize: 14 }}>
          {lang === 'es' ? 'Confirmación' : lang === 'zh' ? '確認碼' : 'Confirmation'}: <strong style={{ color: 'var(--c-primary)' }}>{done.code}</strong>
        </p>
        <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
          {lang === 'es'
            ? 'Guarda este código. Con él puedes buscar o cancelar tu cita en esta página.'
            : lang === 'zh'
              ? '請保留此確認碼，可在本頁查詢或取消預約。'
              : 'Keep this code. You can find or cancel your appointment on this page with it.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      <strong className="font-heading" style={{ fontSize: 19 }}>{lang === 'es' ? 'Reservar cita' : lang === 'zh' ? '線上預約' : 'Book an appointment'}</strong>

      <div>
        <span className="ls-label">1 · {lang === 'es' ? 'Elige un servicio' : lang === 'zh' ? '選擇服務' : 'Choose a service'}</span>
        {cats.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {cats.map((c, i) => (
              <button
                key={c.id ?? i}
                onClick={() => {
                  setCatIdx(i);
                  // a service hidden by the tab switch must not stay armed on
                  // the confirm button — reset unless it lives in this category
                  if (!(cats[i]?.items ?? []).some((s) => s.id === serviceId)) {
                    setServiceId('');
                    setTime('');
                  }
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: i === catIdx ? 'var(--c-primary)' : 'var(--c-surface)',
                  color: i === catIdx ? 'var(--c-primary-fg)' : 'var(--c-text-muted)',
                  border: `1px solid ${i === catIdx ? 'var(--c-primary)' : 'var(--c-border)'}`,
                }}
              >
                {pick(c.name, c.nameZh)}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(cats.length > 1 ? (cats[catIdx]?.items ?? []) : services).map((s) => (
            <button
              key={s.id}
              onClick={() => setServiceId(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 15px',
                borderRadius: 'var(--r-md)',
                border: `1.5px solid ${serviceId === s.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
                background: serviceId === s.id ? 'color-mix(in srgb, var(--c-primary) 6%, transparent)' : 'var(--c-surface)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--c-text)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{pick(s.name, s.nameZh)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                  {s.durationMin ?? 60} min
                  {collectDeposit && (s.depositCents ?? 0) > 0 && ` · ${money(s.depositCents!)} ${lang === 'es' ? 'depósito' : lang === 'zh' ? '訂金' : 'deposit'}`}
                </div>
              </div>
              <span style={{ fontWeight: 700, color: 'var(--c-primary)' }}>{s.priceCents === 0 ? 'Free' : money(s.priceCents)}</span>
            </button>
          ))}
        </div>
      </div>

      {staff.length > 0 && (
        <div>
          <span className="ls-label">2 · {lang === 'es' ? 'Elige tu profesional' : lang === 'zh' ? '指定服務人員' : 'Choose your pro'}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StaffChip active={staffId === 'any'} onClick={() => setStaffId('any')} label={lang === 'es' ? 'Cualquiera' : lang === 'zh' ? '不指定' : 'Anyone'} />
            {staff.map((s) => (
              <StaffChip key={s.id} active={staffId === s.id} onClick={() => setStaffId(s.id)} label={s.name} sub={s.role ?? undefined} photo={s.photoUrl} />
            ))}
          </div>
        </div>
      )}

      <div>
        {/* 沒有人員名單時步驟 2 整塊不渲染 —— 編號要跟著縮,1→3 跳號看起來
          像壞掉(牙醫、洗衣兩家的行銷卡抓到)。 */}
        <span className="ls-label">{staff.length > 0 ? 3 : 2} · {lang === 'es' ? 'Elige una hora' : lang === 'zh' ? '日期與時段' : 'Pick a time'}</span>
        <select className="ls-input" style={{ marginBottom: 10 }} value={date} onChange={(e) => setDate(e.target.value)}>
          {apptDates.map((dk) => (
            <option key={dk} value={dk}>{niceDate(dk, lang)}</option>
          ))}
        </select>
        {!serviceId ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-muted)' }}>
            {lang === 'es' ? 'Elige un servicio primero.' : lang === 'zh' ? '先選擇服務。' : 'Choose a service first.'}
          </p>
        ) : loadingSlots ? (
          <div className="ls-skeleton" style={{ height: 72 }} />
        ) : slots.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-muted)' }}>
            {lang === 'es' ? 'No hay disponibilidad este día. Prueba otra fecha.' : lang === 'zh' ? '這天沒有空檔，試試其他日期。' : 'No openings this day. Try another date.'}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-md:grid-cols-3">
            {slots.map((s) => (
              <button
                key={`${s.time}-${s.staffId}`}
                onClick={() => setTime(s.time)}
                style={{
                  padding: '9px 4px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer',
                  background: time === s.time ? 'var(--c-primary)' : 'var(--c-surface)',
                  color: time === s.time ? 'var(--c-primary-fg)' : 'var(--c-text)',
                  border: `1px solid ${time === s.time ? 'var(--c-primary)' : 'var(--c-border)'}`,
                }}
              >
                {s.time}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className="ls-label">{staff.length > 0 ? 4 : 3} · {lang === 'es' ? 'Tus datos' : lang === 'zh' ? '你的資料' : 'Your details'}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="grid grid-cols-2 gap-3">
            <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} value={name} onChange={(e) => setName(e.target.value)} />
            <input aria-label={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} className="ls-input" placeholder={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <input aria-label="Email" className="ls-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <OptInRow checked={optIn} onChange={setOptIn} lang={lang} />
        </div>
      </div>

      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{error}</div>}
      <button className="ls-btn" style={{ justifyContent: 'center' }} disabled={busy} onClick={submit}>
        {busy
          ? '…'
          : deposit > 0
            ? `${lang === 'es' ? 'Pagar depósito y reservar' : lang === 'zh' ? '付訂金並預約' : 'Pay deposit & book'} · ${money(deposit)}`
            : lang === 'zh'
              ? '確認預約'
              : 'Confirm booking'}
      </button>
      <ManageBooking lang={lang} />
    </div>
  );
}

/* customers find + cancel their own appointment with code + phone */
function ManageBooking({ lang }: { lang: 'en' | 'zh' | 'es' }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [appt, setAppt] = useState<{
    code: string;
    serviceName: string;
    staffName?: string | null;
    startsAt: string;
    status: string;
    depositCents?: number;
  } | null>(null);
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  const STATUS: Record<string, [string, string, string]> = {
    CONFIRMED: ['Confirmed', '已確認', 'Confirmada'],
    COMPLETED: ['Completed', '已完成', 'Completada'],
    NO_SHOW: ['No-show', '未到', 'No asistió'],
    CANCELED: ['Canceled', '已取消', 'Cancelada'],
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === 'zh' ? 'zh-TW' : lang === 'es' ? 'es' : 'en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function lookup() {
    setErr('');
    setBusy(true);
    try {
      const r = await apiPost<{ appointment: NonNullable<typeof appt> }>('/appointments/lookup', { code, phone });
      setAppt(r.appointment);
    } catch {
      setAppt(null);
      setErr(t3('No match. Check the code and phone.', '找不到，請確認確認碼與電話。', 'Sin coincidencia. Revisa el código y el teléfono.'));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!appt) return;
    // one tap must never silently forfeit a paid deposit
    const dep = appt.depositCents ?? 0;
    const warn = dep > 0
      ? t3(
          `Cancel this appointment? Your ${money(dep)} deposit will not be refunded automatically.`,
          `確定取消這筆預約嗎？已付訂金 ${money(dep)} 不會自動退還。`,
          `¿Cancelar esta cita? Tu depósito de ${money(dep)} no se reembolsa automáticamente.`,
        )
      : t3('Cancel this appointment?', '確定取消這筆預約嗎？', '¿Cancelar esta cita?');
    if (!window.confirm(warn)) return;
    setBusy(true);
    setErr('');
    try {
      await apiPost('/appointments/cancel', { code, phone });
      setAppt({ ...appt, status: 'CANCELED' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 14 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'var(--c-text-muted)', textDecoration: 'underline' }}
      >
        {t3('Already booked? Find or cancel your appointment', '已有預約？查詢或取消', '¿Ya reservaste? Busca o cancela tu cita')}
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <input
              aria-label={t3('Confirmation code', '確認碼', 'Código de confirmación')}
              className="ls-input"
              placeholder={t3('Code (e.g. B-012)', '確認碼（如 B-012）', 'Código (ej. B-012)')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              aria-label={t3('Phone', '電話', 'Teléfono')}
              className="ls-input"
              placeholder={t3('Phone used to book', '預約時的電話', 'Teléfono usado al reservar')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <button className="ls-btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !code || !phone} onClick={lookup}>
            {busy ? '…' : t3('Find my appointment', '查詢預約', 'Buscar mi cita')}
          </button>
          {err && <div style={{ color: '#c0392b', fontSize: 13 }}>{err}</div>}
          {appt && (
            <div className="ls-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong style={{ fontSize: 14.5 }}>{appt.serviceName}</strong>
              <span style={{ fontSize: 13.5, color: 'var(--c-text-muted)' }}>
                {when(appt.startsAt)}
                {appt.staffName ? ` · ${appt.staffName}` : ''} · {appt.code}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: appt.status === 'CANCELED' ? '#c0392b' : 'var(--c-primary)' }}>
                {(STATUS[appt.status] ?? [appt.status, appt.status, appt.status])[lang === 'es' ? 2 : lang === 'zh' ? 1 : 0]}
              </span>
              {(appt.depositCents ?? 0) > 0 && appt.status === 'CONFIRMED' && (
                <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                  {t3(`Deposit paid: ${money(appt.depositCents!)}`, `已付訂金：${money(appt.depositCents!)}`, `Depósito pagado: ${money(appt.depositCents!)}`)}
                </span>
              )}
              {appt.status === 'CONFIRMED' && new Date(appt.startsAt).getTime() > Date.now() && (
                <button
                  className="ls-btn"
                  style={{ alignSelf: 'flex-start', background: 'transparent', color: '#c0392b', border: '1.5px solid #c0392b' }}
                  disabled={busy}
                  onClick={cancel}
                >
                  {t3('Cancel this appointment', '取消這筆預約', 'Cancelar esta cita')}
                </button>
              )}
              {appt.status === 'CANCELED' && (
                <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>
                  {t3('Your appointment has been canceled.', '你的預約已取消。', 'Tu cita ha sido cancelada.')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StaffChip({ active, onClick, label, sub, photo }: { active: boolean; onClick: () => void; label: string; sub?: string; photo?: string | null }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: sub ? '7px 16px' : '8px 16px',
        borderRadius: sub ? 12 : 999,
        fontSize: 13.5,
        fontWeight: 600,
        cursor: 'pointer',
        textAlign: 'left',
        background: active ? 'var(--c-primary)' : 'var(--c-surface)',
        color: active ? 'var(--c-primary-fg)' : 'var(--c-text)',
        border: `1px solid ${active ? 'var(--c-primary)' : 'var(--c-border)'}`,
        display: 'flex',
        alignItems: 'center',
        gap: photo ? 9 : 0,
      }}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 28, height: 28, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
      )}
      <span>
        {label}
        {sub && (
          <span style={{ display: 'block', fontSize: 11, fontWeight: 500, opacity: 0.75, marginTop: 1 }}>{sub}</span>
        )}
      </span>
    </button>
  );
}

/* ── class schedule ── */

interface Occurrence {
  sessionId: string;
  name: string;
  instructor: string;
  level?: string;
  dateKey: string;
  time: string;
  capacity: number;
  enrolled: number;
}

/* emit 端烘進來的種子課表(週幾+時刻,無日期)。純靜態匯出沒有 /classes
   API,這是課表僅有的資料;有 DB 的站在 fetch 成功後換成即時版。 */
interface ClassSeedRow {
  name: string;
  instructor: string;
  weekday: number; // 0=Sun … 6=Sat
  start: string; // "09:00"
  durationMin: number;
  capacity: number;
  level?: string;
}

const WEEKDAY_NAMES: Record<string, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  zh: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
};
/* 週一開頭:課表是「一週的節奏」,不是日曆。 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function RtClassSchedule({ initialData, className, style }: Sty & { initialData?: ClassSeedRow[] }) {
  const { lang } = useSiteLang();
  const [occ, setOcc] = useState<Occurrence[]>([]);
  const [signup, setSignup] = useState<Occurrence | null>(null);
  const [instructor, setInstructor] = useState('all');
  const [level, setLevel] = useState('all');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [modalErr, setModalErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiGet<{ occurrences: Occurrence[] }>('/classes')
      .then((r) => setOcc(r.occurrences))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);
  /* API 還沒回(或根本沒有 API)時,種子課表就是課表 —— 靜態預渲染必須
     有內容,「標題下面一片空」曾經就這樣出貨。篩選條列同時餵兩種來源。 */
  const seedRows = occ.length === 0 ? (initialData ?? []) : [];
  const instructors = [...new Set(occ.length ? occ.map((o) => o.instructor) : seedRows.map((s) => s.instructor))];
  const levels = [
    ...new Set((occ.length ? occ.map((o) => o.level ?? '') : seedRows.map((s) => s.level ?? '')).filter(Boolean)),
  ];
  const chip = (active: boolean): CSSProperties => ({
    padding: '5px 13px',
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? 'var(--c-primary)' : 'var(--c-surface)',
    color: active ? 'var(--c-primary-fg)' : 'var(--c-text)',
    border: `1px solid ${active ? 'var(--c-primary)' : 'var(--c-border)'}`,
  });

  const shownOcc = occ.filter(
    (o) => (instructor === 'all' || o.instructor === instructor) && (level === 'all' || o.level === level),
  );
  const byDay = new Map<string, Occurrence[]>();
  for (const o of shownOcc) {
    byDay.set(o.dateKey, [...(byDay.get(o.dateKey) ?? []), o]);
  }

  async function enroll() {
    if (!signup) return;
    // an empty required field must say so, never silently no-op
    if (!name.trim() || !phone.trim()) {
      setModalErr(t3('Enter your name and phone.', '請填寫姓名與電話。', 'Ingresa tu nombre y teléfono.'));
      return;
    }
    setBusy(true);
    setModalErr('');
    try {
      await apiPost('/classes/enroll', { sessionId: signup.sessionId, dateKey: signup.dateKey, name, phone });
      setMsg(lang === 'es' ? '¡Estás dentro!' : lang === 'zh' ? '報名成功！' : 'You are in!');
      setSignup(null);
      void load();
    } catch (err) {
      // the failure must render INSIDE the modal — the section banner sits
      // behind the fixed backdrop and is invisible while the modal is open
      setModalErr(err instanceof Error ? err.message : 'Failed');
      void load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className} style={style}>
      {msg && (
        <div className="ls-card" style={{ padding: 12, marginBottom: 14, fontSize: 14, color: 'var(--c-primary)', fontWeight: 600 }}>
          {msg}
        </div>
      )}
      {(instructors.length > 1 || levels.length > 1) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          {instructors.length > 1 && (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{t3('Instructor:', '老師：', 'Instructor:')}</span>
              <button style={chip(instructor === 'all')} onClick={() => setInstructor('all')}>{t3('All', '全部', 'Todos')}</button>
              {instructors.map((i) => (
                <button key={i} style={chip(instructor === i)} onClick={() => setInstructor(i)}>{i}</button>
              ))}
            </>
          )}
          {levels.length > 1 && (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)', marginLeft: instructors.length > 1 ? 10 : 0 }}>{t3('Level:', '強度：', 'Nivel:')}</span>
              <button style={chip(level === 'all')} onClick={() => setLevel('all')}>{t3('All', '全部', 'Todos')}</button>
              {levels.map((l) => (
                <button key={l} style={chip(level === l)} onClick={() => setLevel(l)}>{l}</button>
              ))}
            </>
          )}
        </div>
      )}
      {seedRows.length > 0 && (
        /* 種子週課表:欄標是「週幾」不是日期 —— 烘日期會 hydration mismatch
           (本檔開頭的教訓)。報名要 sessionId/dateKey,只有即時版有,所以
           這裡是純資訊卡。 */
        <div className="grid gap-3 md:grid-cols-4 max-md:grid-cols-2">
          {WEEK_ORDER.filter((d) =>
            seedRows.some(
              (s) => s.weekday === d && (instructor === 'all' || s.instructor === instructor) && (level === 'all' || s.level === level),
            ),
          ).map((d) => (
            <div key={d}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-muted)', marginBottom: 8 }}>
                {(WEEKDAY_NAMES[lang] ?? WEEKDAY_NAMES.en)[d]}
              </div>
              {seedRows
                .filter((s) => s.weekday === d && (instructor === 'all' || s.instructor === instructor) && (level === 'all' || s.level === level))
                .map((s, i) => (
                  <div
                    key={`${s.name}-${s.start}-${i}`}
                    className="ls-card"
                    style={{ width: '100%', padding: 12, marginBottom: 8, textAlign: 'left', borderLeft: '3px solid var(--c-primary)', color: 'var(--c-text)' }}
                  >
                    <strong style={{ display: 'block', fontSize: 13.5 }}>{s.name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                      {s.start} · {s.instructor}
                    </span>
                    {s.level && (
                      <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, marginTop: 5, padding: '1px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)' }}>
                        {s.level}
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 11.5, marginTop: 4, color: 'var(--c-primary)', fontWeight: 700 }}>
                      {s.durationMin} {t3('min', '分鐘', 'min')} · {s.capacity} {t3('spots', '個名額', 'lugares')}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-4 max-md:grid-cols-2">
        {[...byDay.entries()].slice(0, 8).map(([dateKey, list]) => (
          <div key={dateKey}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-muted)', marginBottom: 8 }}>
              {niceDate(dateKey, lang)}
            </div>
            {list.map((o) => {
              const full = o.enrolled >= o.capacity;
              return (
                /* NOT a portal. Each card belongs inside its own day column;
                   wrapping it in BodyPortal teleported every card to the end
                   of <body>, leaving a schedule of bare date headings with
                   nothing under them — which is exactly what a gym owner saw
                   on his own live homepage. BodyPortal is for fixed overlays,
                   and the one on this screen is the sign-up dialog below. */
                <button
                  key={`${o.sessionId}-${o.dateKey}`}
                  disabled={full}
                  onClick={() => {
                    setSignup(o);
                    setModalErr('');
                  }}
                  className="ls-card"
                  style={{ width: '100%', padding: 12, marginBottom: 8, textAlign: 'left', borderLeft: '3px solid var(--c-primary)', cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.55 : 1, color: 'var(--c-text)' }}
                >
                  <strong style={{ display: 'block', fontSize: 13.5 }}>{o.name}</strong>
                  <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                    {o.time} · {o.instructor}
                  </span>
                  {o.level && (
                    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, marginTop: 5, padding: '1px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)' }}>
                      {o.level}
                    </span>
                  )}
                  <span style={{ display: 'block', fontSize: 11.5, marginTop: 4, color: full ? '#c0392b' : 'var(--c-primary)', fontWeight: 700 }}>
                    {full ? (lang === 'es' ? 'Lleno' : lang === 'zh' ? '額滿' : 'Full') : `${o.capacity - o.enrolled} ${lang === 'es' ? 'lugares disponibles' : lang === 'zh' ? '個名額' : 'spots left'}`}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {signup && (
        /* The fixed overlay this file imports BodyPortal for: a transformed
           ancestor (scroll reveal, GSAP) would otherwise trap it in a local
           stacking context and let a later section draw over it. */
        <BodyPortal>
        <div
          onClick={() => setSignup(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="ls-card ls-fade-up" style={{ width: 380, maxWidth: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <strong style={{ fontSize: 16 }}>
              {signup.name} — {niceDate(signup.dateKey, lang)} {signup.time}
            </strong>
            <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} value={name} onChange={(e) => setName(e.target.value)} />
            <input aria-label={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} className="ls-input" placeholder={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} value={phone} onChange={(e) => setPhone(e.target.value)} />
            {modalErr && <div role="alert" style={{ color: '#c0392b', fontSize: 13 }}>{modalErr}</div>}
            <button className="ls-btn" style={{ justifyContent: 'center' }} disabled={busy} onClick={enroll}>
              {busy ? '…' : lang === 'es' ? 'Reservar mi lugar' : lang === 'zh' ? '報名' : 'Reserve my spot'}
            </button>
          </div>
        </div>
        </BodyPortal>
      )}
    </div>
  );
}
