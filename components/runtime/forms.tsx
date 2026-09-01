'use client';

/* Forms: generic FormBox fields, contact form, newsletter, quote requests. */

import { useEffect, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import { useSiteLang } from '@/lib/site-i18n';
import { trackConversion } from '@/lib/track';
import { ctaZh } from '@/lib/cta-i18n';

type Sty = { className?: string; style?: CSSProperties };

/* twin of optionPairs in packages/components/src/defs/forms.tsx — the zh list is
   matched BY INDEX, and the <option value> stays the English token so switching
   language never changes what lands in the merchant's inbox. */
function optionPairs(options: unknown, optionsZh: unknown): { v: string; zh?: string }[] {
  const zh = String(optionsZh ?? '')
    .split(',')
    .map((o) => o.trim());
  return String(options ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((v, i) => ({ v, zh: zh[i] || undefined }));
}

async function uploadFiles(files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files.slice(0, 5)) {
    const fd = new FormData();
    fd.append('file', f);
    // public quote uploads go through the same media endpoint unauthenticated?
    // No — quotes attach as admin-visible submissions; use a public-safe route:
    const res = await fetch('/api/v1/forms/upload', { method: 'POST', body: fd });
    // a dropped upload must not fail silently — throw so the caller's catch shows
    // the error instead of submitting a quote request with missing photos
    if (!res.ok) throw new Error('upload failed');
    const data = (await res.json()) as { url: string };
    urls.push(data.url);
  }
  return urls;
}

/* generic FormBox: collects child field values and posts to /forms */
export function RtFormBox({
  submitTo = 'contact',
  successMessage,
  successMessageZh,
  className,
  style,
  children,
}: Sty & { submitTo?: string; successMessage?: string; successMessageZh?: string | null; children?: ReactNode }) {
  const { lang, pick } = useSiteLang();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const fd = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {};
    fd.forEach((v, k) => (data[k] = v));
    // the honeypot must travel TOP-LEVEL — the server checks body.website, so a
    // value buried in meta would let every bot submission through
    const website = String(data.website ?? '');
    delete data.website;
    try {
      await apiPost('/forms', {
        kind: submitTo === 'newsletter' ? 'newsletter' : submitTo === 'quote' ? 'quote' : 'contact',
        name: String(data.name ?? ''),
        email: String(data.email ?? ''),
        phone: String(data.phone ?? data.tel ?? ''),
        message: String(data.message ?? ''),
        meta: data,
        website,
      });
      trackConversion('lead', { label: submitTo ?? 'contact' });
      setSent(true);
    } catch {
      // never swallow a failed lead — tell the customer so they can retry (a silent
      // failure means the merchant loses the lead with no trace)
      setErr(lang === 'es' ? 'No se pudo enviar. Inténtalo de nuevo.' : lang === 'zh' ? '送出失敗,請再試一次。' : "Couldn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={`ls-card ls-fade-up ${className ?? ''}`} style={{ padding: 24, ...style }}>
        <strong style={{ color: 'var(--c-primary)' }}>✓ </strong>
        {pick(successMessage, successMessageZh) || (lang === 'es' ? 'Enviado. Te responderemos pronto.' : lang === 'zh' ? '已送出，我們會盡快回覆。' : 'Sent. We will get back to you soon.')}
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className={className} style={style}>
      {/* fieldset actually WRAPS the fields so `disabled={busy}` gates them and
          blocks double-submit (display:contents keeps the layout unchanged) */}
      <fieldset disabled={busy} style={{ display: 'contents', border: 'none', margin: 0, padding: 0, minInlineSize: 'auto' }}>
        {children}
      </fieldset>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden />
      {err && <p role="alert" style={{ margin: '10px 0 0', color: '#c0392b', fontSize: 14 }}>{err}</p>}
    </form>
  );
}

export function RtInputField({
  label,
  labelZh,
  name,
  type = 'text',
  required,
  placeholder,
  placeholderZh,
  className,
  style,
}: Sty & { label: string; labelZh?: string | null; name: string; type?: string; required?: boolean; placeholder?: string; placeholderZh?: string | null }) {
  const { pick } = useSiteLang();
  return (
    <label className={className} style={{ display: 'block', ...style }}>
      <span className="ls-label">
        {pick(label, labelZh)}
        {required && <span style={{ color: '#c0392b' }}> *</span>}
      </span>
      <input className="ls-input" name={name} type={type} required={required} placeholder={pick(placeholder, placeholderZh)} />
    </label>
  );
}

export function RtTextareaField({
  label,
  labelZh,
  name,
  rows = 4,
  required,
  className,
  style,
}: Sty & { label: string; labelZh?: string | null; name: string; rows?: number; required?: boolean }) {
  const { pick } = useSiteLang();
  return (
    <label className={className} style={{ display: 'block', ...style }}>
      <span className="ls-label">
        {pick(label, labelZh)}
        {required && <span style={{ color: '#c0392b' }}> *</span>}
      </span>
      <textarea className="ls-input" name={name} rows={rows} required={required} style={{ resize: 'vertical' }} />
    </label>
  );
}

export function RtSelectField({
  label,
  labelZh,
  name,
  options,
  optionsZh,
  className,
  style,
}: Sty & { label: string; labelZh?: string | null; name: string; options: string; optionsZh?: string | null }) {
  const { pick } = useSiteLang();
  return (
    <label className={className} style={{ display: 'block', ...style }}>
      <span className="ls-label">{pick(label, labelZh)}</span>
      <select className="ls-input" name={name}>
        {optionPairs(options, optionsZh).map((o) => (
          <option key={o.v} value={o.v}>
            {pick(o.v, o.zh)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RtCheckboxField({ label, labelZh, name, className, style }: Sty & { label: string; labelZh?: string | null; name: string }) {
  const { pick } = useSiteLang();
  return (
    <label className={className} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, ...style }}>
      <input type="checkbox" name={name} style={{ width: 16, height: 16 }} />
      {pick(label, labelZh)}
    </label>
  );
}

export function RtDateField({ label, labelZh, name, required, className, style }: Sty & { label: string; labelZh?: string | null; name: string; required?: boolean }) {
  const { pick } = useSiteLang();
  return (
    <label className={className} style={{ display: 'block', ...style }}>
      <span className="ls-label">
        {pick(label, labelZh)}
        {required && <span style={{ color: '#c0392b' }}> *</span>}
      </span>
      <input className="ls-input" type="date" name={name} required={required} />
    </label>
  );
}

/** Nearest ancestor that actually contains form fields (for loose forms not
    wrapped in a FormBox). */
function formScope(btn: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = btn.parentElement;
  for (let i = 0; i < 6 && el; i++) {
    if (el.querySelector('input:not([name="website"]), textarea, select')) return el;
    el = el.parentElement;
  }
  return btn.parentElement;
}

export function RtSubmitButton({ label, labelZh, className, style }: Sty & { label: string; labelZh?: string | null }) {
  const { lang, pick } = useSiteLang();
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'err'>('idle');

  async function onClick(e: MouseEvent<HTMLButtonElement>) {
    const btn = e.currentTarget;
    // Inside a FormBox <form>? Let the native submit fire — FormBox handles it.
    if (btn.closest('form')) return;
    // Loose form (fields + this button dropped into a section): collect and post
    // ourselves so a hand-composed form actually reaches the admin inbox.
    e.preventDefault();
    const scope = formScope(btn);
    if (!scope) return;
    const els = scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    const data: Record<string, string> = {};
    let firstText = '';
    els.forEach((el) => {
      if ((el as HTMLInputElement).type === 'submit' || (el as HTMLInputElement).type === 'button' || el.name === 'website') return;
      const key = el.name || el.getAttribute('placeholder') || '';
      if (key) data[key] = el.value;
      if (el.tagName === 'TEXTAREA' && !firstText) firstText = el.value;
    });
    setState('busy');
    try {
      await apiPost('/forms', {
        kind: 'contact',
        name: data.name ?? '',
        email: data.email ?? '',
        phone: data.phone ?? data.tel ?? '',
        message: data.message ?? firstText ?? '',
        meta: data,
      });
      trackConversion('lead', { label: 'contact' });
      setState('sent');
      els.forEach((el) => {
        const t = (el as HTMLInputElement).type;
        if (t !== 'submit' && t !== 'button') el.value = '';
      });
    } catch {
      // a swallowed failure here loses a lead — the visitor must SEE it failed
      setState('err');
    }
  }

  if (state === 'sent') {
    return (
      <div className="ls-fade-up" style={{ color: 'var(--c-primary)', fontWeight: 600, alignSelf: 'flex-start', ...style }}>
        ✓ {lang === 'es' ? 'Enviado. Te responderemos pronto.' : lang === 'zh' ? '已送出，我們會盡快回覆。' : 'Sent. We will get back to you soon.'}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'flex-start' }}>
      <button
        type="submit"
        onClick={onClick}
        disabled={state === 'busy'}
        className={`ls-btn ${className ?? ''}`}
        style={{ alignSelf: 'flex-start', ...style }}
      >
        {pick(label, ctaZh(label, labelZh))}
      </button>
      {state === 'err' && (
        <span role="alert" style={{ color: '#d33', fontSize: 13.5 }}>
          {lang === 'es' ? 'No se pudo enviar. Inténtalo de nuevo o llámanos.' : lang === 'zh' ? '送出失敗，請再試一次或直接來電。' : 'Could not send. Please try again or call us.'}
        </span>
      )}
    </div>
  );
}

/* prebuilt contact form */
export function RtContactForm({
  heading,
  headingZh,
  buttonLabel,
  buttonLabelZh,
  className,
  style,
}: Sty & { heading: string; headingZh?: string | null; buttonLabel: string; buttonLabelZh?: string | null }) {
  const { lang, pick } = useSiteLang();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (fd.get('website')) return;
    setBusy(true);
    setErr('');
    try {
      await apiPost('/forms', {
        kind: 'contact',
        name: String(fd.get('name') ?? ''),
        email: String(fd.get('email') ?? ''),
        phone: String(fd.get('phone') ?? ''),
        message: String(fd.get('message') ?? ''),
      });
      trackConversion('lead', { label: 'contact' });
      setSent(true);
    } catch {
      setErr(lang === 'es' ? 'No se pudo enviar. Inténtalo de nuevo.' : lang === 'zh' ? '送出失敗,請再試一次。' : "Couldn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={`ls-card ${className ?? ''}`} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
      <strong className="font-heading" style={{ fontSize: 19 }}>{pick(heading, headingZh)}</strong>
      {err && <p role="alert" style={{ margin: 0, color: '#c0392b', fontSize: 14 }}>{err}</p>}
      {sent ? (
        <p className="ls-fade-up" style={{ margin: 0, color: 'var(--c-primary)', fontWeight: 600 }}>
          ✓ {lang === 'es' ? 'Enviado. Respondemos en un día hábil.' : lang === 'zh' ? '已送出，我們一個工作天內回覆。' : 'Sent. We reply within one business day.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" name="name" required placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} />
            <input aria-label={lang === 'es' ? 'Teléfono' : lang === 'zh' ? '電話' : 'Phone'} className="ls-input" name="phone" placeholder={lang === 'es' ? 'Teléfono' : lang === 'zh' ? '電話' : 'Phone'} />
          </div>
          <input aria-label="Email *" className="ls-input" name="email" type="email" required placeholder="Email *" />
          <textarea aria-label={lang === 'es' ? 'Mensaje *' : lang === 'zh' ? '訊息 *' : 'Message *'} className="ls-input" name="message" rows={4} required placeholder={lang === 'es' ? 'Mensaje *' : lang === 'zh' ? '訊息 *' : 'Message *'} style={{ resize: 'vertical' }} />
          <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden />
          <button className="ls-btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>
            {busy ? '…' : pick(buttonLabel, ctaZh(buttonLabel, buttonLabelZh))}
          </button>
        </>
      )}
    </form>
  );
}

export function RtNewsletterSignup({
  heading,
  headingZh,
  sub,
  subZh,
  buttonLabel,
  buttonLabelZh,
  className,
  style,
}: Sty & {
  heading: string; headingZh?: string | null; sub: string; subZh?: string | null;
  buttonLabel: string; buttonLabelZh?: string | null;
}) {
  const { lang, pick } = useSiteLang();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'err'>('idle');
  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 30, textAlign: 'center', ...style }}>
      <strong className="font-heading" style={{ fontSize: 20 }}>{pick(heading, headingZh)}</strong>
      <p style={{ margin: '8px 0 18px', color: 'var(--c-text-muted)', fontSize: 14 }}>{pick(sub, subZh)}</p>
      {state === 'sent' ? (
        <p className="ls-fade-up" style={{ margin: 0, color: 'var(--c-primary)', fontWeight: 600 }}>
          ✓ {lang === 'es' ? '¡Ya estás en la lista!' : lang === 'zh' ? '訂閱成功！' : 'You are on the list!'}
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setState('busy');
            try {
              await apiPost('/forms', { kind: 'newsletter', email });
              setState('sent');
            } catch {
              setState('err'); // a silent failure here quietly loses a subscriber
            }
          }}
          className="flex gap-2 max-md:flex-col"
          style={{ maxWidth: 420, margin: '0 auto' }}
        >
          <input aria-label="you@email.com" className="ls-input" style={{ flex: 1 }} type="email" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="ls-btn" disabled={state === 'busy'}>{pick(buttonLabel, ctaZh(buttonLabel, buttonLabelZh))}</button>
          {state === 'err' && (
            <span role="alert" style={{ color: '#d33', fontSize: 13.5, alignSelf: 'center' }}>
              {lang === 'es' ? 'No se pudo suscribir. Inténtalo de nuevo.' : lang === 'zh' ? '訂閱失敗，請再試一次。' : 'Could not subscribe. Please try again.'}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

export function RtQuoteRequestForm({
  heading,
  headingZh,
  detailLabel,
  detailLabelZh,
  vehicle = false,
  estimator = false,
  className,
  style,
}: Sty & {
  heading: string; headingZh?: string | null; detailLabel: string; detailLabelZh?: string | null;
  vehicle?: boolean; estimator?: boolean;
}) {
  const { lang, pick } = useSiteLang();
  const [files, setFiles] = useState<File[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // customers pick what they need instead of describing from scratch —
  // options come from the business's own service catalog when it has one
  const [serviceOptions, setServiceOptions] = useState<string[]>([]);
  const [beds, setBeds] = useState(2);
  const [baths, setBaths] = useState(1);
  const [freq, setFreq] = useState<'once' | 'weekly' | 'biweekly' | 'monthly'>('once');

  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);

  useEffect(() => {
    apiGet<{ categories: { items: { name: string }[] }[] }>('/appointments/services')
      .then((r) => setServiceOptions(r.categories.flatMap((c) => c.items.map((it) => it.name))))
      .catch(() => {});
  }, []);

  // ballpark cleaning estimate — the merchant's written quote is authoritative
  const FREQ_LABELS: Record<typeof freq, [string, string, string, number]> = {
    once: ['One-time deep clean', '單次深度清潔', 'Limpieza única', 1],
    weekly: ['Weekly', '每週', 'Semanal', 0.8],
    biweekly: ['Every 2 weeks', '每兩週', 'Quincenal', 0.85],
    monthly: ['Monthly', '每月', 'Mensual', 0.9],
  };
  const estBase = (80 + beds * 30 + baths * 25) * FREQ_LABELS[freq][3];
  const estLo = Math.round(estBase * 0.9);
  const estHi = Math.round(estBase * 1.2);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = e.currentTarget instanceof HTMLFormElement ? new FormData(e.currentTarget) : new FormData();
    if (fd.get('website')) return;
    setBusy(true);
    setErr('');
    try {
      const photoUrls = files.length ? await uploadFiles(files) : [];
      // structured selections travel inside the message so the admin inbox
      // shows them without any special rendering, plus meta for tooling
      const serviceType = String(fd.get('serviceType') ?? '');
      const veh = vehicle
        ? [String(fd.get('vehicleYear') ?? ''), String(fd.get('vehicleMake') ?? ''), String(fd.get('vehicleModel') ?? '')].filter(Boolean).join(' ')
        : '';
      const est = estimator ? `${beds} bd / ${baths} ba / ${FREQ_LABELS[freq][0]} ≈ $${estLo}–$${estHi}` : '';
      const prefix = [
        serviceType && `[Service] ${serviceType}`,
        veh && `[Vehicle] ${veh}`,
        est && `[Estimate] ${est}`,
      ]
        .filter(Boolean)
        .join('\n');
      const message = String(fd.get('message') ?? '');
      const res = await apiPost<{ code: string }>('/forms', {
        kind: 'quote',
        name: String(fd.get('name') ?? ''),
        email: String(fd.get('email') ?? ''),
        phone: String(fd.get('phone') ?? ''),
        message: prefix ? `${prefix}\n${message}` : message,
        meta: { photos: photoUrls, serviceType: serviceType || undefined, vehicle: veh || undefined, estimate: est || undefined },
      });
      setSent(res.code);
    } catch {
      setErr(lang === 'es' ? 'No se pudo enviar. Inténtalo de nuevo.' : lang === 'zh' ? '送出失敗,請再試一次。' : "Couldn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={`ls-card ls-fade-up ${className ?? ''}`} style={{ padding: 32, ...style }}>
        <strong className="font-heading" style={{ fontSize: 20, display: 'block', marginBottom: 8 }}>
          ✓ {lang === 'es' ? 'Solicitud de presupuesto enviada' : lang === 'zh' ? '報價請求已送出' : 'Quote request sent'}
        </strong>
        <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14.5 }}>
          {lang === 'es' ? 'Referencia' : lang === 'zh' ? '追蹤編號' : 'Reference'}: <strong style={{ color: 'var(--c-primary)' }}>{sent}</strong>.{' '}
          {lang === 'es' ? 'Normalmente enviamos un presupuesto por escrito en 2 horas hábiles.' : lang === 'zh' ? '我們通常在 2 個工作小時內回覆估價。' : 'We usually reply with a written estimate within 2 business hours.'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`ls-card ${className ?? ''}`} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
      <strong className="font-heading" style={{ fontSize: 19 }}>{pick(heading, headingZh)}</strong>
      {err && <p role="alert" style={{ margin: 0, color: '#c0392b', fontSize: 14 }}>{err}</p>}
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <input aria-label={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} className="ls-input" name="name" required placeholder={lang === 'es' ? 'Nombre *' : lang === 'zh' ? '姓名 *' : 'Name *'} />
        <input aria-label={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} className="ls-input" name="phone" required placeholder={lang === 'es' ? 'Teléfono *' : lang === 'zh' ? '電話 *' : 'Phone *'} />
      </div>
      <input aria-label="Email" className="ls-input" name="email" type="email" placeholder="Email" />
      {serviceOptions.length > 0 && (
        <label>
          <span className="ls-label">{t3('What do you need?', '需要什麼服務？', '¿Qué necesitas?')}</span>
          <select className="ls-input" name="serviceType" defaultValue="">
            <option value="">{t3('Choose a service…', '選擇服務…', 'Elige un servicio…')}</option>
            {serviceOptions.map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option>{t3('Something else', '其他', 'Otra cosa')}</option>
          </select>
        </label>
      )}
      {vehicle && (
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <input aria-label={t3('Vehicle year', '車輛年份', 'Año del vehículo')} className="ls-input" name="vehicleYear" placeholder={t3('Year (2018)', '年份（2018）', 'Año (2018)')} />
          <input aria-label={t3('Make', '廠牌', 'Marca')} className="ls-input" name="vehicleMake" placeholder={t3('Make (Toyota)', '廠牌（Toyota）', 'Marca (Toyota)')} />
          <input aria-label={t3('Model', '車型', 'Modelo')} className="ls-input" name="vehicleModel" placeholder={t3('Model (Camry)', '車型（Camry）', 'Modelo (Camry)')} />
        </div>
      )}
      {estimator && (
        <div className="ls-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="ls-label" style={{ margin: 0 }}>{t3('Quick estimate', '快速估價', 'Estimación rápida')}</span>
          <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
            <select aria-label={t3('Bedrooms', '房間數', 'Habitaciones')} className="ls-input" value={beds} onChange={(e) => setBeds(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n} {t3('bedrooms', '房', 'hab.')}</option>
              ))}
            </select>
            <select aria-label={t3('Bathrooms', '衛浴數', 'Baños')} className="ls-input" value={baths} onChange={(e) => setBaths(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} {t3('bathrooms', '衛浴', 'baños')}</option>
              ))}
            </select>
            <select aria-label={t3('Frequency', '頻率', 'Frecuencia')} className="ls-input" value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)}>
              {(Object.keys(FREQ_LABELS) as (typeof freq)[]).map((k) => (
                <option key={k} value={k}>{t3(FREQ_LABELS[k][0], FREQ_LABELS[k][1], FREQ_LABELS[k][2])}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-primary)' }}>
            ≈ ${estLo} – ${estHi}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginLeft: 8 }}>
              {t3('ballpark, we confirm with a written quote', '僅供參考，以書面報價為準', 'aproximado, confirmamos con presupuesto escrito')}
            </span>
          </div>
        </div>
      )}
      <label>
        <span className="ls-label">{pick(detailLabel, detailLabelZh)}</span>
        <textarea className="ls-input" name="message" rows={4} required style={{ resize: 'vertical' }} />
      </label>
      <label
        className="ls-dropzone"
        style={{
          border: '2px dashed var(--c-border)',
          borderRadius: 'var(--r-md)',
          padding: 20,
          textAlign: 'center',
          color: 'var(--c-text-muted)',
          fontSize: 13.5,
          cursor: 'pointer',
        }}
      >
        {files.length > 0
          ? `${files.length} ${lang === 'es' ? 'foto(s) adjuntas' : lang === 'zh' ? '張照片已選擇' : 'photo(s) attached'}`
          : lang === 'zh'
            ? '點擊上傳照片（選填，最多 5 張）'
            : 'Click to attach photos (optional, up to 5)'}
        <input
          type="file"
          accept="image/*"
          multiple
          className="ls-visually-hidden"
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
      </label>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden />
      <button className="ls-btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? '…' : lang === 'es' ? 'Solicitar presupuesto' : lang === 'zh' ? '送出報價請求' : 'Request quote'}
      </button>
    </form>
  );
}
