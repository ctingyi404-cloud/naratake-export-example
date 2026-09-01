/* catalog — public routes. */

import { Hono } from 'hono';
import { db } from '@/lib/db';
import { offers } from '@/lib/hooks';

export const routes = new Hono();

routes.get('/catalog', async (c) => {
  const type = c.req.query('type');
  const categories = await db.category.findMany({
    where: type ? { type } : undefined,
    orderBy: { sort: 'asc' },
    include: { items: { where: { available: true }, orderBy: { sort: 'asc' } } },
  });
  return c.json({ categories });
});

/* the SERVICE slice of the catalog, baked into its own path. Consumed by the
   appointments booking widget AND by the quote-request form (which requires
   orders, not appointments) — it lives with catalog, the module both of those
   already require, so neither consumer can lose it. */
routes.get('/appointments/services', async (c) => {
  const categories = await db.category.findMany({
    where: { type: 'SERVICE' },
    orderBy: { sort: 'asc' },
    include: { items: { where: { available: true }, orderBy: { sort: 'asc' } } },
  });
  // without the payments module a deposit cannot be collected, so the widget
  // must never SHOW one — the row keeps its depositCents for the day the
  // module is added, the API just quotes zero (severability, hooks.ts)
  if (!offers.depositPayments) {
    return c.json({
      categories: categories.map((cat) => ({ ...cat, items: cat.items.map((i) => ({ ...i, depositCents: 0 })) })),
    });
  }
  return c.json({ categories });
});
