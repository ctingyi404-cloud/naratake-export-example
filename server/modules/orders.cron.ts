/* orders — scheduled jobs. */

import { Hono } from 'hono';
import { db } from '@/lib/db';
import { emailShell, notifyOwner } from '@/lib/notify';
import { money } from '@/lib/money';
import type { CronModule } from '../cron';

const routes = new Hono();

/* Weekly performance digest to the owner — last 7 days vs the 7 before, same
   completed-orders basis as /admin/stats/reports. */
routes.get('/weekly-digest', async (c) => {
  const business = await db.business.findFirstOrThrow();
  const since = new Date(Date.now() - 7 * 86400_000);
  const prevSince = new Date(Date.now() - 14 * 86400_000);
  const [orders, prev] = await Promise.all([
    db.order.findMany({ where: { createdAt: { gte: since }, status: 'COMPLETED' } }),
    db.order.findMany({
      where: { createdAt: { gte: prevSince, lt: since }, status: 'COMPLETED' },
      select: { totalCents: true },
    }),
  ]);
  const totalCents = orders.reduce((s, o) => s + o.totalCents, 0);
  const prevTotalCents = prev.reduce((s, o) => s + o.totalCents, 0);
  const qty = new Map<string, number>();
  for (const o of orders)
    for (const line of (o.itemsSnapshot as { name: string; qty: number }[]) ?? [])
      qty.set(line.name, (qty.get(line.name) ?? 0) + line.qty);
  const top = [...qty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const delta = (now: number, was: number) =>
    was === 0 ? (now > 0 ? 'new' : '–') : `${now >= was ? '▲' : '▼'} ${Math.abs(Math.round(((now - was) / was) * 100))}%`;
  const row = (label: string, now: string, was: string, d: string) =>
    `<strong>${label}:</strong> ${now} <span style="color:#9a9a96">· last week ${was} · ${d}</span>`;

  await notifyOwner(
    `Your week at ${business.name}: ${money(totalCents)} · ${orders.length} orders`,
    emailShell(business.name, 'Your weekly report', [
      row('Revenue', money(totalCents), money(prevTotalCents), delta(totalCents, prevTotalCents)),
      row('Completed orders', String(orders.length), String(prev.length), delta(orders.length, prev.length)),
      top.length
        ? `<strong>Top items:</strong> ${top.map(([name, n]) => `${name} ×${n}`).join(' · ')}`
        : 'No completed orders this week — a coupon broadcast from Marketing can help.',
    ]),
  );

  return c.json({ ok: true, orders: orders.length, totalCents, prevOrders: prev.length, prevTotalCents });
});

export const jobs: CronModule = {
  routes,
  /* win-back's recency half: without orders nobody has a last order, and the
     job's own `!last → skip` already means "welcome flow owns them" */
  lastOrderAt: async (customerIds) => {
    const latest = await db.order.groupBy({
      by: ['customerId'],
      _max: { createdAt: true },
      where: { customerId: { in: customerIds } },
    });
    return new Map(latest.map((l) => [l.customerId, l._max.createdAt!]));
  },
};
