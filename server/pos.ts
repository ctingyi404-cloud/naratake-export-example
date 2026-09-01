/* In-store POS: ring up orders, take cash or card-present payments, and run
   shift Z-reports. Stripe Terminal is used when configured; otherwise a
   simulated reader keeps the whole flow testable. */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { createOrderWithSeqRetry } from '@/lib/order-code';
import {
  abandonTerminalCharge,
  intentConsumed,
  mockChargeAmount,
  refundIntentSafe,
  startTerminalCharge,
  terminalChargeStatus,
  terminalReady,
  verifyIntent,
} from '@/lib/payments';
import { runLadder, type ClaimStep } from '@/lib/tender-ladder';
import { shiftTender, unresolvedTender, type UnresolvedTender } from '@/lib/zreport';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';
import { buildQuote } from './quote';

export const posRoutes = new Hono();

/* A real card-present charge needs BOTH the secret key and a reader id; with
   only a reader id the collect route SIMULATES, so recording STRIPE would be
   phantom revenue. One gate, shared with paymentsConfig so the back office and
   the register can never disagree about whether a reader exists. */
const canChargeTerminal = terminalReady;

/* ── shifts ── */

/* One shift window → per-terminal Z-report (pure math in lib/zreport.ts).
   Per-terminal buckets sum exactly to the combined totals, integer cents.

   Window design (the simple honest one): a shift's window starts at the
   PREVIOUS closed shift's close time, not at its own openedAt — so a sale
   rung between shifts lands in the NEXT closed shift instead of vanishing
   from every report. The first shift ever reaches back to the beginning of
   time for the same reason. CANCELED orders ride along so the report can
   show canceled cash (kept in drawer vs refunded); zReport keeps them out
   of the sales totals. */
async function shiftReport(openedAt: Date) {
  const prev = await db.posShift.findFirst({
    where: { closedAt: { not: null, lte: openedAt } },
    orderBy: { closedAt: 'desc' },
  });
  const since = prev?.closedAt ?? new Date(0);
  const orders = await db.order.findMany({
    where: { type: 'POS', createdAt: { gte: since } },
  });
  const payments = await db.payment.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
  });
  const terminals = await db.terminal.findMany({ orderBy: { createdAt: 'asc' } });
  return {
    // simulated register charges are reported on their own line instead of
    // inflating card revenue that Stripe will never pay out (lib/payments)
    ...shiftTender(orders, payments, new Map(terminals.map((t) => [t.id, t.name]))),
    unresolved: unresolvedTender(orders, payments),
  };
}

/* optional single-station view: terminalId=<id>, or 'unassigned' for legacy orders */
const terminalFilter = <B extends { terminalId: string | null }>(q: string | undefined, byTerminal: B[]) =>
  q ? { filtered: byTerminal.find((b) => (b.terminalId ?? 'unassigned') === q) ?? null } : {};

/* Warn, never block: the drawer still has to be counted and the door still has
   to be locked. This only stops the number leaving in silence. */
const unresolvedWarning = (u: UnresolvedTender) =>
  `結班時仍有 ${u.count} 筆款項未結清(付款未有最終結果 ${u.pendingPayments}、沒有付款紀錄的交易 ${u.salesWithoutPayment}),請先在 Stripe 後台核對再相信今天的卡款數字 Closed with ${u.count} unresolved payment(s): ${u.pendingPayments} still awaiting a final answer and ${u.salesWithoutPayment} sale(s) with no tender recorded. Check them in the Stripe dashboard before trusting today's card total.`;

posRoutes.get('/shifts/current', async (c) => {
  const shift = await db.posShift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: 'desc' } });
  if (!shift) return c.json({ shift: null });
  const { combined, byTerminal, unresolved } = await shiftReport(shift.openedAt);
  return c.json({
    shift,
    live: combined,
    byTerminal,
    unresolved,
    ...terminalFilter(c.req.query('terminalId'), byTerminal),
  });
});

posRoutes.post('/shifts/open', async (c) => {
  const body = z.object({ openingCashCents: z.number().int().min(0) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const existing = await db.posShift.findFirst({ where: { closedAt: null } });
  if (existing) return c.json({ error: { code: 'CONFLICT', message: 'A shift is already open' } }, 409);
  return c.json(await db.posShift.create({ data: { openingCashCents: body.data.openingCashCents } }));
});

posRoutes.post('/shifts/close', async (c) => {
  const body = z
    .object({
      closingCashCents: z.number().int().min(0),
      terminalId: z.string().optional(),
      /* How many unresolved payments the operator was looking at when they
         chose to close anyway. Sent only by the override path, and checked
         against the live count — an acknowledgement of two cannot silently
         cover a third that arrived while the dialog was open. */
      acknowledgedUnresolved: z.number().int().min(0).optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const shift = await db.posShift.findFirst({ where: { closedAt: null }, orderBy: { openedAt: 'desc' } });
  if (!shift) return c.json({ error: { code: 'NOT_FOUND', message: 'No open shift' } }, 404);

  const { combined, byTerminal, unresolved } = await shiftReport(shift.openedAt);

  /* Money in flight blocks the close. A payment in `processing` settles within
     seconds, and letting one slip past the close leaves a hole in the books
     that nothing later reconciles.

     The register disables its own button, but a second tab, a stale page or a
     direct API call walks straight past a client-side gate — so the refusal
     lives here. A shop must still be able to go home, so the override is a
     deliberate second action that names the number and is RECORDED with the
     person who made it: a control nobody is accountable for is not a control. */
  if (unresolved.count > 0 && body.data.acknowledgedUnresolved !== unresolved.count) {
    return c.json(
      {
        error: {
          code: 'UNRESOLVED_PAYMENTS',
          message: unresolvedWarning(unresolved),
        },
        unresolved,
      },
      409,
    );
  }
  // canceled cash the drawer kept still sits in the drawer — count it, or every
  // board-canceled cash sale shows up as a phantom overage at close
  const expectedDrawerCents = shift.openingCashCents + combined.cashCents + combined.canceledCashKeptCents;
  const totals = {
    ...combined,
    // the cash drawer is per shift, not per station — drawer math stays combined
    expectedDrawerCents,
    countedDrawerCents: body.data.closingCashCents,
    overShortCents: body.data.closingCashCents - expectedDrawerCents,
    byTerminal,
  };
  const closed = await db.posShift.update({
    where: { id: shift.id },
    // Prisma's InputJsonValue rejects typed arrays (ZBucket[] has no index
    // signature) — round-trip through JSON to hand it a plain value
    data: {
      closedAt: new Date(),
      closingCashCents: body.data.closingCashCents,
      totals: JSON.parse(JSON.stringify({
        ...totals,
        // the override, on the shift row itself, so a later reader can see that
        // this close was forced and by whom rather than inferring it
        ...(unresolved.count > 0
          ? { forcedClose: { unresolvedCount: unresolved.count, by: (c.get('actor' as never) as string | undefined) ?? 'unknown', at: new Date().toISOString() } }
          : {}),
      })),
    },
  });
  return c.json({
    shift: closed,
    totals,
    // money still in flight: it BLOCKS the close above unless explicitly
    // acknowledged, and the acknowledgement is recorded on the shift
    unresolved,
    ...(unresolved.count > 0 ? { warning: unresolvedWarning(unresolved) } : {}),
    ...terminalFilter(body.data.terminalId, byTerminal),
  });
});

/* ── shared cart shape ── */

const PosCart = z.object({
  items: z.array(z.object({ itemId: z.string(), qty: z.number().int().min(1), modifiers: z.array(z.string()).default([]) })).min(1),
  discountCents: z.number().int().min(0).default(0),
  tipCents: z.number().int().min(0).default(0),
  giftCardCode: z.string().optional(), // "read it out in store" — the register takes the card
  // bookings → POS handoff: credit the appointment's already-paid deposit as tender
  depositCredit: z.object({ appointmentId: z.string(), cents: z.number().int().min(1) }).optional(),
});

const PosOrder = PosCart.extend({
  payment: z.object({
    method: z.enum(['cash', 'terminal']),
    tenderedCents: z.number().int().optional(),
    /* The register mints this before it sends, so a CASH sale that dies in
       flight can be settled instead of guessed at. A terminal sale already had
       one — the intent id — which is why only cash needed this. */
    idempotencyKey: z.string().min(8).max(80).optional(),
    terminalExternalId: z.string().optional(),
    terminalChargedCents: z.number().int().optional(), // what the reader actually took
  }),
  staffId: z.string().optional(), // who performed the service / rang the sale
  terminalId: z.string().optional(), // which register/station rang it (per-terminal Z-reports)
  note: z.string().max(200).optional(),
});

/* Shared register pricing: manual discount reduces the taxable base like a coupon —
   allocated onto the taxable lines only (same math as quote.ts). Deposit credit and
   gift tender are read-only here (the /orders route does the atomic claims). */
async function pricePos(input: z.infer<typeof PosCart>) {
  const quote = await buildQuote({ items: input.items, mode: 'pickup', tipCents: input.tipCents });
  const discount = Math.min(input.discountCents, quote.subtotalCents);
  const business = await db.business.findFirstOrThrow();
  const taxableSub = quote.lines.reduce((s, l) => (l.taxable ? s + l.lineCents : s), 0);
  const taxBase = quote.subtotalCents > 0
    ? Math.max(0, taxableSub - Math.round((discount * taxableSub) / quote.subtotalCents))
    : 0;
  const tax = Math.round((taxBase * business.taxRateBp) / 10000);
  let total = Math.max(0, quote.subtotalCents - discount) + tax + input.tipCents;

  // deposit credit first: money already paid for THIS booking; gift covers the rest
  let depositApplied = 0;
  let depositError: string | undefined;
  if (input.depositCredit) {
    // the deposit belongs to appointments; without that module the register has
    // no booking to credit, which is a refusal the cashier can read
    const out = (await offers.depositTender?.quote(db, input.depositCredit.appointmentId, input.depositCredit.cents, total))
      ?? { appliedCents: 0, error: 'Deposits are not enabled on this site' };
    depositApplied = out.appliedCents;
    depositError = out.error;
    total -= depositApplied;
  }

  let giftApplied = 0;
  let giftError: string | undefined;
  const giftCode = input.giftCardCode?.toUpperCase().trim() || undefined;
  if (giftCode) {
    const card = await db.giftCard.findUnique({ where: { code: giftCode } });
    if (!card || !card.active || card.balanceCents <= 0) giftError = 'Invalid or empty gift card';
    else {
      giftApplied = Math.min(card.balanceCents, total);
      total -= giftApplied;
    }
  }
  return { quote, business, discount, tax, total, giftApplied, giftCode, giftError, depositApplied, depositError };
}

/* price preview for the register — the card terminal must charge the total AFTER
   deposit credit and gift tender, and only the server knows both balances */
posRoutes.post('/quote', async (c) => {
  const body = PosOrder.omit({ payment: true }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  const p = await pricePos(body.data);
  if (p.giftError) return c.json({ error: { code: 'VALIDATION', message: p.giftError } }, 400);
  if (p.depositError) return c.json({ error: { code: 'VALIDATION', message: p.depositError } }, 400);
  return c.json({
    subtotalCents: p.quote.subtotalCents,
    discountCents: p.discount,
    taxCents: p.tax,
    depositAppliedCents: p.depositApplied,
    giftAppliedCents: p.giftApplied,
    totalCents: p.total,
  });
});

/* ── terminal (card-present) ──────────────────────────────────────────────

   Three routes for ONE physical charge:

     POST /terminal/start    → dispatch to the reader, return the intent id
     GET  /terminal/status   → one non-blocking look at that id
     POST /terminal/abandon  → clear the reader and cancel the authorisation

   POST /terminal/collect keeps the single-call shape the register ships with
   today: it is the three above composed, not a second implementation.

   Why the split exists at all: collect holds an HTTP connection open for ~45s
   waiting for a human to present a card, and a serverless platform is free to
   kill the function before that (route.ts now declares maxDuration for exactly
   this reason). A killed request took the intent id with it and left the
   authorisation alive with nobody to cancel it. With start + status the id is
   in the caller's hands from the first millisecond, a dropped browser costs
   nothing, and recovery is just asking status again — so the register UI should
   move to the two-step flow and stop depending on one long request. */

const POLL_MS = 2000;
const POLL_TICKS = 22; // ~45s at the reader
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIMEOUT_CANCELED =
  '讀卡機逾時,授權已取消,顧客未被扣款,可重新結帳 Reader timed out. The authorisation was canceled — nothing was taken — you can ring it up again.';

/* Modelled on manualVoid below: a cashier must never be left with money in
   limbo and no id to chase it with. */
const stuckCharge = (id: string) =>
  `讀卡機逾時,且無法取消授權 ${id},請勿重新結帳。請按「撤銷上一筆刷卡」,或在 Stripe 後台取消/退款後再收款 Reader timed out and authorisation ${id} could NOT be canceled. Do NOT re-ring this sale. Press "Void last charge", or cancel/refund ${id} in the Stripe dashboard, before charging the customer again.`;

/** The simulated reader — keeps the full POS flow testable with zero hardware.
    The cents ride inside the id so ring-up can verify the amount exactly like
    Stripe does, and `simulated` is what keeps it out of card revenue. */
const mockCharge = (amountCents: number) => ({
  status: 'succeeded' as const,
  provider: 'MOCK' as const,
  simulated: true,
  chargedCents: amountCents,
  externalId: `mock_term_${amountCents}_${randomBytes(5).toString('hex')}`,
});

type ReaderAmount =
  | { amountCents: number }
  | { free: true }
  | { code: 'VALIDATION' | 'PAYMENT_REQUIRED'; message: string };

/** What the reader must charge: the EXACT total the order will record — same
    pricing helper as POST /orders (taxable-line tax base + deposit credit +
    gift tender), so the Stripe charge always reconciles with order.totalCents.

    A deposit / gift card / discount can zero the total. Charging the 50¢ Stripe
    floor here while /orders records $0 makes the ledger diverge, so a $0 order
    takes no card charge at all. */
async function readerAmount(raw: unknown): Promise<ReaderAmount> {
  const body = PosCart.safeParse(raw);
  if (!body.success) return { code: 'VALIDATION', message: '交易資料無效 Invalid sale.' };
  const priced = await pricePos(body.data);
  if (priced.giftError) return { code: 'VALIDATION', message: priced.giftError };
  if (priced.depositError) return { code: 'VALIDATION', message: priced.depositError };
  if (priced.total <= 0) return { free: true };
  if (priced.total < 50)
    return { code: 'PAYMENT_REQUIRED', message: '刷卡最低 $0.50,請收現金 Card minimum is $0.50 — take cash for this amount.' };
  return { amountCents: priced.total };
}

/** nothing to charge: report it as a settled $0 so /orders can verify parity */
const NO_CHARGE = { status: 'succeeded', provider: 'NONE', externalId: null, chargedCents: 0 } as const;

posRoutes.post('/terminal/start', async (c) => {
  const amt = await readerAmount(await c.req.json());
  if ('code' in amt) return c.json({ error: amt }, amt.code === 'VALIDATION' ? 400 : 402);
  if ('free' in amt) return c.json(NO_CHARGE);
  if (!terminalReady()) return c.json(mockCharge(amt.amountCents));
  const externalId = await startTerminalCharge(amt.amountCents);
  return c.json({ status: 'pending', provider: 'STRIPE', externalId, chargedCents: amt.amountCents });
});

posRoutes.get('/terminal/status', async (c) => {
  const externalId = c.req.query('externalId');
  if (!externalId) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const check = await terminalChargeStatus(externalId);
  if (check.state === 'unknown')
    return c.json({ error: { code: 'NOT_FOUND', message: '找不到這筆刷卡 Unknown card charge id.' } }, 404);
  return c.json({ status: check.state, provider: 'STRIPE', externalId, chargedCents: check.chargedCents });
});

/* Give up on a charge that will not become a sale. Safe for a cashier to press:
   it can only cancel an authorisation that never captured, never refund one
   that did, and never touch a charge that already backs a recorded sale. */
posRoutes.post('/terminal/abandon', async (c) => {
  const body = z.object({ externalId: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  if (await intentConsumed(body.data.externalId))
    return c.json({ status: 'recorded', externalId: body.data.externalId });
  const out = await abandonTerminalCharge(body.data.externalId);
  if (out.state === 'stuck')
    return c.json({ error: { code: 'PAYMENT_REQUIRED', message: stuckCharge(body.data.externalId), terminalExternalId: body.data.externalId } }, 402);
  return c.json(
    out.state === 'succeeded'
      ? { status: 'succeeded', provider: 'STRIPE', externalId: body.data.externalId, chargedCents: out.chargedCents }
      : { status: 'canceled', externalId: body.data.externalId },
  );
});

posRoutes.post('/terminal/collect', async (c) => {
  const amt = await readerAmount(await c.req.json());
  if ('code' in amt) return c.json({ error: amt }, amt.code === 'VALIDATION' ? 400 : 402);
  if ('free' in amt) return c.json(NO_CHARGE);
  const amountCents = amt.amountCents;

  if (!terminalReady()) {
    await sleep(1200); // the pause a real reader would have taken
    return c.json(mockCharge(amountCents));
  }

  const externalId = await startTerminalCharge(amountCents);
  for (let i = 0; i < POLL_TICKS; i++) {
    await sleep(POLL_MS);
    const check = await terminalChargeStatus(externalId);
    if (check.state === 'succeeded')
      return c.json({ status: 'succeeded', provider: 'STRIPE', externalId, chargedCents: check.chargedCents });
    if (check.state === 'canceled')
      return c.json({ error: { code: 'PAYMENT_REQUIRED', message: '讀卡機已取消 Reader canceled' } }, 402);
  }

  /* Timed out. The old code returned 402 here and walked away, leaving whatever
     the reader had authorised alive with no id recorded anywhere. */
  const out = await abandonTerminalCharge(externalId);
  if (out.state === 'succeeded')
    return c.json({ status: 'succeeded', provider: 'STRIPE', externalId, chargedCents: out.chargedCents });
  if (out.state === 'canceled')
    return c.json({ error: { code: 'PAYMENT_REQUIRED', message: TIMEOUT_CANCELED } }, 402);
  return c.json(
    { error: { code: 'PAYMENT_REQUIRED', message: stuckCharge(externalId), terminalExternalId: externalId } },
    402,
  );
});

/* Explicit "void last charge" for the cashier: used when an auto-void failed,
   or the register died between collect and ring-up. Never claws back a charge
   that already backs a recorded sale. */
posRoutes.post('/terminal/void', async (c) => {
  const body = z.object({ externalId: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  if (await intentConsumed(body.data.externalId)) {
    const refunded = await db.payment.findFirst({ where: { externalId: body.data.externalId, status: 'REFUNDED' } });
    return c.json({ voided: false, already: refunded ? 'VOIDED' : 'RECORDED' });
  }
  return c.json({ voided: await refundIntentSafe(body.data.externalId) });
});

/* ── ring up an order ── */

const AUTO_VOID = '已自動退刷 Card auto-voided, re-ring when ready.';
const manualVoid = (id: string) =>
  `無法自動退刷,請按「撤銷上一筆刷卡」或在 Stripe 後台退款,退刷前請勿重新結帳 Auto-void FAILED for charge ${id}. Use "Void last charge" or refund it in the Stripe dashboard, and do not re-ring until it is voided.`;

/* Every reject AFTER the reader charged must hand the card charge back —
   refundIntentSafe never touches an intent that already backs a recorded
   payment, so a raced double-submit can't claw back a legit sale. When the
   auto-void itself fails, say so loudly (intent id + manual instruction),
   never silently. */
async function rejectRingUp(
  c: Context,
  status: 400 | 402 | 409 | 500,
  code: string,
  message: string,
  terminalExternalId?: string | null,
) {
  if (!terminalExternalId) return c.json({ error: { code, message } }, status);
  const voided = await refundIntentSafe(terminalExternalId);
  return c.json(
    {
      error: {
        code,
        message: `${message} ${voided ? AUTO_VOID : manualVoid(terminalExternalId)}`,
        terminalExternalId,
        voided,
      },
    },
    status,
  );
}

posRoutes.post('/orders', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | { payment?: { terminalExternalId?: unknown } }
    | null;
  const rawExt = typeof raw?.payment?.terminalExternalId === 'string' ? raw.payment.terminalExternalId : undefined;
  const body = PosOrder.safeParse(raw);
  if (!body.success) return rejectRingUp(c, 400, 'VALIDATION', '交易資料無效 Invalid sale.', rawExt);
  const input = body.data;
  const extId = input.payment.method === 'terminal' ? input.payment.terminalExternalId : undefined;

  /* Replay of a sale we already recorded. The offline queue re-sends anything it
     could not confirm, which is the correct behaviour — the register counted the
     change out to a customer and the books have to agree. So a repeat is not an
     error: hand back the SAME receipt and let the queue settle its entry.
     `Payment.externalId` is @unique, so this check plus the write below make the
     replay safe even when two tabs race. */
  const idemKey = input.payment.method === 'cash' ? input.payment.idempotencyKey : undefined;
  if (idemKey) {
    // two reads, not a join: Payment carries orderId as a plain column with no
    // Prisma relation, and inventing one here would be a schema change for a
    // lookup that runs at most once per sale
    const prior = await db.payment.findUnique({ where: { externalId: idemKey }, select: { orderId: true } });
    if (prior?.orderId) {
      const order = await db.order.findUnique({ where: { id: prior.orderId }, select: { code: true, totalCents: true } });
      if (order) return c.json({ code: order.code, totalCents: order.totalCents, replayed: true });
    }
  }

  const priced = await pricePos(input);
  if (priced.giftError) return rejectRingUp(c, 400, 'VALIDATION', priced.giftError, extId);
  if (priced.depositError) return rejectRingUp(c, 409, 'CONFLICT', priced.depositError, extId);
  const { quote, business, discount, tax, giftApplied, giftCode, depositApplied } = priced;
  const total = priced.total;

  // Validate the tender BEFORE burning any balance — a mistyped cash amount or a
  // terminal parity mismatch must reject with deposit and gift untouched.
  let change = 0;
  if (input.payment.method === 'cash') {
    const tendered = input.payment.tenderedCents ?? total;
    if (tendered < total) return c.json({ error: { code: 'PAYMENT_REQUIRED', message: 'Insufficient cash' } }, 402);
    change = tendered - total;
  } else {
    // the reader charged terminalChargedCents; the order must record the same, or
    // deposit/gift/price changed between collect and ring-up. Refuse the mismatch,
    // hand the charge back, and never record a total that diverges from what the
    // card was actually charged.
    if (input.payment.terminalChargedCents !== undefined && input.payment.terminalChargedCents !== total)
      return rejectRingUp(c, 409, 'CONFLICT', '金額在刷卡後變動 Amount changed since the card was charged.', extId);
    if (!extId && total > 0)
      return c.json({ error: { code: 'PAYMENT_REQUIRED', message: '請先在讀卡機刷卡 Run the card on the terminal first.' } }, 402);
    if (extId) {
      // one physical charge → exactly one recorded payment: a double-submitted
      // ring-up must not book two sales against the same swipe
      if (await intentConsumed(extId))
        return c.json({ error: { code: 'CONFLICT', message: '這筆刷卡已入帳,請勿重複結帳 This card charge is already recorded, do not re-ring.' } }, 409);
      if (canChargeTerminal()) {
        const v = await verifyIntent(extId, total);
        if (!v.ok) {
          if (v.reason === 'processing')
            return c.json({ error: { code: 'PROCESSING', message: '刷卡仍在處理中,請稍候再試(同一筆) Card still processing, wait and retry the same charge.' } }, 402);
          if (v.reason === 'mismatch')
            return rejectRingUp(c, 409, 'CONFLICT', '刷卡金額與本筆不符 Charged amount does not match this sale.', extId);
          // unpaid / unknown intent: nothing settled, nothing to void
          return c.json({ error: { code: 'PAYMENT_REQUIRED', message: '刷卡未完成,尚未入帳 Card charge not confirmed, nothing was recorded.' } }, 402);
        }
      } else if (!extId.startsWith('mock_term_')) {
        return c.json({ error: { code: 'PAYMENT_REQUIRED', message: 'Unknown terminal charge id.' } }, 402);
      } else {
        // keyless register: the simulated reader stamps what it took into the id,
        // so a total that moved between collect and ring-up is caught here too
        const took = mockChargeAmount(extId);
        if (took !== null && took !== total)
          return rejectRingUp(c, 409, 'CONFLICT', '刷卡金額與本筆不符 Charged amount does not match this sale.', extId);
      }
    }
  }

  // tender claims, in order, with reverse-order compensation (lib/tender-ladder):
  // deposit first (it belongs to this booking), then gift. Any later failure —
  // lost gift race, seq exhaustion, write error — releases everything claimed.
  const steps: ClaimStep[] = [];
  if (depositApplied > 0 && input.depositCredit) {
    const apptId = input.depositCredit.appointmentId;
    steps.push({
      claim: async () => (await offers.depositTender?.claim(db, apptId)) ?? false,
      release: async () => { await offers.depositTender?.release(db, apptId); },
      fail: { code: 'CONFLICT', message: '訂金已折抵過 Deposit already credited on another sale.' },
    });
  }
  if (giftCode && giftApplied > 0) {
    steps.push({
      claim: async () =>
        (await db.giftCard.updateMany({
          where: { code: giftCode, active: true, balanceCents: { gte: giftApplied } },
          data: { balanceCents: { decrement: giftApplied } },
        })).count > 0,
      release: async () => {
        await db.giftCard.updateMany({ where: { code: giftCode }, data: { balanceCents: { increment: giftApplied } } });
      },
      fail: { code: 'CONFLICT', message: 'Gift card balance changed, retry 禮卡餘額已變動,請重試' },
    });
  }

  // stamp the ringing station; a stale device pick (terminal since removed)
  // records as unassigned rather than blocking the sale
  const terminalId = input.terminalId
    ? ((await db.terminal.findUnique({ where: { id: input.terminalId } }))?.id ?? null)
    : null;

  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date());

  const outcome = await runLadder(
    steps,
    async () => {
      const order = await createOrderWithSeqRetry(db, dateKey, (seq, code) => ({
        dateKey,
        seq,
        code,
        type: 'POS',
        status: 'COMPLETED',
        contactName: 'Walk-in',
        contactPhone: '',
        fulfillment: { mode: 'pos' },
        itemsSnapshot: quote.lines as object[],
        subtotalCents: quote.subtotalCents,
        discountCents: discount,
        taxCents: tax,
        tipCents: input.tipCents,
        totalCents: total,
        // gift tender on the order row — the refund route restores the card from here
        giftCardCode: giftApplied > 0 ? (giftCode ?? null) : null,
        giftAppliedCents: giftApplied,
        ...(depositApplied > 0 && input.depositCredit
          ? { quoteMeta: { depositCredit: { appointmentId: input.depositCredit.appointmentId, appliedCents: depositApplied } } }
          : {}),
        staffId: input.staffId ?? null,
        terminalId,
        notes: input.note ?? null,
        accessToken: randomBytes(18).toString('hex'),
      }));
      try {
        const pay = await db.payment.create({
          data: {
            // a real STRIPE record requires BOTH the secret key and the reader — a reader
            // id alone (secret missing) means /terminal/collect simulated the charge, so
            // recording STRIPE would be phantom revenue. Match collect's gate exactly.
            provider: input.payment.method === 'terminal' ? (canChargeTerminal() ? 'STRIPE' : 'MOCK') : 'CASH',
            kind: input.payment.method === 'terminal' ? 'TERMINAL' : 'POS_CASH',
            /* The unique column is what makes a replay impossible even in a
               race: a terminal sale is keyed by its intent, a cash sale by the
               key the register minted before it sent. The check at the top of
               this handler is the friendly path; this is the one that holds. */
            externalId: extId ?? idemKey ?? null,
            amountCents: total,
            tipCents: input.tipCents,
            status: 'SUCCEEDED',
            orderId: order.id,
            // gift tender is real money already collected — keep the ledger honest
            ...(giftApplied > 0 ? { meta: { giftCardCode: giftCode!, giftAppliedCents: giftApplied } } : {}),
          },
        });
        // link the payment so the admin refund route can reverse the charge
        await db.order.update({ where: { id: order.id }, data: { paymentId: pay.id } });
      } catch (e) {
        // payment row failed (e.g. the same intent won a concurrent race) — take
        // the half-recorded order back out so the ledger never shows an unpaid sale
        await db.order.delete({ where: { id: order.id } }).catch(() => {});
        throw e;
      }
      return order;
    },
    { code: 'INTERNAL', message: '無法記錄交易 Could not record the sale.' },
  );
  if (!outcome.ok)
    return rejectRingUp(c, outcome.code === 'CONFLICT' ? 409 : 500, outcome.code, outcome.message, extId);
  const order = outcome.value;

  return c.json({
    code: order.code,
    totalCents: total,
    taxCents: tax,
    discountCents: discount,
    depositAppliedCents: depositApplied,
    giftAppliedCents: giftApplied,
    changeCents: change,
    lines: quote.lines,
  });
});
