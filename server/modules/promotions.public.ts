/* promotions — public routes (gift cards & coupons). */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { createIntent, intentConsumed, recordPayment, refundIntent, refundIntentSafe, verifyIntent } from '@/lib/payments';
import { emailShell, notifyChannels, sendEmail } from '@/lib/notify';
import { money } from '@/lib/money';
import { computeQuote, type CouponRecord } from '@/lib/quote-calc';
import { clientIp, limited } from '../shared';

export const routes = new Hono();

/* ── gift cards ── */

routes.post('/giftcards/intent', async (c) => {
  // every call mints a Stripe PaymentIntent — don't let a script farm them
  if (await limited(`gc-intent:${clientIp(c)}`, 10)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = z.object({ amountCents: z.number().int().min(500).max(50000) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const intent = await createIntent(body.data.amountCents, { purpose: 'giftcard' });
  return c.json(intent);
});

routes.post('/giftcards/purchase', async (c) => {
  const body = z
    .object({ amountCents: z.number().int().min(500).max(50000), email: z.string().email(), intentId: z.string() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const check = await verifyIntent(body.data.intentId, body.data.amountCents);
  if (!check.ok) {
    if (check.reason === 'processing')
      return c.json({ error: { code: 'PROCESSING', message: 'Your payment is still processing. Please wait a moment and try again with the same card. Do not pay again.' } }, 402);
    // the card was captured client-side before this POST — hand the money back
    await refundIntentSafe(body.data.intentId);
    return c.json({ error: { code: 'PAYMENT_REQUIRED', message: 'Payment not confirmed.' } }, 402);
  }
  if (await intentConsumed(body.data.intentId))
    return c.json({ error: { code: 'PAYMENT_ALREADY_USED', message: 'This payment was already used' } }, 409);
  // record the payment first — its @unique externalId is the atomic backstop, so a
  // concurrent replay throws here instead of minting a second gift card
  const payId = await recordPayment({ provider: check.provider, externalId: body.data.intentId, amountCents: body.data.amountCents });
  const code = `GC-${randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    await db.giftCard.create({
      data: {
        code,
        initialCents: body.data.amountCents,
        balanceCents: body.data.amountCents,
        purchaserEmail: body.data.email,
      },
    });
  } catch {
    // no card minted → no money kept
    try { await refundIntent(body.data.intentId); await db.payment.update({ where: { id: payId }, data: { status: 'REFUNDED' } }); } catch { /* dashboard reconciliation */ }
    return c.json({ error: { code: 'INTERNAL', message: 'Could not issue the gift card. Your payment was refunded.' } }, 500);
  }
  const business = await db.business.findFirstOrThrow();
  await sendEmail(
    body.data.email,
    `Your ${business.name} gift card`,
    emailShell(business.name, `A gift worth ${money(body.data.amountCents)}`, [
      `Gift card code: <strong style="letter-spacing:2px">${code}</strong>`,
      'Enter it at checkout online or read it out in store. The balance carries over until it’s gone.',
    ]),
  );
  // notified.email false = the buyer must keep this code themselves, nothing was mailed
  return c.json({ code, notified: notifyChannels() });
});

routes.post('/giftcards/balance', async (c) => {
  // tight limit: a gift-card code is a low-entropy string an attacker would
  // otherwise brute-force for balances (no limiter here before)
  if (await limited(`gcbal:${clientIp(c)}`, 8)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = z.object({ code: z.string().min(4) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const card = await db.giftCard.findUnique({ where: { code: body.data.code.toUpperCase() } });
  if (!card || !card.active) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  return c.json({ code: card.code, balanceCents: card.balanceCents });
});

/* ── coupons ── */

/* The storefront CouponBanner advertises only an offer that is really live:
   active, unexpired, not fully redeemed. Read-only; signup rewards are kept
   for the welcome email, not the public banner. (audit dining#10) */
routes.get('/coupons/active', async (c) => {
  const now = new Date();
  const coupons = await db.coupon.findMany({
    where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  });
  const usable = coupons.filter((cp) => cp.maxRedemptions == null || cp.redeemed < cp.maxRedemptions);
  const live = usable.find((cp) => !cp.signupReward) ?? null;
  return c.json({
    coupon: live ? { code: live.code, description: live.description, kind: live.kind, value: live.value } : null,
  });
});

routes.post('/coupons/validate', async (c) => {
  // coupon codes are guessable — cap the probe rate, generously enough for typos
  if (await limited(`coupon:${clientIp(c)}`, 30)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = z
    .object({ code: z.string(), subtotalCents: z.number().int().min(0) })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const coupon = await db.coupon.findUnique({ where: { code: body.data.code.toUpperCase() } });
  if (!coupon) return c.json({ valid: false, reason: 'Invalid code' });
  // run the REAL rules (active, expiry, max redemptions, min subtotal, FIXED cap,
  // PERCENT clamp) through computeQuote so the preview can never promise a
  // discount the authoritative quote refuses
  const probe = computeQuote(
    [{ itemId: 'probe', name: 'probe', qty: 1, unitCents: body.data.subtotalCents, modifiers: [], taxable: false }],
    { taxRateBp: 0, mode: 'pickup', tipCents: 0, delivery: null, coupon: coupon as unknown as CouponRecord, giftCard: null },
  );
  if (probe.couponError) return c.json({ valid: false, reason: probe.couponError });
  return c.json({ valid: true, discountCents: probe.discountCents, description: coupon.description });
});
