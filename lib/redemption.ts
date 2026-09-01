/* Coupon-redemption release and coupon value rules.
   DB helpers take the prisma client as a parameter (same pattern as
   order-code.ts) so they stay unit-testable with a fake client — see
   test/redemption.test.ts. */

import type { PrismaClient } from '@prisma/client';

/** Coupon value sanity (audit commerce#12): a PERCENT coupon over 100 records
    discountCents > subtotal into orders and reports. Returns the rejection
    message, or null when the value is valid. */
export function couponValueError(kind: 'PERCENT' | 'FIXED', value: number): string | null {
  if (!Number.isInteger(value) || value < 1) return 'Discount value must be a positive integer';
  if (kind === 'PERCENT' && value > 100) return 'Percent discount must be between 1 and 100';
  return null;
}

/** Give one redemption back to a coupon. Touches nothing but coupons.

    Idempotency lives with the ORDER, not here: restituteOrder decides from one
    fresh order row whether a release is still owed and writes the
    `couponReleased` flag with the rest of its plan, inside the same
    Serializable transaction this call joins. So two concurrent releases still
    give back exactly one redemption, and the guarded decrement can never push
    `redeemed` negative. Returns true when a redemption was actually given back.

    Keeping the order read on the orders side is what lets a coupons-only site
    exist: this module no longer knows an Order table is possible. */
export async function releaseCouponRedemption(db: PrismaClient, code: string): Promise<boolean> {
  const hit = await db.coupon.updateMany({
    where: { code, redeemed: { gt: 0 } },
    data: { redeemed: { decrement: 1 } },
  });
  return hit.count > 0;
}
