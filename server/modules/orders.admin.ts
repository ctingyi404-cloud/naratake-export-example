/* Admin API — orders, refunds, the kitchen/board status flow, quote estimates,
   terminals, and the POS register routes. */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { emailShell, sendEmail, sendSms } from '@/lib/notify';
import { money } from '@/lib/money';
import { refundableRemaining, refundedSoFar, refundIntent, refundPayment } from '@/lib/payments';
import { can } from '@/lib/permissions';
import { refundEligibility, restituteOrder, reverseEarnedPoints } from '@/lib/restitution';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';
import { site } from '@/lib/site-config';
import { getSiteUrl } from '@/lib/site-url';
import { posRoutes } from '../pos';

export const routes = new Hono();

/* ── orders ── */

routes.get('/orders', async (c) => {
  const status = c.req.query('status');
  // active=true → EVERY non-terminal order, uncapped: the kitchen board must
  // never silently lose a PENDING order past a page boundary (audit dining#11,
  // leads#5). Records keeps the paginated mode.
  const active = c.req.query('active') === 'true';
  const date = c.req.query('date');
  const days = parseInt(c.req.query('days') ?? '', 10); // rolling window
  const month = c.req.query('month'); // 'current' → this calendar month (business tz)
  const q = c.req.query('q')?.trim();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('pageSize') ?? '100', 10) || 100));
  let dateWhere = {};
  if (date) dateWhere = { dateKey: date };
  else if (month === 'current') {
    const business = await db.business.findFirstOrThrow();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date());
    dateWhere = { dateKey: { startsWith: today.slice(0, 7) } }; // YYYY-MM
  } else if (Number.isFinite(days) && days > 0) {
    dateWhere = { createdAt: { gte: new Date(Date.now() - Math.min(365, days) * 86400_000) } };
  }
  const where = {
    ...(active ? { status: { notIn: ['COMPLETED', 'CANCELED'] } } : status ? { status } : {}),
    ...dateWhere,
    ...(q
      ? {
          OR: [
            { code: { contains: q } },
            { contactName: { contains: q } },
            { contactPhone: { contains: q } },
          ],
        }
      : {}),
  };
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...(active ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    }),
    db.order.count({ where }),
  ]);
  // resolve staff names for service industries (POS sales carry staffId)
  const staffIds = [...new Set(orders.map((o) => o.staffId).filter(Boolean))] as string[];
  // staff are appointments' records; a site with no booking engine has none
  const staffById = new Map(Object.entries((await offers.staffNames?.(db, staffIds)) ?? {}));
  // paid/unpaid must be visible per order — the board and the refund button read this
  const payIds = orders.map((o) => o.paymentId).filter(Boolean) as string[];
  const payById = new Map(
    payIds.length ? (await db.payment.findMany({ where: { id: { in: payIds } } })).map((p) => [p.id, p]) : [],
  );
  return c.json({
    orders: orders.map((o) => {
      const p = o.paymentId ? payById.get(o.paymentId) : undefined;
      return {
        ...o,
        staffName: o.staffId ? staffById.get(o.staffId) ?? null : null,
        // refunded/remaining travel with the row so the detail modal can offer a
        // partial refund without a second round trip
        payment: p
          ? {
              provider: p.provider,
              status: p.status,
              amountCents: p.amountCents,
              refundedCents: refundedSoFar(p),
              refundableCents: refundableRemaining(p),
            }
          : null,
      };
    }),
    total,
    page,
    pageSize,
  });
});

/* Refund a paid order: reverse the Stripe charge, restore any gift-card tender the
   checkout consumed, return redeemed loyalty points, release the coupon redemption,
   reverse the points a completed order earned, cancel the order, and tell the
   customer the true amounts on their way back. Shares lib/restitution.ts with the
   board cancel, so refund-after-cancel is a clean "already refunded" and a cancel
   whose card refund failed stays refundable (audit dining#1 / commerce#1).

   With an `amountCents` in the body it is a PARTIAL card refund instead: one
   dish off a table of six is not a canceled order — the kitchen still made the
   other five — so the ticket stands, nothing is restored, and only the card
   moves. The two are deliberately different verbs, not the same button with a
   number in it. */
routes.post('/orders/:id/refund', async (c) => {
  // the historical caller sends no body at all
  const body = z
    .object({ amountCents: z.number().int().positive().optional() })
    .safeParse((await c.req.json().catch(() => null)) ?? {});
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const order = await db.order.findUnique({ where: { id: c.req.param('id') } });
  if (!order) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const payment = order.paymentId ? await db.payment.findUnique({ where: { id: order.paymentId } }) : null;
  const cardLeft = refundableRemaining(payment);
  const business = await db.business.findFirstOrThrow();

  /* ── partial: card only, ticket stands ── */
  if (body.data.amountCents !== undefined) {
    const want = body.data.amountCents;
    if (cardLeft <= 0)
      return c.json(
        { error: { code: 'NO_REFUNDABLE_PAYMENT', message: '這筆訂單沒有可退的卡片款項 No refundable card payment on this order.' } },
        400,
      );
    if (want > cardLeft)
      return c.json(
        {
          error: {
            code: 'EXCEEDS_REMAINING',
            message: `這筆付款只剩 ${money(cardLeft)} 可退 Only ${money(cardLeft)} is still refundable on this payment.`,
            remainingCents: cardLeft,
          },
        },
        400,
      );
    const out = await refundPayment(payment!.id, want);
    if (!out.ok)
      return c.json(
        {
          error: {
            // a lost compare-and-set is a double-click, not a failure to explain away
            code: out.reason === 'raced' ? 'CONFLICT' : 'REFUND_FAILED',
            message:
              out.reason === 'raced'
                ? '這筆付款在退款過程中被改動,請重新整理並確認已退金額後再試 This payment changed while you were refunding it — reload the order and check the refunded amount before trying again.'
                : out.message ?? 'Refund failed',
            remainingCents: out.remainingCents,
          },
        },
        out.reason === 'raced' ? 409 : 502,
      );
    if (order.contactEmail)
      await sendEmail(
        order.contactEmail,
        `Partial refund for order ${order.code} — ${business.name}`,
        emailShell(business.name, `${money(out.cents)} refunded`, [
          `We refunded ${money(out.cents)} of order ${order.code} to your card. The rest of your order stands.`,
          'Card refunds can take 5–10 business days to appear on your statement.',
        ]),
      );
    return c.json({ order, partial: true, refundedCents: out.cents, refundedTotalCents: out.refundedTotalCents, remainingCents: out.remainingCents, paymentStatus: out.status });
  }

  /* ── full: card + gift + loyalty + coupon, and the order is canceled ── */
  const eligibility = refundEligibility(order, payment);
  // a partly refunded card still owes the rest, which refundEligibility cannot
  // see (it only knows SUCCEEDED and REFUNDED) — cardLeft is what says so
  if (cardLeft <= 0) {
    if (eligibility === 'already_refunded')
      return c.json({ error: { code: 'ALREADY_REFUNDED', message: 'This order was already refunded' } }, 400);
    if (eligibility === 'nothing_to_refund')
      return c.json({ error: { code: 'NO_REFUNDABLE_PAYMENT', message: 'No refundable payment on this order' } }, 400);
  }

  // reverse earned points BEFORE the status leaves COMPLETED (audit commerce#11 / dining#13)
  if (order.status === 'COMPLETED') await reverseEarnedPoints(db, order.id);

  /* Give back what a partial refund left behind FIRST: restitution's refundCard
     claims a whole SUCCEEDED row and would skip a PARTIALLY_REFUNDED one, so the
     remainder has to travel this path or it silently never goes back. */
  let restCardCents = 0;
  if (payment?.status === 'PARTIALLY_REFUNDED' && cardLeft > 0) {
    const rest = await refundPayment(payment.id);
    if (!rest.ok)
      return c.json({ error: { code: 'REFUND_FAILED', message: rest.message ?? 'Refund failed' } }, 502);
    restCardCents = rest.cents;
  }

  const restitution = await restituteOrder(db, order.id, refundIntent);
  if (!restitution.ok)
    // surface Stripe's own message — "charge already refunded" etc. is actionable
    return c.json({ error: { code: 'REFUND_FAILED', message: restitution.failMessage ?? 'Refund failed' } }, 502);
  const r = { ...restitution, cardCents: restitution.cardCents + restCardCents };

  const updated = await db.order.update({ where: { id: order.id }, data: { status: 'CANCELED' } });

  // report the true amounts — card-only, gift-only, and mixed all read naturally
  const parts: string[] = [];
  if (r.cardCents > 0) parts.push(`${money(r.cardCents)} refunded to your card`);
  if (r.giftCents > 0) parts.push(`${money(r.giftCents)} back on your gift card`);
  if (r.loyaltyPoints > 0) parts.push(`${r.loyaltyPoints} loyalty points returned`);
  const refundLine = parts.join(' and ');
  if (order.contactPhone)
    await sendSms(order.contactPhone, `${business.name} — Order ${order.code} canceled; ${refundLine}.`);
  if (order.contactEmail)
    await sendEmail(
      order.contactEmail,
      `Order ${order.code} refunded — ${business.name}`,
      emailShell(business.name, `Order ${order.code} refunded`, [
        `Your order was canceled and refunded: ${refundLine}.`,
        ...(r.cardCents > 0 ? ['Card refunds can take 5–10 business days to appear on your statement.'] : []),
        ...(r.giftCents > 0 ? ['Your gift-card balance is ready to use right away.'] : []),
      ]),
    );
  return c.json({ order: updated, restitution: r });
});

routes.patch('/orders/:id/status', async (c) => {
  const body = z
    .object({ status: z.enum(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELED', 'AWAITING_APPROVAL']) })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const prior = await db.order.findUnique({ where: { id: c.req.param('id') } });

  /* Cancelling a PAID order is a refund wearing a board move: this branch runs
     the same restitution ledger as POST /orders/:id/refund, which the
     permission table keeps out of STAFF's hands. Ask the SAME table here rather
     than widening the path regex — /orders/:id/status has to stay an ordinary
     write, or a cashier can no longer move a ticket across the board at all.
     Unpaid tickets are untouched: cancelling those IS the shift's work.
     The role comes from the row, not the token, exactly as the session
     middleware does it — a demoted account loses this now, not in 12 hours. */
  const canceling = body.data.status === 'CANCELED';
  const priorPayment = canceling && prior?.paymentId ? await db.payment.findUnique({ where: { id: prior.paymentId } }) : null;
  const cardLeft = refundableRemaining(priorPayment);
  if (prior && canceling) {
    if (refundEligibility(prior, priorPayment) === 'refundable' || cardLeft > 0) {
      const userId = c.get('userId' as never) as string | undefined;
      const role = userId ? (await db.adminUser.findUnique({ where: { id: userId } }))?.role : undefined;
      if (!can(role ?? '', 'money', 'orders'))
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message:
                '這筆訂單已付款,取消會退款,需要主管權限 This order is paid — cancelling it refunds the customer, which needs a manager or owner.',
            },
          },
          403,
        );
    }
  }

  const order = await db.order.update({ where: { id: c.req.param('id') }, data: { status: body.data.status } });
  // loyalty: award points only on the real transition INTO completed ($1 = 1 point) —
  // re-saving COMPLETED (or COMPLETED→READY→COMPLETED) must not re-award.
  // customerId is only ever set by a checkout that had the customers module, so
  // without it there is no member to credit and this is a no-op, not a debt.
  if (body.data.status === 'COMPLETED' && prior?.status !== 'COMPLETED' && order.customerId) {
    await offers.earnPoints?.(db, order.customerId, Math.floor(order.totalCents / 100));
  }
  // a canceled order must never be silent — the customer is waiting for food.
  // And a board-cancel of a PAID order must make the customer whole through the
  // SAME restitution path as the refund route: card refunded, gift restored,
  // coupon released, loyalty returned (audit dining#1 / commerce#1).
  if (body.data.status === 'CANCELED') {
    // a COMPLETED order also gives back the points it earned (audit dining#13)
    if (prior?.status === 'COMPLETED') await reverseEarnedPoints(db, order.id);
    /* A partly refunded card still owes the rest, and restitution's refundCard
       only claims a whole SUCCEEDED row — so without this a canceled ticket that
       had one dish refunded earlier would keep the other five dishes' money. */
    let rest = { cents: 0, ok: true, message: undefined as string | undefined };
    if (priorPayment?.status === 'PARTIALLY_REFUNDED' && cardLeft > 0) {
      const out = await refundPayment(priorPayment.id);
      rest = out.ok ? { cents: out.cents, ok: true, message: undefined } : { cents: 0, ok: false, message: out.message ?? 'Refund failed' };
    }
    const restituted = await restituteOrder(db, order.id, refundIntent);
    const r = {
      ...restituted,
      cardCents: restituted.cardCents + rest.cents,
      // the board reads ok — a remainder we could not return must not read green
      ok: restituted.ok && rest.ok,
      failMessage: restituted.failMessage ?? rest.message,
    };
    const business = await db.business.findFirstOrThrow();
    const parts: string[] = [];
    if (r.cardCents > 0) parts.push(`${money(r.cardCents)} refunded to your card`);
    if (r.giftCents > 0) parts.push(`${money(r.giftCents)} back on your gift card`);
    if (r.loyaltyPoints > 0) parts.push(`${r.loyaltyPoints} loyalty points returned`);
    const refundLine = parts.length ? ` ${parts.join(', ')}.` : '';
    if (order.contactPhone)
      await sendSms(order.contactPhone, `${business.name} — Sorry, order ${order.code} was canceled.${refundLine} Call us at ${business.phone} with any questions.`);
    if (order.contactEmail)
      await sendEmail(
        order.contactEmail,
        `Order ${order.code} canceled — ${business.name}`,
        emailShell(business.name, `Order ${order.code} canceled`, [
          `We're sorry — this order was canceled. Questions? Call ${business.phone}.`,
          ...(r.cardCents > 0 ? [`${money(r.cardCents)} was refunded to your card. Card refunds can take 5–10 business days.`] : []),
          ...(r.giftCents > 0 ? [`${money(r.giftCents)} is back on your gift card, ready to use.`] : []),
          ...(r.loyaltyPoints > 0 ? [`${r.loyaltyPoints} loyalty points were returned to your account.`] : []),
        ]),
      );
    // the board reads restitution.ok — a failed card refund must be visible,
    // and the order stays refundable from the detail modal
    return c.json({ ...order, restitution: r });
  }
  if (body.data.status === 'READY' || body.data.status === 'COMPLETED') {
    const business = await db.business.findFirstOrThrow();
    // pickup-ready text — US customers watch their phone, not their inbox
    if (body.data.status === 'READY' && order.contactPhone)
      await sendSms(order.contactPhone, `${business.name} — Order ${order.code} is ready for pickup!`);
    if (order.contactEmail) {
      await sendEmail(
        order.contactEmail,
        `Order ${order.code} is ${body.data.status.toLowerCase()} — ${business.name}`,
        emailShell(business.name, `Order ${order.code}`, [
          body.data.status === 'READY' ? 'Your order is ready for pickup!' : 'Thanks — see you next time!',
        ]),
      );
      // a completed order is the moment to ask for a Google review — once per
      // order (the order code in the subject makes NotificationLog the ledger)
      const google = site.business.socials?.google;
      if (body.data.status === 'COMPLETED' && google) {
        const subject = `Enjoyed order ${order.code}? Leave us a review`;
        if (!(await db.notificationLog.findFirst({ where: { subject } }))) {
          await sendEmail(
            order.contactEmail,
            subject,
            emailShell(business.name, 'How did we do?', [
              `Thanks for choosing ${business.name}! A quick review helps our small business more than you know.`,
              `<a href="${google}" style="font-weight:700">Review us on Google</a>`,
              `Or share your thoughts on our site: <a href="${getSiteUrl()}/reviews">${getSiteUrl()}/reviews</a>`,
            ]),
          );
        }
      }
    }
  }
  return c.json(order);
});

routes.post('/orders/:id/quote-approval', async (c) => {
  const body = z
    .object({ amountCents: z.number().int().min(0), note: z.string().max(500).optional() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const current = await db.order.findUnique({ where: { id: c.req.param('id') } });
  if (!current) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  // no email on file = no delivery channel. Say so instead of a fake success —
  // the UI offers copy-to-clipboard for a phone call instead (audit leads#2)
  if (!current.contactEmail)
    return c.json({ error: { code: 'NO_EMAIL', message: 'This customer left no email. Call them instead.' } }, 400);
  // MERGE quoteMeta: the customer's uploaded photos and service/vehicle details
  // captured at submit must survive the estimate (audit leads#3)
  const meta = (current.quoteMeta ?? {}) as Record<string, unknown>;
  const order = await db.order.update({
    where: { id: current.id },
    data: {
      totalCents: body.data.amountCents,
      subtotalCents: body.data.amountCents,
      quoteMeta: { ...meta, estimatedCents: body.data.amountCents, note: body.data.note, sentAt: new Date().toISOString() },
    },
  });
  const business = await db.business.findFirstOrThrow();
  // the platform tracks the estimate from this moment (estimate.sent, §5.4);
  // fire-and-forget — sending the estimate never waits on the platform
  await offers.platformEmit?.(db, 'estimate.sent', {
    orderId: order.id, estimateCents: body.data.amountCents,
    contactName: order.contactName, phone: order.contactPhone, email: order.contactEmail,
  });
  await sendEmail(
    order.contactEmail!,
    `Your estimate from ${business.name} — ${order.code}`,
    emailShell(business.name, `Estimate: ${money(body.data.amountCents)}`, [
      body.data.note ?? '',
      // the closed loop (§5.4): one tap to view, accept, and put a deposit down
      `<a href="${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/estimate/${order.accessToken}">View & accept your estimate →</a>`,
      `Or reply to this email / call ${business.phone}.`,
    ].filter(Boolean)),
  );
  return c.json(order);
});

/* ── POS ── */

/* Terminals (registers/stations): Settings manages the list, each POS device
   picks which one it is, Z-reports break totals down per terminal. Rename or
   deactivate only — no delete, so historical orders keep their station name. */
const TerminalBody = z.object({ name: z.string().min(1).max(40), active: z.boolean().optional() });

routes.get('/terminals', async (c) =>
  c.json({ terminals: await db.terminal.findMany({ orderBy: { createdAt: 'asc' } }) }));
routes.post('/terminals', async (c) => {
  const body = TerminalBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  return c.json(await db.terminal.create({ data: body.data }));
});
routes.patch('/terminals/:id', async (c) => {
  const body = TerminalBody.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  return c.json(await db.terminal.update({ where: { id: c.req.param('id') }, data: body.data }));
});

routes.route('/pos', posRoutes);
