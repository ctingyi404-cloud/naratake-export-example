/* Pure per-terminal Z-report math — no DB, no I/O, fully unit-testable.
   server/pos.ts resolves the shift's orders / payments / terminal names and
   calls zReport(); golden cases live in test/zreport.test.ts.

   Money integrity invariant: every order lands in exactly ONE bucket (its
   terminalId, or the null "unassigned" bucket for legacy orders rung before
   terminals existed), and the combined totals are computed AS the sum of the
   buckets — so per-terminal always reconciles to combined to the exact
   integer cent, by construction.

   Truth rules:
   - CANCELED orders stay OUT of the sales totals, but their CASH tender is
     reported separately (kept in drawer vs refunded) so the drawer count
     reconciles with reality instead of showing a phantom over/short.
   - Gift-card tender gets its own line: order totals are post-gift, so
     without it the redeemed value would silently vanish from the report.
   - REFUNDED payment rows never count as money held. */

export interface ZOrderInput {
  id: string;
  terminalId: string | null;
  totalCents: number;
  taxCents: number;
  tipCents: number;
  /** order status — 'CANCELED' moves the order to the canceled lines */
  status?: string;
  /** gift-card tender redeemed on this order (order.giftAppliedCents) */
  giftAppliedCents?: number;
}

export interface ZPaymentInput {
  orderId: string | null;
  kind: string; // POS_CASH → cash, anything else → card
  amountCents: number;
  /** payment status — 'REFUNDED' means the money went back out */
  status?: string;
}

export interface ZTotals {
  orders: number;
  grossCents: number;
  taxCents: number;
  tipsCents: number;
  cashCents: number;
  cardCents: number;
  /** gift-card value redeemed as tender on active orders */
  giftCents: number;
  /** board-canceled sales in this window (excluded from the totals above) */
  canceledOrders: number;
  /** cash from canceled sales still sitting in the drawer —
      expected drawer = opening + cashCents + canceledCashKeptCents */
  canceledCashKeptCents: number;
  /** cash from canceled sales handed back to the customer */
  canceledCashRefundedCents: number;
}

export interface ZBucket extends ZTotals {
  terminalId: string | null; // null = unassigned (no station picked / legacy)
  name: string;
}

const EMPTY: ZTotals = {
  orders: 0,
  grossCents: 0,
  taxCents: 0,
  tipsCents: 0,
  cashCents: 0,
  cardCents: 0,
  giftCents: 0,
  canceledOrders: 0,
  canceledCashKeptCents: 0,
  canceledCashRefundedCents: 0,
};

export function zReport(
  orders: ZOrderInput[],
  payments: ZPaymentInput[],
  terminalNames: Map<string, string>,
): { combined: ZTotals; byTerminal: ZBucket[] } {
  const buckets = new Map<string | null, ZBucket>();
  const bucket = (terminalId: string | null): ZBucket => {
    let b = buckets.get(terminalId);
    if (!b) {
      b = { terminalId, name: (terminalId && terminalNames.get(terminalId)) || 'Unassigned', ...EMPTY };
      buckets.set(terminalId, b);
    }
    return b;
  };

  const terminalOf = new Map(orders.map((o) => [o.id, o.terminalId] as const));
  const canceled = new Set(orders.filter((o) => o.status === 'CANCELED').map((o) => o.id));
  for (const o of orders) {
    const b = bucket(o.terminalId);
    if (o.status === 'CANCELED') {
      b.canceledOrders += 1;
      continue;
    }
    b.orders += 1;
    b.grossCents += o.totalCents;
    b.taxCents += o.taxCents;
    b.tipsCents += o.tipCents;
    b.giftCents += o.giftAppliedCents ?? 0;
  }
  for (const p of payments) {
    // money only counts through the shift's own orders — an orphan payment
    // must not invent a bucket or skew a terminal's tender split
    if (!p.orderId || !terminalOf.has(p.orderId)) continue;
    const b = bucket(terminalOf.get(p.orderId)!);
    if (canceled.has(p.orderId)) {
      // canceled sale: card refunds settle in Stripe, but CASH is drawer truth
      if (p.kind === 'POS_CASH') {
        if (p.status === 'REFUNDED') b.canceledCashRefundedCents += p.amountCents;
        else b.canceledCashKeptCents += p.amountCents;
      }
      continue;
    }
    if (p.status === 'REFUNDED') continue; // refunded tender is not money held
    if (p.kind === 'POS_CASH') b.cashCents += p.amountCents;
    else b.cardCents += p.amountCents;
  }

  // stations in their registration order, the unassigned legacy bucket last
  const ids = [...terminalNames.keys()];
  const rank = (b: ZBucket) =>
    b.terminalId === null ? ids.length + 1 : Math.max(0, ids.indexOf(b.terminalId));
  const byTerminal = [...buckets.values()].sort((a, b) => rank(a) - rank(b));

  const combined = byTerminal.reduce<ZTotals>(
    (s, b) => ({
      orders: s.orders + b.orders,
      grossCents: s.grossCents + b.grossCents,
      taxCents: s.taxCents + b.taxCents,
      tipsCents: s.tipsCents + b.tipsCents,
      cashCents: s.cashCents + b.cashCents,
      cardCents: s.cardCents + b.cardCents,
      giftCents: s.giftCents + b.giftCents,
      canceledOrders: s.canceledOrders + b.canceledOrders,
      canceledCashKeptCents: s.canceledCashKeptCents + b.canceledCashKeptCents,
      canceledCashRefundedCents: s.canceledCashRefundedCents + b.canceledCashRefundedCents,
    }),
    { ...EMPTY },
  );
  return { combined, byTerminal };
}

/* ── shift reporting ──────────────────────────────────────────────────────
   These lived in lib/payments.ts and imported THIS file, which pointed a
   payments-owned module at an orders-owned one. A site with card payments but
   no register (a gym selling memberships) therefore dropped zreport, then
   payments.ts, then payments.hooks, then hooks-init — and the import closure
   took the whole API layer down with it, silently, because nothing dangles
   when everything downstream disappears together. The direction is legal this
   way round: orders REQUIRES payments, so the register may reach for a payment
   primitive; payments must never reach for the register. */

import { isSimulatedTender } from './payments';

export interface ShiftTender {
  combined: ZTotals & { simulatedCardCents: number };
  byTerminal: (ZBucket & { simulatedCardCents: number })[];
}
/** A shift's Z-report with simulated charges pulled OUT of the card totals and
    reported on their own line.

    zReport stays the one implementation of the money math: this runs it over
    the SAME orders twice with the payment rows partitioned, so per-terminal
    still sums to combined by construction and there is no second summation to
    disagree with the first. */
export function shiftTender(
  orders: ZOrderInput[],
  payments: (ZPaymentInput & { provider: string })[],
  terminalNames: Map<string, string>,
): ShiftTender {
  const settling = zReport(orders, payments.filter((p) => !isSimulatedTender(p)), terminalNames);
  const simulated = zReport(orders, payments.filter(isSimulatedTender), terminalNames);
  const simCard = new Map(simulated.byTerminal.map((b) => [b.terminalId, b.cardCents]));
  return {
    combined: { ...settling.combined, simulatedCardCents: simulated.combined.cardCents },
    byTerminal: settling.byTerminal.map((b) => ({ ...b, simulatedCardCents: simCard.get(b.terminalId) ?? 0 })),
  };
}

export interface UnresolvedTender {
  /** payment rows with no final answer yet (PENDING, FLAGGED, …) */
  pendingPayments: number;
  /** sales in the window that recorded no tender at all */
  salesWithoutPayment: number;
  count: number;
}

/** Money in flight at close time. Closing a drawer on top of one of these means
    the counted cash is not the whole truth — worth a warning, never a block: a
    shop has to be able to go home. */
export function unresolvedTender(
  orders: { id: string; status?: string }[],
  payments: { orderId: string | null; status: string }[],
): UnresolvedTender {
  const settled = new Set(['SUCCEEDED', 'REFUNDED', 'FAILED']);
  const tendered = new Set(payments.map((p) => p.orderId));
  const pendingPayments = payments.filter((p) => p.orderId && !settled.has(p.status)).length;
  const salesWithoutPayment = orders.filter((o) => o.status !== 'CANCELED' && !tendered.has(o.id)).length;
  return { pendingPayments, salesWithoutPayment, count: pendingPayments + salesWithoutPayment };
}

