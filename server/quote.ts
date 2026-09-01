/* Server-side order quoting — the single source of truth for money.
   The client only ever displays what this returns. */

import { z } from 'zod';
import { db } from '@/lib/db';
import { computeQuote, type CouponRecord, type DeliveryConfig, type GiftCardRecord, type QuoteLineInput } from '@/lib/quote-calc';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';

export const QuoteInput = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string(),
        qty: z.number().int().min(1).max(50),
        modifiers: z.array(z.string()).default([]), // option names
      }),
    )
    .min(1),
  mode: z.enum(['pickup', 'delivery']),
  zip: z.string().optional(),
  couponCode: z.string().optional(),
  giftCardCode: z.string().optional(),
  /** member point redemption as tender; 500 = $5 = 100 points (validated in computeQuote) */
  loyalty: z.object({ phone: z.string().min(1), redeemCents: z.number().int().min(1) }).optional(),
  tipCents: z.number().int().min(0).max(100000).default(0),
});
export type QuoteInput = z.infer<typeof QuoteInput>;

export interface QuoteLine {
  itemId: string;
  name: string;
  qty: number;
  unitCents: number;
  modifiers: { name: string; priceCents: number }[];
  lineCents: number;
  taxable: boolean;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  feeCents: number;
  tipCents: number;
  /** gift card value applied as tender against the total */
  giftAppliedCents: number;
  /** loyalty points applied as tender after the gift card */
  loyaltyAppliedCents: number;
  totalCents: number;
  couponCode?: string;
  couponError?: string;
  giftCardCode?: string;
  giftCardError?: string;
  loyaltyError?: string;
  deliveryError?: string;
}

interface ModifierGroup {
  name: string;
  min: number;
  max: number;
  options: { name: string; priceCents: number }[];
}

export async function buildQuote(input: QuoteInput): Promise<Quote> {
  const business = await db.business.findFirstOrThrow();
  const delivery = (business.delivery ?? null) as {
    enabled: boolean;
    feeCents: number;
    minCents: number;
    zips: string[];
  } | null;

  const ids = [...new Set(input.items.map((i) => i.itemId))];
  const items = await db.item.findMany({ where: { id: { in: ids } } });
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines: QuoteLine[] = [];
  for (const line of input.items) {
    const item = byId.get(line.itemId);
    if (!item || !item.available) continue;
    const groups = (item.modifiers ?? []) as unknown as ModifierGroup[];
    const allOptions = groups.flatMap((g) => g.options);
    const chosen = line.modifiers
      .map((name) => allOptions.find((o) => o.name === name))
      .filter((o): o is { name: string; priceCents: number } => !!o);
    const unit = item.priceCents + chosen.reduce((s, o) => s + o.priceCents, 0);
    lines.push({
      itemId: item.id,
      name: item.name,
      qty: line.qty,
      unitCents: unit,
      modifiers: chosen,
      lineCents: unit * line.qty,
      taxable: item.taxable,
    });
  }

  // resolve coupon + gift card from the DB, then hand ALL money math to the pure
  // computeQuote core (lib/quote-calc.ts) — one testable source of truth
  const coupon = input.couponCode
    ? ((await db.coupon.findUnique({ where: { code: input.couponCode.toUpperCase() } })) as CouponRecord | null)
    : null;
  const giftCard = input.giftCardCode
    ? ((await db.giftCard.findUnique({ where: { code: input.giftCardCode.toUpperCase() } })) as GiftCardRecord | null)
    : null;
  // loyalty is customers' data: no module, no members, no points to redeem
  const member = input.loyalty && offers.findMember ? await offers.findMember(db, input.loyalty.phone) : null;

  const calcLines: QuoteLineInput[] = lines.map((l) => ({
    itemId: l.itemId,
    name: l.name,
    qty: l.qty,
    unitCents: l.unitCents,
    modifiers: l.modifiers,
    taxable: l.taxable,
  }));

  const c = computeQuote(calcLines, {
    taxRateBp: business.taxRateBp,
    mode: input.mode,
    zip: input.zip,
    tipCents: input.tipCents,
    delivery: delivery as DeliveryConfig | null,
    coupon,
    giftCard,
    loyalty: input.loyalty
      ? { redeemCents: input.loyalty.redeemCents, points: member?.loyaltyPoints ?? null }
      : null,
  });

  // an unknown code must surface, not silently vanish from the total
  if (input.couponCode && !coupon && !c.couponError) c.couponError = 'Invalid code';
  if (input.giftCardCode && !giftCard && !c.giftCardError) c.giftCardError = 'Invalid gift card';

  return { lines, ...c };
}
