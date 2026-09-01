/* catalog owes nothing when an order is voided — it sells, it does not hold
   money. What it OFFERS is the item rows a marketing email may feature, so the
   email composer can show a few dishes without importing the menu — and the
   category a sold line belongs to, which is the one fact the reports screen
   cannot work out for itself. Sold lines carry a name, not a category; only
   this module holds the mapping, so a site with no menu shows no category
   breakdown. */

import type { PrismaClient } from '@prisma/client';
import { registerOffers } from '../hooks';

registerOffers({
  async groundingItems(db: PrismaClient) {
    const items = await db.item.findMany({
      where: { available: true },
      orderBy: [{ category: { sort: 'asc' } }, { sort: 'asc' }],
      take: 20,
      include: { category: { select: { name: true } } },
    });
    return items.map((it) => ({ name: it.name, categoryName: it.category.name, priceCents: it.priceCents, description: it.description }));
  },
  async featuredItems(db: PrismaClient, ids: string[]) {
    const items = await db.item.findMany({ where: { id: { in: ids }, available: true } });
    return items.map((it) => ({ name: it.name, priceCents: it.priceCents, description: it.description }));
  },
  /* category revenue from the sold lines' item snapshots. A line whose item has
     since been renamed or deleted falls into "Other" rather than vanishing. */
  async categoryRevenue(db: PrismaClient, items: { name: string; qty: number; cents: number }[]) {
    const cats = await db.category.findMany({ include: { items: { select: { name: true } } } });
    const nameToCat = new Map<string, string>();
    for (const cat of cats) for (const it of cat.items) nameToCat.set(it.name, cat.name);
    const catRev = new Map<string, number>();
    for (const line of items) {
      const cat = nameToCat.get(line.name) ?? 'Other';
      catRev.set(cat, (catRev.get(cat) ?? 0) + line.cents);
    }
    return [...catRev.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, cents]) => ({ name, cents }));
  },
});
