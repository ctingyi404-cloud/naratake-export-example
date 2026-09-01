/* Pure loyalty-redemption math — no DB, no I/O, unit-tested in
   test/loyalty.test.ts. Contract (client and server must agree):
   100 points = $5 (500¢) of tender; redemptions are whole $5 chunks and can
   never exceed either the member's balance or what is still due. */

/** each redeemable chunk: $5 */
export const LOYALTY_STEP_CENTS = 500;
/** points that buy one chunk */
export const LOYALTY_POINTS_PER_STEP = 100;

/** full redeemable value of a points balance (whole chunks only) */
export function loyaltyValueCents(points: number): number {
  return Math.max(0, Math.floor(points / LOYALTY_POINTS_PER_STEP)) * LOYALTY_STEP_CENTS;
}

/** largest valid redemption: whole $5 chunks, capped by balance AND amount due */
export function maxLoyaltyRedeemCents(points: number, remainingDueCents: number): number {
  const cap = Math.min(loyaltyValueCents(points), Math.max(0, remainingDueCents));
  return Math.floor(cap / LOYALTY_STEP_CENTS) * LOYALTY_STEP_CENTS;
}

/** every valid redemption amount, ascending ($5, $10, …) */
export function loyaltyRedeemOptions(points: number, remainingDueCents: number): number[] {
  const max = maxLoyaltyRedeemCents(points, remainingDueCents);
  const out: number[] = [];
  for (let v = LOYALTY_STEP_CENTS; v <= max; v += LOYALTY_STEP_CENTS) out.push(v);
  return out;
}

/** points consumed by a redemption (100 per $5 → 20 per $1) */
export function loyaltyPointsNeeded(redeemCents: number): number {
  return redeemCents / 5;
}
