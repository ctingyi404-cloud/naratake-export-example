/* Pure money math for an order quote — no DB, no I/O, fully unit-testable.
   server/quote.ts resolves the business / items / coupon / gift card from the
   database and then calls computeQuote() with plain records. This is the single
   source of truth for how a total is built; golden cases live in
   test/quote-calc.test.ts. */

import { taxOn } from './money';

export interface QuoteLineInput {
  itemId: string;
  name: string;
  qty: number;
  /** item price + chosen modifier prices, per unit */
  unitCents: number;
  modifiers: { name: string; priceCents: number }[];
  taxable: boolean;
}

export interface CouponRecord {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  active: boolean;
  endsAt: Date | null;
  minSubtotalCents: number | null;
  maxRedemptions: number | null;
  redeemed: number;
}

export interface GiftCardRecord {
  code: string;
  active: boolean;
  balanceCents: number;
}

export interface DeliveryConfig {
  enabled: boolean;
  feeCents: number;
  minCents: number;
  zips: string[];
}

export interface QuoteCtx {
  taxRateBp: number;
  mode: 'pickup' | 'delivery';
  zip?: string;
  tipCents: number;
  delivery: DeliveryConfig | null;
  coupon: CouponRecord | null;
  giftCard: GiftCardRecord | null;
  /** member point redemption; points = the member's balance, null = no member */
  loyalty?: { redeemCents: number; points: number | null } | null;
  now?: Date; // injectable for deterministic expiry tests
}

export interface ComputedQuote {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  feeCents: number;
  tipCents: number;
  giftAppliedCents: number;
  /** loyalty points applied as tender after the gift card (500 cents = 100 points) */
  loyaltyAppliedCents: number;
  totalCents: number;
  couponCode?: string;
  couponError?: string;
  giftCardCode?: string;
  giftCardError?: string;
  loyaltyError?: string;
  deliveryError?: string;
}

export function computeQuote(lines: QuoteLineInput[], ctx: QuoteCtx): ComputedQuote {
  const now = ctx.now ?? new Date();
  const lineCents = (l: QuoteLineInput) => l.unitCents * l.qty;
  const subtotal = lines.reduce((s, l) => s + lineCents(l), 0);

  // ── coupon ──
  let discount = 0;
  let couponError: string | undefined;
  let appliedCoupon: string | undefined;
  const coupon = ctx.coupon;
  if (coupon) {
    if (!coupon.active) couponError = 'Invalid code';
    else if (coupon.endsAt && coupon.endsAt < now) couponError = 'Code expired';
    else if (coupon.maxRedemptions != null && coupon.redeemed >= coupon.maxRedemptions)
      couponError = 'Code fully redeemed';
    else if (coupon.minSubtotalCents && subtotal < coupon.minSubtotalCents)
      couponError = `Minimum subtotal ${(coupon.minSubtotalCents / 100).toFixed(2)} required`;
    else {
      // PERCENT clamps at 100 so a mistyped 150% coupon can never record a
      // discount larger than the subtotal (admin-side validation is wave B)
      discount =
        coupon.kind === 'PERCENT'
          ? Math.round((subtotal * Math.min(coupon.value, 100)) / 100)
          : Math.min(coupon.value, subtotal);
      appliedCoupon = coupon.code;
    }
  }

  // ── delivery ──
  let fee = 0;
  let deliveryError: string | undefined;
  if (ctx.mode === 'delivery') {
    const d = ctx.delivery;
    if (!d?.enabled) deliveryError = 'Delivery is not available';
    // a configured zone list means the ZIP is REQUIRED — an empty zip must not
    // slip past the allow-list and get charged for an undeliverable address
    else if (d.zips.length > 0 && (!ctx.zip || !d.zips.includes(ctx.zip)))
      deliveryError = ctx.zip ? 'Outside our delivery zone' : 'Enter your delivery ZIP code';
    else if (subtotal - discount < d.minCents)
      deliveryError = `Delivery minimum is $${(d.minCents / 100).toFixed(2)}`;
    else fee = d.feeCents;
  }

  // ── tax: only taxable lines, with the discount allocated proportionally so a
  //    coupon can never shift tax onto exempt lines ──
  const taxableSub = lines.reduce((s, l) => (l.taxable ? s + lineCents(l) : s), 0);
  const taxBase =
    subtotal > 0 ? Math.max(0, taxableSub - Math.round((discount * taxableSub) / subtotal)) : 0;
  const tax = taxOn(taxBase, ctx.taxRateBp);

  let total = Math.max(0, subtotal - discount) + tax + fee + ctx.tipCents;

  // ── gift card: tender against the final total ──
  let giftApplied = 0;
  let giftCardError: string | undefined;
  let appliedGiftCode: string | undefined;
  const gift = ctx.giftCard;
  if (gift) {
    if (!gift.active) giftCardError = 'Invalid gift card';
    else if (gift.balanceCents <= 0) giftCardError = 'Gift card has no balance';
    else {
      giftApplied = Math.min(gift.balanceCents, total);
      total -= giftApplied;
      appliedGiftCode = gift.code;
    }
  }

  // ── loyalty: member points as post-tax tender AFTER the gift card ──
  //    each 500 cents redeemed costs 100 points; like the gift card it can
  //    never exceed the remaining due (incl. tip) and never touches tax
  let loyaltyApplied = 0;
  let loyaltyError: string | undefined;
  const loy = ctx.loyalty;
  if (loy) {
    if (loy.points == null) loyaltyError = 'No member found for that phone';
    else if (loy.redeemCents < 500 || loy.redeemCents % 500 !== 0)
      loyaltyError = 'Redeem in $5 steps (100 points each)';
    else if (loy.points < loy.redeemCents / 5) loyaltyError = 'Not enough points';
    else {
      loyaltyApplied = Math.min(loy.redeemCents, total);
      total -= loyaltyApplied;
    }
  }

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: tax,
    feeCents: fee,
    tipCents: ctx.tipCents,
    giftAppliedCents: giftApplied,
    loyaltyAppliedCents: loyaltyApplied,
    totalCents: total,
    couponCode: appliedCoupon,
    couponError,
    giftCardCode: appliedGiftCode,
    giftCardError,
    loyaltyError,
    deliveryError,
  };
}
