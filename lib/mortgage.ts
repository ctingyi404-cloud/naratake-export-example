/* Pure money math for a monthly-payment estimate — no DB, no I/O, fully
   unit-testable. components/runtime/mortgage.tsx collects what a buyer types
   and calls estimateMonthly() with plain numbers; the editor canvas twin in
   packages/components/src/defs/business-commerce.tsx carries this arithmetic
   verbatim, because a canvas that quotes a different monthly than the exported
   site is the one bug this component cannot afford. Golden cases live in
   test/mortgage.test.ts.

   Money is integer cents and rates are basis points, the same discipline as
   quote-calc.ts: a payment is a figure a buyer will hold against a lender's
   letter, not a float. Nothing here is an offer — see the component. */

import { taxOn } from './money';

export interface MortgageInput {
  /** list price */
  priceCents: number;
  /** cash down; capped at the price, because more than the price is a typo */
  downCents: number;
  /** annual nominal rate in basis points (650 = 6.5%) */
  rateBp: number;
  /** loan length in years — 30 and 15 are what a US buyer is shown */
  termYears: number;
  /** annual property tax as basis points of the price (180 = 1.8%) */
  taxRateBp: number;
  /** annual homeowners premium */
  insuranceCentsYear: number;
  /** monthly HOA / condo dues; 0 for a house that has none */
  hoaCentsMonth: number;
}

export interface MortgageEstimate {
  /** price minus down payment: the amount actually borrowed */
  loanCents: number;
  /** the amortised part of the payment */
  principalInterestCents: number;
  /** the escrowed parts, per month */
  taxCents: number;
  insuranceCents: number;
  hoaCents: number;
  /** PITI + HOA — what leaves the buyer's account each month, which is the
      question they came to the page with */
  monthlyTotalCents: number;
  /** interest paid across the whole term */
  totalInterestCents: number;
  /** down payment as a share of the price, in basis points */
  downRateBp: number;
}

/** Money in, money out. An emptied input reads as NaN and NaN spreads through
    every line of the estimate, so each typed figure is floored at zero first. */
const cents = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** A rate is not money: 6.375% is 637.5 basis points, and rounding it to a
    whole one would quietly reprice the loan. */
const bp = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** At least one month, so a cleared term field cannot divide by zero. */
const monthsOf = (termYears: number) => Math.max(1, Math.round(bp(termYears) * 12));

/* The level monthly payment on a loan, EXACT and unrounded. Callers round it
   for display and multiply it out for a lifetime total; rounding here first
   would compound the same fraction of a cent 360 times. */
function levelPayment(loanCents: number, rateBp: number, months: number): number {
  if (loanCents <= 0) return 0;
  const r = rateBp / 10000 / 12;
  // 0% is a real product (builder buy-downs, family loans) and a real division
  // by zero: with no interest the loan is simply split across the months
  if (r === 0) return loanCents / months;
  const growth = Math.pow(1 + r, months);
  return (loanCents * r * growth) / (growth - 1);
}

/** Principal and interest alone, in whole cents. */
export function monthlyPaymentCents(loanCents: number, rateBp: number, termYears: number): number {
  return Math.round(levelPayment(cents(loanCents), bp(rateBp), monthsOf(termYears)));
}

/** The whole monthly outlay: P&I plus the escrowed taxes, insurance and dues. */
export function estimateMonthly(input: MortgageInput): MortgageEstimate {
  const price = cents(input.priceCents);
  // capping the down payment at the price is what stops a negative principal
  // from turning the amortisation around and paying the buyer interest
  const down = Math.min(price, cents(input.downCents));
  const loan = price - down;
  const months = monthsOf(input.termYears);
  const exact = levelPayment(loan, bp(input.rateBp), months);

  const pi = Math.round(exact);
  // the tax bill is annual and escrowed monthly: one twelfth of the real bill,
  // never a twelfth of the price at a twelfth of the rate
  const tax = Math.round(taxOn(price, bp(input.taxRateBp)) / 12);
  const insurance = Math.round(cents(input.insuranceCentsYear) / 12);
  const hoa = cents(input.hoaCentsMonth);

  return {
    loanCents: loan,
    principalInterestCents: pi,
    taxCents: tax,
    insuranceCents: insurance,
    hoaCents: hoa,
    monthlyTotalCents: pi + tax + insurance + hoa,
    // measured from the UNROUNDED payment, so a 0% loan costs exactly nothing
    // instead of the few cents that 360 rounded payments drift by
    totalInterestCents: Math.max(0, Math.round(exact * months - loan)),
    downRateBp: price > 0 ? Math.round((down * 10000) / price) : 0,
  };
}

/** The dollars a percentage means on this price — the % side of the down
    payment control. */
export function downFromPercent(priceCents: number, percent: number): number {
  const price = cents(priceCents);
  return Math.min(price, Math.round((price * bp(percent)) / 100));
}

/** And back: the percentage a typed dollar amount comes to, to one decimal —
    the precision a listing quotes it in ("20%", "12.5%"). */
export function downPercentFor(priceCents: number, downCents: number): number {
  const price = cents(priceCents);
  if (price === 0) return 0;
  return Math.round((Math.min(price, cents(downCents)) * 1000) / price) / 10;
}
