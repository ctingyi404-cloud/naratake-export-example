/* payments' side of a void: give the card charge back.

   The atomic claim is why this is safe to run twice. Whoever flips
   SUCCEEDED -> REFUNDED owns the provider call; a concurrent void sees count 0
   and never charges back a second time. The network round trip stays outside
   every transaction — holding a write lock across it would stall the single
   writer on SQLite — and a failed refund hands the claim back so the order
   stays exactly as refundable as it was.

   Plus what payments OFFERS the reports screen: how a window's sales were
   tendered. Only this module knows what a Payment row is, so a site that takes
   no payments shows no cash/card split rather than a donut of zeroes. */

import type { PrismaClient } from '@prisma/client';
import { db } from '../db';
import { registerOffers, registerRestitution } from '../hooks';
import { createIntent, intentConsumed, paymentsConfig, recordPayment, refundIntent, refundIntentSafe, verifyIntent } from '../payments';

registerRestitution({
  async refundCard(db: PrismaClient, paymentId: string, refund: (externalId: string) => Promise<void>) {
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== 'SUCCEEDED' || !payment.externalId) return 0;

    const claim = await db.payment.updateMany({
      where: { id: payment.id, status: 'SUCCEEDED' },
      data: { status: 'REFUNDED' },
    });
    if (claim.count === 0) return 0;

    try {
      await refund(payment.externalId);
    } catch (e) {
      await db.payment.updateMany({
        where: { id: payment.id, status: 'REFUNDED' },
        data: { status: 'SUCCEEDED' },
      });
      throw e;
    }
    return payment.amountCents; // amountCents already includes tip
  },
});

registerOffers({
  paymentsConfig,
  /* payment mix: POS_CASH = cash; TERMINAL/ONLINE = card */
  async paymentMix(db: PrismaClient, orderIds: string[]) {
    const payments = await db.payment.findMany({
      where: { orderId: { in: orderIds }, status: 'SUCCEEDED' },
      select: { kind: true, amountCents: true, tipCents: true },
    });
    let cashCents = 0;
    let cardCents = 0;
    for (const p of payments) {
      // amountCents is already tip-inclusive (recordPayment stores the full total) —
      // adding tipCents again double-counted the tip in the cash/card split
      if (p.kind === 'POS_CASH') cashCents += p.amountCents;
      else cardCents += p.amountCents;
    }
    return { cashCents, cardCents };
  },
});

registerOffers({
  // the deposit seam appointments consumes (see lib/hooks.ts) — registering it
  // here is what makes "appointments without payments" a working site instead
  // of a pile of dangling imports
  depositPayments: {
    createIntent, verifyIntent, refundIntent, refundIntentSafe, intentConsumed, recordPayment,
    async refundStranded(externalId: string, paymentId: string) {
      await refundIntent(externalId);
      await db.payment.update({ where: { id: paymentId }, data: { status: 'REFUNDED' } });
    },
    async paymentStatusByIds(ids: string[]) {
      if (!ids.length) return {};
      const rows = await db.payment.findMany({ where: { id: { in: ids } } });
      return Object.fromEntries(rows.map((r) => [r.id, r.status]));
    },
  },
});
