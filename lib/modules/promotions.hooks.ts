/* promotions' side of a void: the gift-card tender goes back on the card it was
   drawn from, and a capped coupon's redemption is handed back so codes stop
   leaking. Both join the caller's transaction rather than opening their own.

   Plus what promotions OFFERS the rest of the site: the house signup reward the
   mailing-list welcome email carries. A site with a list but no coupons still
   welcomes its new subscriber — just without a code in the mail. And the
   redemption counts the campaign list attributes a blast's takings to: no
   coupons means no code to trace, so the campaign is simply listed without a
   result rather than the whole marketing screen needing this module. */

import type { PrismaClient } from '@prisma/client';
import { registerOffers, registerRestitution } from '../hooks';
import { releaseCouponRedemption } from '../redemption';

registerRestitution({
  async restoreGift(tx: PrismaClient, code: string, cents: number) {
    await tx.giftCard.updateMany({ where: { code }, data: { balanceCents: { increment: cents } } });
  },
  releaseCoupon: (tx: PrismaClient, code: string) => releaseCouponRedemption(tx, code),
});

registerOffers({
  signupReward: (db: PrismaClient) =>
    db.coupon.findFirst({
      where: { signupReward: true, active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
    }),
  couponRedemptions: (db: PrismaClient) => db.coupon.findMany({ select: { code: true, redeemed: true } }),
});
