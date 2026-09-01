/* orders — public routes. */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createOrderWithSeqRetry } from '@/lib/order-code';
import { intentConsumed, intentVoided, recordPayment, refundIntent, refundIntentSafe, verifyIntent } from '@/lib/payments';
import { emailShell, notifyChannels, notifyOwner, sendEmail, sendSms } from '@/lib/notify';
import { money } from '@/lib/money';
import { openNow, orderingStatus } from '@/lib/ordering-gate';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';
import { runLadder, type ClaimStep } from '@/lib/tender-ladder';
import { buildQuote, QuoteInput } from '../quote';
import { pickupSlots } from './orders.availability';
import { tok } from '@/lib/codes';
import { clientIp, limited } from '../shared';

import { createIntent } from '@/lib/payments';

export const routes = new Hono();

routes.post('/orders/quote', async (c) => {
  // generous cap: checkout re-quotes on every coupon/tip/cart change
  if (await limited(`quote:${clientIp(c)}`, 60)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const parsed = QuoteInput.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: { code: 'VALIDATION', issues: parsed.error.issues } }, 400);
  return c.json(await buildQuote(parsed.data));
});

routes.get('/orders/slots', async (c) => {
  const date = c.req.query('date');
  if (!date) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const business = await db.business.findFirstOrThrow();
  const status = await orderingStatus(business, date);
  if (!status.open) return c.json({ slots: [], closed: status.reason, pausedUntil: status.pausedUntil });
  return c.json({ slots: await pickupSlots(date) });
});

const PlaceOrder = z.object({
  quote: QuoteInput,
  contact: z.object({
    name: z.string().min(1),
    phone: z.string().min(7),
    email: z.string().email().optional().or(z.literal('')),
    // marketing consent is opt-in only: absent/false never downgrades an
    // existing subscriber (see the upsert below)
    marketingOptIn: z.boolean().optional(),
  }),
  scheduledFor: z.string().optional(), // "HH:MM" or "asap"
  address: z.string().optional(),
  zip: z.string().optional(),
  notes: z.string().max(500).optional(),
  tableNo: z.string().max(12).optional(), // dine-in table card QR (?table=N)
  payment: z.object({
    method: z.enum(['online', 'store']),
    intentId: z.string().optional(),
  }),
  website: z.string().optional(), // honeypot
});

routes.post('/orders', async (c) => {
  const ip = clientIp(c);
  if (await limited(`orders:${ip}`)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const parsed = PlaceOrder.safeParse(await c.req.json());
  if (!parsed.success)
    return c.json({ error: { code: 'VALIDATION', issues: parsed.error.issues } }, 400);
  const input = parsed.data;
  if (input.website) return c.json({ error: { code: 'VALIDATION' } }, 400); // honeypot

  // The client captures the card BEFORE posting, so every reject between here
  // and recordPayment must hand the captured money back (refundIntentSafe
  // no-ops for pay-at-store, missing, or already-consumed intents).
  const intentId = input.payment.method === 'online' ? input.payment.intentId : undefined;
  const bail = async (status: 400 | 402 | 409, error: { code: string; message?: string; reason?: string }) => {
    const refunded = await refundIntentSafe(intentId);
    if (refunded && error.message) error = { ...error, message: `${error.message} Your payment was refunded.` };
    return c.json({ error }, status);
  };

  // the gate the UI can't bypass: paused kitchen / holiday / closed hours → 409
  const business = await db.business.findFirstOrThrow();
  const status = await orderingStatus(business);
  if (!status.open)
    return bail(409, { code: 'CLOSED', reason: status.reason, message: status.reason === 'paused' ? 'Ordering is temporarily paused.' : 'We are closed today.' });
  if ((input.scheduledFor ?? 'asap') === 'asap' && !openNow(business))
    return bail(409, { code: 'CLOSED', reason: 'closed', message: 'We are closed right now. Pick a time slot instead.' });

  const quote = await buildQuote(input.quote);
  if (quote.lines.length === 0) return bail(400, { code: 'VALIDATION', message: 'Empty cart' });
  if (quote.deliveryError) return bail(400, { code: 'VALIDATION', message: quote.deliveryError });
  // a dead coupon / gift card / loyalty claim is a 409, never a silent re-price:
  // the pay-at-store total the customer saw must be the total that is recorded
  const tenderError = quote.couponError ?? quote.giftCardError ?? quote.loyaltyError;
  if (tenderError) return bail(409, { code: 'CONFLICT', message: tenderError });

  // resolve the loyalty member for the atomic decrement below; loyaltyError
  // above already rejected unknown members and short balances at quote time.
  // points burnt track the CLAMPED value actually applied (computeQuote caps
  // loyaltyApplied at the remaining due) — never the raw requested redeemCents,
  // or a $5-redeem on a $3 order would silently burn 100 points for 60 of value.
  const pointsNeeded = quote.loyaltyAppliedCents > 0 && input.quote.loyalty ? quote.loyaltyAppliedCents / 5 : 0;
  const member = pointsNeeded > 0 && offers.findMember ? await offers.findMember(db, input.quote.loyalty!.phone) : null;
  if (pointsNeeded > 0 && !member)
    return bail(409, { code: 'CONFLICT', message: 'No member found for that phone' });

  let paymentId: string | undefined;
  if (input.payment.method === 'online') {
    if (!intentId) return c.json({ error: { code: 'PAYMENT_REQUIRED' } }, 402);
    // an intent we already voided must not read as "payment not confirmed" — the
    // customer's card was handed back, so the only way forward is a fresh charge
    if (await intentVoided(intentId))
      return c.json({ error: { code: 'PAYMENT_VOIDED', message: 'That payment was refunded, so it can no longer pay for an order. Please pay again to place it.' } }, 409);
    const check = await verifyIntent(intentId, quote.totalCents);
    if (!check.ok) {
      // a processing intent is NOT refunded: the client keeps the same intent
      // and retries once it settles, so nobody pays twice
      if (check.reason === 'processing')
        return c.json({ error: { code: 'PROCESSING', message: 'Your payment is still processing. Please wait a moment and try again with the same card. Do not pay again.' } }, 402);
      return bail(402, { code: 'PAYMENT_REQUIRED', message: 'Payment not confirmed.' });
    }
    if (await intentConsumed(intentId))
      return c.json({ error: { code: 'PAYMENT_ALREADY_USED', message: 'This payment was already used for an order' } }, 409);
    paymentId = await recordPayment({
      provider: check.provider,
      externalId: intentId,
      amountCents: quote.totalCents,
      tipCents: quote.tipCents,
    });
  }

  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date());

  // upsert customer — the profile and the marketing consent are customers' to
  // keep. No module, no profile: customerId stays undefined and the order still
  // carries the contact it was placed with.
  const customerId = await offers.upsertMember?.(db, {
    name: input.contact.name,
    phone: input.contact.phone,
    email: input.contact.email || undefined,
    marketingOptIn: input.contact.marketingOptIn,
  });

  // table-card orders carry the table as a notes prefix — no schema change, and it
  // shows up naturally on the admin board card and the kitchen view
  const notes = input.tableNo
    ? `[Table ${input.tableNo}]${input.notes ? ` ${input.notes}` : ''}`
    : input.notes ?? null;

  const orderData = (seq: number, code: string) => ({
    dateKey,
    seq,
    code,
    type: input.quote.mode === 'delivery' ? ('DELIVERY' as const) : ('PICKUP' as const),
    status: input.payment.method === 'online' ? ('CONFIRMED' as const) : ('PENDING' as const),
    customerId,
    contactName: input.contact.name,
    contactPhone: input.contact.phone,
    contactEmail: input.contact.email || null,
    fulfillment: {
      mode: input.quote.mode,
      scheduledFor: input.scheduledFor ?? 'asap',
      address: input.address,
      zip: input.zip,
    },
    itemsSnapshot: quote.lines as object[],
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    taxCents: quote.taxCents,
    feeCents: quote.feeCents,
    tipCents: quote.tipCents,
    totalCents: quote.totalCents,
    couponCode: quote.couponCode ?? null,
    giftCardCode: quote.giftCardCode ?? null,
    giftAppliedCents: quote.giftAppliedCents ?? 0,
    // restoration data for the wave-B refund route: which member paid how many
    // points for how much tender (schema untouched, rides the order meta JSON)
    quoteMeta: pointsNeeded > 0 && member
      ? { loyalty: { customerId: member.id, loyaltyRedeemedCents: quote.loyaltyAppliedCents, points: pointsNeeded } }
      : undefined,
    paymentId,
    notes,
    accessToken: tok(),
  });

  // Tender is real money: claim each leg ATOMICALLY with a guard BEFORE the
  // order exists, so two concurrent orders can't spend the same balance. Any
  // later failure walks the ladder back in reverse: the captured payment is
  // refunded, the gift balance restored, the coupon redemption released, the
  // points returned — never a charge without an order, never a silent re-price.
  const steps: ClaimStep[] = [];
  if (paymentId && intentId) {
    steps.push({
      claim: async () => true, // already captured + recorded; here so every later failure refunds it
      release: async () => {
        await refundIntent(intentId);
        await db.payment.update({ where: { id: paymentId! }, data: { status: 'REFUNDED' } });
      },
      fail: { code: 'PAYMENT_REQUIRED', message: 'Payment not confirmed.' },
    });
  }
  if (quote.giftCardCode && quote.giftAppliedCents > 0) {
    steps.push({
      claim: async () =>
        (await db.giftCard.updateMany({
          where: { code: quote.giftCardCode!, active: true, balanceCents: { gte: quote.giftAppliedCents } },
          data: { balanceCents: { decrement: quote.giftAppliedCents } },
        })).count > 0,
      release: async () => {
        await db.giftCard.updateMany({ where: { code: quote.giftCardCode! }, data: { balanceCents: { increment: quote.giftAppliedCents } } });
      },
      fail: { code: 'CONFLICT', message: 'Gift card balance changed. Please try again.' },
    });
  }
  if (quote.couponCode && quote.discountCents > 0) {
    steps.push({
      // only orders that WIN the guarded increment keep the discount; a loser
      // (coupon just exhausted) is compensated and asked to re-quote instead
      // of silently over-discounting the merchant
      claim: async () => {
        const cp = await db.coupon.findUnique({ where: { code: quote.couponCode! } });
        if (cp?.maxRedemptions != null) {
          return (await db.coupon.updateMany({
            where: { code: quote.couponCode!, redeemed: { lt: cp.maxRedemptions } },
            data: { redeemed: { increment: 1 } },
          })).count > 0;
        }
        await db.coupon.update({ where: { code: quote.couponCode! }, data: { redeemed: { increment: 1 } } });
        return true;
      },
      release: async () => {
        await db.coupon.updateMany({ where: { code: quote.couponCode!, redeemed: { gt: 0 } }, data: { redeemed: { decrement: 1 } } });
      },
      fail: { code: 'COUPON_UNAVAILABLE', message: 'That code was just fully redeemed. Please review your total and try again.' },
    });
  }
  if (pointsNeeded > 0 && member) {
    steps.push({
      // no burn hook ⇒ the claim FAILS rather than being skipped: the quote
      // that reached here priced a redemption in, so the only two honest
      // outcomes are points spent at the discounted total or no order at all —
      // never a discount charged against points nobody burnt.
      claim: async () => (await offers.burnPoints?.(db, member.id, pointsNeeded)) ?? false,
      release: async () => {
        await offers.returnPoints?.(db, member.id, pointsNeeded);
      },
      fail: { code: 'CONFLICT', message: 'Your points balance changed. Please review your total and try again.' },
    });
  }

  // Both @@unique([dateKey,seq]) and code @unique can collide under concurrency;
  // createOrderWithSeqRetry re-derives both per attempt, and a total failure
  // unwinds the whole ladder — no charge without an order.
  const out = await runLadder(steps, () => createOrderWithSeqRetry(db, dateKey, orderData), {
    code: 'INTERNAL',
    message: 'Could not assign an order number',
  });
  if (!out.ok) return c.json({ error: { code: out.code, message: out.message } }, out.code === 'INTERNAL' ? 500 : 409);
  const order = out.value;
  // link the payment back to its order — reports and the refund route read this side
  if (paymentId) await db.payment.update({ where: { id: paymentId }, data: { orderId: order.id } });

  if (input.contact.email) {
    await sendEmail(
      input.contact.email,
      `Order ${order.code} confirmed — ${business.name}`,
      emailShell(business.name, `Order ${order.code}`, [
        `Thanks, ${input.contact.name}! We are on it.`,
        ...quote.lines.map((l) => `${l.qty} × ${l.name} — ${money(l.lineCents)}`),
        `<strong>Total: ${money(quote.totalCents)}</strong>`,
        input.quote.mode === 'pickup'
          ? `Pickup ${input.scheduledFor === 'asap' || !input.scheduledFor ? 'in about 20 minutes' : `at ${input.scheduledFor}`}.`
          : 'We will call when the driver is close.',
      ]),
    );
  }
  await sendSms(input.contact.phone, `${business.name}: order ${order.code} received. Total ${money(quote.totalCents)}.`);
  await notifyOwner(
    `🧾 New order ${order.code} — ${money(quote.totalCents)}`,
    emailShell(business.name, `New ${input.quote.mode} order ${order.code}`, [
      ...quote.lines.map((l) => `${l.qty} × ${l.name} — ${money(l.lineCents)}`),
      `<strong>Total: ${money(quote.totalCents)}</strong> · ${input.payment.method === 'online' ? 'PAID ONLINE' : 'pay at store'}`,
      `For: ${input.scheduledFor ?? 'asap'} · ${input.contact.name} · ${input.contact.phone}`,
      notes ? `Notes: ${notes}` : '',
    ].filter(Boolean)),
  );

  // notified: which channels really deliver, so the success screen promises a
  // receipt only when one is on its way (a Stripe-only site used to promise both)
  return c.json({ code: order.code, accessToken: order.accessToken, totalCents: order.totalCents, status: order.status, notified: notifyChannels() });
});

routes.post('/orders/track', async (c) => {
  // code+last4 lookup is brute-forceable PII — cap it hard
  if (await limited(`track:${clientIp(c)}`, 10)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = z
    .object({ code: z.string().min(2), phone: z.string().min(4) })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const order = await db.order.findFirst({
    where: { code: body.data.code.toUpperCase().trim() },
  });
  const last4 = (s: string) => s.replace(/\D/g, '').slice(-4);
  if (!order || last4(order.contactPhone) !== last4(body.data.phone))
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  return c.json({
    code: order.code,
    status: order.status,
    type: order.type,
    totalCents: order.totalCents,
    // quoteMeta doubles as internal tender restoration data on dining orders —
    // only QUOTE jobs expose it to the tracker
    quote: order.type === 'QUOTE' ? order.quoteMeta : undefined,
    updatedAt: order.updatedAt,
  });
});

routes.post('/payments/intent', async (c) => {
  // every call mints a Stripe PaymentIntent — don't let a script farm them
  if (await limited(`payintent:${clientIp(c)}`, 10)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = z.object({ quote: QuoteInput }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const quote = await buildQuote(body.data.quote);
  if (quote.totalCents <= 0) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const intent = await createIntent(quote.totalCents, { source: 'storefront' });
  return c.json({ ...intent, amountCents: quote.totalCents });
});

/* ── the estimate closed loop (REVENUE_MASTER_PLAN §5.4, 站端半邊) ──
   Customer-facing, accessToken-authed (the token already travels in the
   estimate email). Accept/decline write quoteMeta and emit events; the deposit
   rides the SAME deposit money-machine appointments uses (offers.
   depositPayments), so a payments-less site simply quotes no deposit step.
   Terminology (§A.4-13): customer-facing this is an ESTIMATE; the entity
   remains Order(type QUOTE). */

const estimateByToken = async (token: string) => {
  const order = await db.order.findFirst({ where: { accessToken: token, type: 'QUOTE' } });
  if (!order) return null;
  const meta = (order.quoteMeta ?? {}) as Record<string, unknown>;
  return { order, meta };
};

routes.get('/estimate/:token', async (c) => {
  const found = await estimateByToken(c.req.param('token'));
  if (!found) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const { order, meta } = found;
  const pay = offers.depositPayments;
  const depositCents = typeof meta.depositCents === 'number' ? meta.depositCents : Math.round((meta.estimatedCents as number ?? 0) * 0.3);
  const paid = order.paymentId ? await db.payment.findUnique({ where: { id: order.paymentId } }) : null;
  return c.json({
    code: order.code,
    status: order.status,
    contactName: order.contactName,
    estimatedCents: meta.estimatedCents ?? null,
    note: meta.note ?? null,
    sentAt: meta.sentAt ?? null,
    acceptedAt: meta.acceptedAt ?? null,
    declinedAt: meta.declinedAt ?? null,
    // no payments module ⇒ no deposit step, same rule as booking deposits
    depositCents: pay && meta.estimatedCents ? depositCents : 0,
    depositPaid: paid?.status === 'SUCCEEDED',
  });
});

routes.post('/estimate/:token/accept', async (c) => {
  const found = await estimateByToken(c.req.param('token'));
  if (!found) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const { order, meta } = found;
  if (!meta.sentAt) return c.json({ error: { code: 'CONFLICT', message: 'No estimate has been sent yet.' } }, 409);
  if (meta.declinedAt) return c.json({ error: { code: 'CONFLICT', message: 'This estimate was declined.' } }, 409);
  if (!meta.acceptedAt) {
    await db.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', quoteMeta: { ...meta, acceptedAt: new Date().toISOString() } },
    });
    await offers.platformEmit?.(db, 'estimate.accepted', { orderId: order.id });
  }
  return c.json({ ok: true });
});

routes.post('/estimate/:token/decline', async (c) => {
  const found = await estimateByToken(c.req.param('token'));
  if (!found) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const { order, meta } = found;
  if (meta.acceptedAt) return c.json({ error: { code: 'CONFLICT', message: 'Already accepted.' } }, 409);
  await db.order.update({
    where: { id: order.id },
    data: { status: 'CANCELED', quoteMeta: { ...meta, declinedAt: new Date().toISOString() } },
  });
  return c.json({ ok: true });
});

/* deposit: intent minted server-side at OUR amount; confirm re-verifies with
   the provider before anything is recorded (verifyIntent — the same paranoia
   as checkout). Replay-safe: Payment.externalId is unique. */
routes.post('/estimate/:token/deposit-intent', async (c) => {
  const found = await estimateByToken(c.req.param('token'));
  if (!found) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const { meta } = found;
  const pay = offers.depositPayments;
  if (!pay) return c.json({ error: { code: 'PAYMENTS_OFF', message: 'Online deposit is not available — we will arrange it with you directly.' } }, 409);
  if (!meta.acceptedAt) return c.json({ error: { code: 'CONFLICT', message: 'Accept the estimate first.' } }, 409);
  const depositCents = typeof meta.depositCents === 'number' ? meta.depositCents : Math.round((meta.estimatedCents as number ?? 0) * 0.3);
  if (depositCents < 50) return c.json({ error: { code: 'VALIDATION', message: 'No deposit is due.' } }, 400);
  const intent = await pay.createIntent(depositCents, { purpose: 'estimate-deposit', order: found.order.id });
  return c.json({ ...intent, amountCents: depositCents });
});

routes.post('/estimate/:token/deposit-confirm', async (c) => {
  const body = z.object({ externalId: z.string().min(4) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const found = await estimateByToken(c.req.param('token'));
  if (!found) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const { order, meta } = found;
  const pay = offers.depositPayments;
  if (!pay) return c.json({ error: { code: 'PAYMENTS_OFF' } }, 409);
  const depositCents = typeof meta.depositCents === 'number' ? meta.depositCents : Math.round((meta.estimatedCents as number ?? 0) * 0.3);
  const check = await pay.verifyIntent(body.data.externalId, depositCents);
  if (!check.ok) return c.json({ error: { code: 'PAYMENT_REQUIRED', message: check.reason ?? 'Payment not verified.' } }, 402);
  if (await pay.intentConsumed(body.data.externalId)) return c.json({ ok: true, already: true });
  const paymentId = await pay.recordPayment({ provider: check.provider, externalId: body.data.externalId, amountCents: depositCents });
  await db.order.update({ where: { id: order.id }, data: { paymentId } });
  await offers.platformEmit?.(db, 'payment.received', { orderId: order.id, amountCents: depositCents, kind: 'deposit' });
  return c.json({ ok: true });
});

