/* orders — POS terminals and a couple of demo orders.

   Runs last: the demo orders are built from catalog items, so this step reads
   rows the catalog step created. */

import { randomBytes } from 'node:crypto';
import type { SeedStep } from './types';

function code(n = 24): string {
  return randomBytes(n).toString('hex');
}

export const seed: SeedStep = {
  wipe: (prisma) => [prisma.order.deleteMany(), prisma.terminal.deleteMany()],

  async run(prisma, data, empty) {
    const business = data.business;

    // POS terminals: one row per register/station from intake (business.pos),
    // defaulting to a single register — the POS page asks each device to pick one
    if (await empty(() => prisma.terminal.count())) {
      const pos = business.pos ?? { terminals: 1 };
      const zh = business.locales?.secondary === 'zh';
      const count = Math.max(1, Math.min(12, Math.round(pos.terminals ?? 1)));
      for (let i = 0; i < count; i++) {
        const name =
          pos.stationNames?.[i]?.trim() || (zh ? `櫃台 ${i + 1}` : `Register ${i + 1}`);
        await prisma.terminal.create({ data: { name } });
      }
    }

    // a couple of demo orders so the admin dashboard has life on first login
    const today = new Date().toISOString().slice(0, 10);
    const demoItems = (await empty(() => prisma.order.count()))
      ? await prisma.item.findMany({ take: 2, where: { priceCents: { gt: 0 } } })
      : [];
    if (demoItems.length > 0) {
      let seq = 1;
      for (const status of ['COMPLETED', 'PREPARING']) {
        const subtotal = demoItems.reduce((s, i) => s + i.priceCents, 0);
        const tax = Math.round((subtotal * business.taxRateBp) / 10000);
        await prisma.order.create({
          data: {
            dateKey: today,
            seq,
            code: `A-${String(seq).padStart(3, '0')}`,
            type: 'PICKUP',
            status,
            contactName: 'Demo Customer',
            contactPhone: '(555) 010-9999',
            fulfillment: { mode: 'pickup' },
            itemsSnapshot: demoItems.map((i) => ({
              itemId: i.id,
              name: i.name,
              qty: 1,
              unitCents: i.priceCents,
              modifiers: [],
            })),
            subtotalCents: subtotal,
            taxCents: tax,
            totalCents: subtotal + tax,
            accessToken: code(),
          },
        });
        seq++;
      }
    }
  },
};
