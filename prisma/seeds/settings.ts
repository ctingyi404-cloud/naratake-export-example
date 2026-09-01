/* settings — the Business row (name, hours, tax, delivery, locales). */

import type { SeedStep } from './types';

export const seed: SeedStep = {
  wipe: (prisma) => [prisma.business.deleteMany()],

  async run(prisma, data, empty) {
    const business = data.business;
    if (await empty(() => prisma.business.count())) {
      await prisma.business.create({
        data: {
          name: business.name,
          phone: business.phone,
          email: business.email,
          address: business.address,
          timezone: business.timezone,
          currency: business.currency,
          taxRateBp: business.taxRateBp,
          hours: business.hours,
          delivery: data.seed.delivery ?? undefined,
          locales: business.locales ?? undefined,
        },
      });
    }
  },
};
