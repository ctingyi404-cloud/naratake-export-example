/* promotions — coupons (including the signup reward code). */

import type { SeedStep } from './types';

export const seed: SeedStep = {
  wipe: (prisma) => [prisma.coupon.deleteMany()],

  async run(prisma, data, empty) {
    if (await empty(() => prisma.coupon.count()))
    for (const c of data.seed.coupons ?? []) {
      await prisma.coupon.create({
        data: {
          code: c.code,
          kind: c.kind,
          value: c.value,
          minSubtotalCents: c.minSubtotalCents ?? null,
          description: c.description ?? null,
          signupReward: c.signupReward ?? false,
        },
      });
    }
  },
};
