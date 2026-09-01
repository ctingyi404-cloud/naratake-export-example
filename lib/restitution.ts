/* Order restitution — the single make-the-customer-whole path shared by the
   admin refund route AND the board cancel (server/admin.ts). A canceled paid
   order must never keep the customer's money (audit dining#1 / commerce#1).

   Every leg is idempotent AND concurrency-safe, because cancel and refund can
   land at the same instant (double-clicked Refund, or a board cancel racing the
   refund route). Two shapes carry that:

   • card — an atomic conditional claim: SUCCEEDED -> REFUNDED in one guarded
     updateMany. Whoever wins count>0 owns the refund and calls the provider;
     the loser sees count 0 and never charges back twice. The provider call
     stays OUTSIDE any transaction (a network round trip must never hold a write
     lock, least of all on single-writer SQLite); a failed refund hands the claim
     back so the order stays fully refundable and aborts before any other leg.

   • gift / loyalty / deposit / coupon — their idempotency flags live in the
     quoteMeta JSON column, which no portable single-statement guard can filter
     on, so the fresh read, the flag write and the credits all share ONE
     Serializable transaction (lib/redemption.serialize). The legs therefore
     serialize: gift restored at most once, loyalty at most once, coupon
     released at most once, deposit credit reversed at most once.

   Which legs are owed is a pure function of one fresh order row (ledgerLegs),
   unit-tested exhaustively; the transaction only executes that plan.

   Takes the prisma client and the refund fn as parameters (same pattern as
   redemption.ts) — unit-tested with fakes in test/restitution.test.ts. */

import type { PrismaClient } from '@prisma/client';
import { jsonValue, serialize } from './serialize';
import { MissingModuleError, offers, restitution as hooks } from './hooks';
import './hooks-init'; // registers the hooks of whichever modules this site has

export interface Restitution {
  /** false = the card refund failed; no other leg was touched this run */
  ok: boolean;
  cardCents: number;
  giftCents: number;
  /** redeemed loyalty points returned to the member */
  loyaltyPoints: number;
  /** booking deposit credit handed back to its appointment (POS sale reversal),
      making it refundable/creditable again */
  depositCents: number;
  couponReleased: boolean;
  failMessage?: string;
}

const NOTHING: Restitution = {
  ok: true,
  cardCents: 0,
  giftCents: 0,
  loyaltyPoints: 0,
  depositCents: 0,
  couponReleased: false,
};

/** The order row fields the non-card legs decide from. */
export interface RestitutableOrder {
  giftCardCode: string | null;
  giftAppliedCents: number;
  couponCode?: string | null;
  quoteMeta: unknown;
}

export interface LedgerLegs {
  gift: { code: string; cents: number } | null;
  loyalty: { customerId: string; points: number } | null;
  /** POS sale that tendered a booking deposit (pos.ts quoteMeta.depositCredit) */
  deposit: { appointmentId: string; cents: number } | null;
  /** capped coupon whose redemption is still to be given back */
  coupon: { code: string } | null;
  /** quoteMeta patch marking exactly the legs above as done */
  flags: Record<string, true>;
}

/** Pure decision core: which non-card legs still owe the customer, read from a
    single fresh order row. Replaying the plan against the row it produced
    yields no legs at all — that is what makes restitution idempotent, and
    reading every flag from ONE snapshot is what makes it safe to execute the
    whole plan in one transaction. */
export function ledgerLegs(order: RestitutableOrder): LedgerLegs {
  const meta = (order.quoteMeta ?? {}) as Record<string, unknown>;
  const loyalty = meta.loyalty as { customerId?: string; points?: number } | undefined;
  const deposit = meta.depositCredit as { appointmentId?: string; appliedCents?: number } | undefined;
  const legs: LedgerLegs = { gift: null, loyalty: null, deposit: null, coupon: null, flags: {} };

  if (order.giftAppliedCents > 0 && order.giftCardCode && !meta.giftRestored) {
    legs.gift = { code: order.giftCardCode, cents: order.giftAppliedCents };
    legs.flags.giftRestored = true;
  }
  // public.ts recorded who paid how many points in quoteMeta.loyalty at checkout
  if (loyalty?.customerId && (loyalty.points ?? 0) > 0 && !meta.loyaltyRestored) {
    legs.loyalty = { customerId: loyalty.customerId, points: loyalty.points as number };
    legs.flags.loyaltyRestored = true;
  }
  if (deposit?.appointmentId && (deposit.appliedCents ?? 0) > 0 && !meta.depositCreditReversed) {
    legs.deposit = { appointmentId: deposit.appointmentId, cents: deposit.appliedCents as number };
    legs.flags.depositCreditReversed = true;
  }
  // the coupon leg reads the same snapshot as the rest, so cancel-then-refund
  // can never release twice — the flag it sets is written with the others
  if (order.couponCode && !meta.couponReleased) {
    legs.coupon = { code: order.couponCode };
    legs.flags.couponReleased = true;
  }
  return legs;
}

export async function restituteOrder(
  db: PrismaClient,
  orderId: string,
  refund: (externalId: string) => Promise<void>,
): Promise<Restitution> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return NOTHING;

  // 1) card — first, and abort on failure: a cancel whose refund failed must
  // leave the payment SUCCEEDED so the refund route can retry it. The claim and
  // the provider call belong to payments (lib/modules/payments.hooks); a site
  // without that module has no paymentId to begin with.
  let cardCents = 0;
  if (order.paymentId) {
    if (!hooks.refundCard) return { ...NOTHING, ok: false, failMessage: new MissingModuleError('a card charge', 'payments').message };
    try {
      cardCents = await hooks.refundCard(db, order.paymentId, refund);
    } catch (e) {
      return { ...NOTHING, ok: false, failMessage: e instanceof Error ? e.message : 'Refund failed' };
    }
  }

  // 2) every quoteMeta-flagged leg in ONE transaction: fresh read, plan, flags
  // written in a single update, then the credits. No provider calls in here.
  const ledger = await serialize(db, async (tx) => {
    const fresh = await tx.order.findUnique({ where: { id: orderId } });
    if (!fresh) return { giftCents: 0, loyaltyPoints: 0, depositCents: 0, couponReleased: false };
    const meta = (fresh.quoteMeta ?? {}) as Record<string, unknown>;
    const legs = ledgerLegs(fresh);

    if (Object.keys(legs.flags).length > 0)
      await tx.order.update({
        where: { id: orderId },
        data: { quoteMeta: jsonValue({ ...meta, ...legs.flags }) },
      });

    // Each leg is paid back by the module that owns the table. A planned leg
    // with no hook means the site holds data for a module it does not have —
    // throwing rolls the flags back so the money stays owed and retryable,
    // which is the only safe way to be wrong here.
    if (legs.gift) {
      if (!hooks.restoreGift) throw new MissingModuleError('a gift-card tender', 'coupons');
      await hooks.restoreGift(tx, legs.gift.code, legs.gift.cents);
    }
    if (legs.loyalty) {
      if (!hooks.restoreLoyalty) throw new MissingModuleError('loyalty points', 'customers');
      await hooks.restoreLoyalty(tx, legs.loyalty.customerId, legs.loyalty.points);
    }
    // the booking deposit this POS sale consumed becomes creditable/refundable
    // again (audit: a voided sale must not swallow money paid online)
    if (legs.deposit) {
      if (!hooks.releaseDeposit) throw new MissingModuleError('a booking deposit', 'appointments');
      await hooks.releaseDeposit(tx, legs.deposit.appointmentId);
    }

    // give the coupon redemption back so capped codes stop leaking
    let couponReleased = false;
    if (legs.coupon) {
      if (!hooks.releaseCoupon) throw new MissingModuleError('a coupon redemption', 'coupons');
      couponReleased = await hooks.releaseCoupon(tx, legs.coupon.code);
    }

    return {
      giftCents: legs.gift?.cents ?? 0,
      loyaltyPoints: legs.loyalty?.points ?? 0,
      depositCents: legs.deposit?.cents ?? 0,
      couponReleased,
    };
  });

  return { ok: true, cardCents, ...ledger };
}

/** Reverse the points a COMPLETED order earned ($1 = 1 point), once, clamped at
    zero. Callers invoke this only while the order still counts as COMPLETED;
    the quoteMeta flag keeps retry paths (refund after a failed cancel
    restitution) from double-reversing. The flag read, the flag write and the
    balance write share one transaction so a concurrent cancel+refund cannot
    reverse twice. Returns the points taken back. */
export async function reverseEarnedPoints(db: PrismaClient, orderId: string): Promise<number> {
  return serialize(db, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order?.customerId) return 0;
    const meta = (order.quoteMeta ?? {}) as Record<string, unknown>;
    if (meta.earnedReversed) return 0;
    const pts = Math.floor(order.totalCents / 100);
    if (pts <= 0) return 0;
    await tx.order.update({
      where: { id: orderId },
      data: { quoteMeta: jsonValue({ ...meta, earnedReversed: true }) },
    });
    // taking points back is customers' write. Unlike a restitution leg this is
    // safe to skip: with no customers module there is no member to hold points
    // and order.customerId above is already null, so we never get here.
    await offers.deductLoyalty?.(tx, order.customerId, pts);
    return pts;
  });
}

export type RefundEligibility = 'refundable' | 'already_refunded' | 'nothing_to_refund';

/** The refund route's decision table. 'already_refunded' replaces the old
    alreadyCanceled trap: a canceled order whose restitution ran says so,
    while a cancel that FAILED restitution stays 'refundable'. A POS sale paid
    entirely with a booking deposit has no card row at all, so the unreversed
    deposit credit alone has to keep it refundable. */
export function refundEligibility(
  order: { giftAppliedCents: number; giftCardCode: string | null; quoteMeta: unknown },
  payment: { status: string; externalId: string | null } | null,
): RefundEligibility {
  const legs = ledgerLegs(order);
  const meta = (order.quoteMeta ?? {}) as Record<string, unknown>;
  if ((payment?.status === 'SUCCEEDED' && payment.externalId) || legs.gift || legs.loyalty || legs.deposit)
    return 'refundable';
  return payment?.status === 'REFUNDED' || meta.giftRestored || meta.loyaltyRestored || meta.depositCreditReversed
    ? 'already_refunded'
    : 'nothing_to_refund';
}
