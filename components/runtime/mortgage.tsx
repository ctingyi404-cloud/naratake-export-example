'use client';

/* Monthly payment estimator.

   A US buyer standing in front of a listing is not asking what the price is,
   they are asking what the monthly is. So this shows PITI + HOA — the whole
   outlay that leaves their account — and never the loan payment on its own,
   which is the number that makes a house look affordable and then is not.

   It is an ESTIMATE and the page says so, in the page: nothing here is a loan
   offer, a rate quote or a pre-approval, and the interest rate is a figure the
   visitor types, never one this site claims to have available. The arithmetic
   lives in @/lib/mortgage (golden cases in test/mortgage.test.ts) and is
   carried verbatim by the canvas twin in
   packages/components/src/defs/business-commerce.tsx. */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { money } from '@/lib/money';
import { downFromPercent, downPercentFor, estimateMonthly } from '@/lib/mortgage';
import { useSiteLang } from '@/lib/site-i18n';

type Sty = { className?: string; style?: CSSProperties };

/** a typed figure: an emptied box is 0, junk is NaN, and @/lib/mortgage floors
    both — nothing downstream ever multiplies a NaN into the total */
const n = (s: string) => Number(s);
const asDollars = (c: number) => String(c / 100);

export function RtMortgageCalc({
  heading,
  headingZh,
  price = 485000,
  downPercent = 20,
  termYears = 30,
  ratePercent = 6.5,
  taxRatePercent = 1.8,
  insuranceYear = 1800,
  hoaMonth = 0,
  className,
  style,
}: Sty & {
  heading: string;
  headingZh?: string | null;
  price?: number;
  downPercent?: number;
  /** 30 or 15 — a number in the defaults, the select's string once edited */
  termYears?: number | string;
  ratePercent?: number;
  taxRatePercent?: number;
  insuranceYear?: number;
  hoaMonth?: number;
}) {
  const { lang, pick } = useSiteLang();
  const t3 = (en: string, zh: string, es: string) => (lang === 'es' ? es : lang === 'zh' ? zh : en);

  const [priceIn, setPriceIn] = useState(String(price));
  const [downIn, setDownIn] = useState(asDollars(downFromPercent(Math.round(price * 100), downPercent)));
  const [termIn, setTermIn] = useState(String(termYears));
  const [rateIn, setRateIn] = useState(String(ratePercent));
  const [taxIn, setTaxIn] = useState(String(taxRatePercent));
  const [insIn, setInsIn] = useState(String(insuranceYear));
  const [hoaIn, setHoaIn] = useState(String(hoaMonth));

  const priceCents = Math.round(n(priceIn) * 100);
  const downCents = Math.round(n(downIn) * 100);
  const pct = downPercentFor(priceCents, downCents);
  // the term is a two-option select, so this is 30 or 15 and nothing else
  const years = n(termIn);
  const est = estimateMonthly({
    priceCents,
    downCents,
    rateBp: n(rateIn) * 100,
    termYears: n(termIn),
    taxRateBp: n(taxIn) * 100,
    insuranceCentsYear: Math.round(n(insIn) * 100),
    hoaCentsMonth: Math.round(n(hoaIn) * 100),
  });

  /* the percentage is what a buyer holds fixed while they shop up and down the
     price range, so the dollars follow the price rather than the other way */
  const onPrice = (v: string) => {
    setDownIn(asDollars(downFromPercent(Math.round(n(v) * 100), pct)));
    setPriceIn(v);
  };

  const unit: CSSProperties = { color: 'var(--c-text-muted)', fontSize: 14, fontWeight: 600 };
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 };
  const line: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 };

  const field = (label: string, control: ReactNode) => (
    <div>
      <span className="ls-label">{label}</span>
      <span style={row}>{control}</span>
    </div>
  );
  const num = (label: string, value: string, set: (v: string) => void, step: number) => (
    <input
      className="ls-input"
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      style={{ minWidth: 0 }}
    />
  );

  const L = {
    price: t3('Home price', '房屋總價', 'Precio de la casa'),
    down: t3('Down payment', '頭期款', 'Pago inicial'),
    term: t3('Loan term', '貸款年期', 'Plazo del préstamo'),
    rate: t3('Interest rate', '利率', 'Tasa de interés'),
    tax: t3('Property tax a year', '房屋稅（每年）', 'Impuesto predial al año'),
    ins: t3('Insurance a year', '房屋保險（每年）', 'Seguro al año'),
    hoa: t3('HOA a month', '社區管理費（每月）', 'Cuota HOA al mes'),
  };

  return (
    <div className={`ls-card ${className ?? ''}`} style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      <strong className="font-heading" style={{ fontSize: 19 }}>{pick(heading, headingZh)}</strong>

      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        {field(
          L.price,
          <>
            <span style={unit}>$</span>
            {num(L.price, priceIn, onPrice, 1000)}
          </>,
        )}
        {field(
          L.down,
          <>
            <span style={unit}>$</span>
            {num(L.down, downIn, setDownIn, 1000)}
            {num(L.down, String(pct), (v) => setDownIn(asDollars(downFromPercent(priceCents, n(v)))), 0.5)}
            <span style={unit}>%</span>
          </>,
        )}
        {field(
          L.term,
          <select className="ls-input" aria-label={L.term} value={termIn} onChange={(e) => setTermIn(e.target.value)}>
            <option value="30">{t3('30-year fixed', '30 年固定利率', '30 años a tasa fija')}</option>
            <option value="15">{t3('15-year fixed', '15 年固定利率', '15 años a tasa fija')}</option>
          </select>,
        )}
        {field(
          L.rate,
          <>
            {num(L.rate, rateIn, setRateIn, 0.125)}
            <span style={unit}>%</span>
          </>,
        )}
        {field(
          L.tax,
          <>
            {num(L.tax, taxIn, setTaxIn, 0.1)}
            <span style={unit}>%</span>
          </>,
        )}
        {field(
          L.ins,
          <>
            <span style={unit}>$</span>
            {num(L.ins, insIn, setInsIn, 100)}
          </>,
        )}
        {field(
          L.hoa,
          <>
            <span style={unit}>$</span>
            {num(L.hoa, hoaIn, setHoaIn, 25)}
          </>,
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="ls-label" style={{ margin: 0 }}>
          {t3('Estimated monthly payment', '每月預估支出', 'Pago mensual estimado')}
        </span>
        <strong className="font-heading" style={{ fontSize: 42, lineHeight: 1.05, color: 'var(--c-primary)' }}>
          {money(est.monthlyTotalCents)}
        </strong>
        <div style={line}>
          <span>{t3('Principal & interest', '本金與利息', 'Capital e intereses')}</span>
          <span style={{ fontWeight: 700 }}>{money(est.principalInterestCents)}</span>
        </div>
        <div style={line}>
          <span>{t3('Property tax', '房屋稅', 'Impuesto predial')}</span>
          <span style={{ fontWeight: 700 }}>{money(est.taxCents)}</span>
        </div>
        <div style={line}>
          <span>{t3('Homeowners insurance', '房屋保險', 'Seguro de vivienda')}</span>
          <span style={{ fontWeight: 700 }}>{money(est.insuranceCents)}</span>
        </div>
        {est.hoaCents > 0 && (
          <div style={line}>
            <span>{t3('HOA dues', '社區管理費', 'Cuota HOA')}</span>
            <span style={{ fontWeight: 700 }}>{money(est.hoaCents)}</span>
          </div>
        )}
        <div style={{ ...line, color: 'var(--c-text-muted)', fontSize: 13 }}>
          <span>{t3('Loan amount', '貸款金額', 'Monto del préstamo')}</span>
          <span>{money(est.loanCents)}</span>
        </div>
        <div style={{ ...line, color: 'var(--c-text-muted)', fontSize: 13 }}>
          <span>{t3(`Interest over ${years} years`, `${years} 年利息總額`, `Intereses en ${years} años`)}</span>
          <span>{money(est.totalInterestCents)}</span>
        </div>
      </div>

      {/* Not editable copy, and not a comment: a calculator that looks like a
          lender is the one way this component can hurt somebody. */}
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--c-text-muted)' }}>
        {t3(
          'Estimate only. This is not a loan offer, a rate quote or a pre-approval, and the rate above is one you entered yourself. Your actual rate, taxes, insurance and eligibility come from a lender.',
          '僅供估算。這不是貸款要約、利率報價或預先核准，上方利率由你自行填寫。實際利率、稅金、保費與貸款資格以貸款機構核定為準。',
          'Solo una estimación. No es una oferta de préstamo, una cotización de tasa ni una preaprobación, y la tasa de arriba es la que usted introdujo. Su tasa, impuestos, seguro y elegibilidad reales los determina un prestamista.',
        )}
      </p>
    </div>
  );
}
