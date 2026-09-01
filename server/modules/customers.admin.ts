/* Admin API — customer profiles, the marketing audience list, and the site inbox. */

import { Hono } from 'hono';
import { db } from '@/lib/db';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';

export const routes = new Hono();

/* ── customers ── */

routes.get('/customers', async (c) => {
  const customers = await db.customer.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  // spend per customer is orders' data, not ours: Customer.orders is no longer
  // a prisma relation (it was the last weld between the two modules), so a site
  // with no ordering simply shows profiles with no spend column
  const spend = (await offers.customerSpend?.(db, customers.map((cu) => cu.id))) ?? {};
  return c.json({
    customers: customers.map((cu) => ({
      id: cu.id,
      name: cu.name,
      phone: cu.phone,
      email: cu.email,
      marketingOptIn: cu.marketingOptIn,
      orderCount: spend[cu.id]?.count ?? 0,
      totalCents: spend[cu.id]?.cents ?? 0,
      createdAt: cu.createdAt,
    })),
  });
});

/* ── audience ── */

const AUDIENCE_WHERE = { marketingOptIn: true, email: { not: null } } as const;

routes.get('/marketing/audience', async (c) => {
  const [total, weekNew, customers] = await Promise.all([
    db.customer.count({ where: AUDIENCE_WHERE }),
    db.customer.count({ where: { ...AUDIENCE_WHERE, createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } } }),
    db.customer.findMany({
      where: AUDIENCE_WHERE,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, email: true, name: true, createdAt: true },
    }),
  ]);
  return c.json({ total, weekNew, customers });
});

routes.post('/marketing/audience/:id/unsubscribe', async (c) => {
  await db.customer.update({ where: { id: c.req.param('id') }, data: { marketingOptIn: false } });
  return c.json({ ok: true });
});

/* ── inbox ── */

routes.get('/inbox', async (c) =>
  c.json({ submissions: await db.formSubmission.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }) }),
);
routes.patch('/inbox/:id', async (c) => {
  return c.json(await db.formSubmission.update({ where: { id: c.req.param('id') }, data: { read: true } }));
});
