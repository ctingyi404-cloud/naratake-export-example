/* What orders OFFERS the rest of the site.

   A quote request arrives through the contact form, which is core, but turning
   one into an AWAITING_APPROVAL order is orders' business. Registering it here
   means a site without online ordering still takes the request — it simply
   lands in the inbox instead of the order board, which is the honest outcome
   rather than a dead form.

   And the sales half of the back office's two summary screens. Every figure
   below is read off Order rows and nothing else, which is what makes the
   reports screen removable with this module: a site that takes no orders has
   no revenue, no basket, no cancel rate and no peak hour, so those sections
   simply are not there. The cuts of the same sales that other modules own —
   the tender mix, the category split, the staff league table — get what they
   need through `attribution` rather than by re-reading orders themselves. */

import type { PrismaClient } from '@prisma/client';
import { registerOffers, type OverviewWindow, type ReportWindow, type SalesOverview, type SalesReport } from '../hooks';
import { createOrderWithSeqRetry } from '../order-code';
import { tok } from '../codes';

registerOffers({
  async customerSpend(db: PrismaClient, customerIds: string[]) {
    if (!customerIds.length) return {};
    const rows = await db.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _count: { _all: true },
      _sum: { totalCents: true },
    });
    const out: Record<string, { count: number; cents: number }> = {};
    for (const r of rows)
      if (r.customerId) out[r.customerId] = { count: r._count._all, cents: r._sum.totalCents ?? 0 };
    return out;
  },
  async createQuoteOrder(db: PrismaClient, req) {
    const business = await db.business.findFirstOrThrow();
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date());
    const order = await createOrderWithSeqRetry(db, dateKey, (seq, code) => ({
      dateKey,
      seq,
      code,
      type: 'QUOTE',
      status: 'AWAITING_APPROVAL',
      contactName: req.name ?? 'Unknown',
      contactPhone: req.phone ?? '',
      contactEmail: req.email || null,
      fulfillment: { mode: 'quote' },
      itemsSnapshot: [],
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      notes: req.message ?? null,
      quoteMeta: req.meta,
      accessToken: tok(),
    }));
    return { code: order.code, contactName: order.contactName, contactPhone: order.contactPhone, contactEmail: order.contactEmail };
  },

  /* full business reports, computed from real orders in the requested window */
  async salesReport(db: PrismaClient, w: ReportWindow): Promise<SalesReport> {
    const [orders, prevOrders] = await Promise.all([
      // select only what the report reads — the full row drags contact PII,
      // notes, and quoteMeta JSON through a 90-day window for nothing
      db.order.findMany({
        where: { createdAt: { gte: w.since } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, totalCents: true, dateKey: true, createdAt: true, itemsSnapshot: true, staffId: true },
      }),
      db.order.findMany({
        where: { createdAt: { gte: w.prevSince, lt: w.since } },
        select: { status: true, totalCents: true },
      }),
    ]);
    const completed = orders.filter((o) => o.status === 'COMPLETED');
    const totalCents = completed.reduce((s, o) => s + o.totalCents, 0);
    const aovCents = completed.length ? Math.round(totalCents / completed.length) : 0;
    const canceled = orders.filter((o) => o.status === 'CANCELED').length;
    const prevCompleted = prevOrders.filter((o) => o.status === 'COMPLETED');
    const prevTotalCents = prevCompleted.reduce((s, o) => s + o.totalCents, 0);

    // revenue per day (completed), keyed in the business timezone
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: w.timezone });
    const byDay: { date: string; cents: number }[] = [];
    const dayIdx = new Map<string, number>();
    for (let i = w.days - 1; i >= 0; i--) {
      const key = fmt.format(new Date(Date.now() - i * 86400_000));
      dayIdx.set(key, byDay.length);
      byDay.push({ date: key, cents: 0 });
    }
    for (const o of completed) {
      const i = dayIdx.get(o.dateKey);
      if (i !== undefined) byDay[i].cents += o.totalCents;
    }

    const statusCounts: Record<string, number> = {};
    for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

    // customer traffic by hour-of-day and by weekday — every order that isn't a
    // cancellation counts as a visit, keyed in the business timezone
    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: w.timezone, hour: '2-digit', hour12: false });
    const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: w.timezone, weekday: 'short' });
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    const byWeekday = DOW.map((dow) => ({ dow, count: 0 }));
    for (const o of orders) {
      if (o.status === 'CANCELED') continue;
      const hr = parseInt(hourFmt.format(o.createdAt), 10) % 24;
      byHour[hr].count += 1;
      const wi = DOW.indexOf(dowFmt.format(o.createdAt));
      if (wi >= 0) byWeekday[wi].count += 1;
    }

    // what sold, from the item snapshots. Quantity is our own top-items list;
    // the revenue rides along for catalog, which is the module that knows which
    // category a name belongs to.
    const items = new Map<string, { qty: number; cents: number }>();
    for (const o of completed) {
      for (const line of (o.itemsSnapshot as { name: string; qty: number; unitCents?: number }[]) ?? []) {
        const cur = items.get(line.name) ?? { qty: 0, cents: 0 };
        items.set(line.name, { qty: cur.qty + line.qty, cents: cur.cents + (line.unitCents ?? 0) * line.qty });
      }
    }
    const topItems = [...items.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 8)
      .map(([name, v]) => ({ name, qty: v.qty }));

    // POS sales per staff member. Who those ids belong to is appointments'
    // business — it owns StaffMember — so only the totals are ours.
    const staffAgg = new Map<string, { cents: number; count: number }>();
    for (const o of completed)
      if (o.staffId) {
        const cur = staffAgg.get(o.staffId) ?? { cents: 0, count: 0 };
        staffAgg.set(o.staffId, { cents: cur.cents + o.totalCents, count: cur.count + 1 });
      }

    return {
      totalCents,
      orderCount: completed.length,
      aovCents,
      cancelRate: orders.length ? canceled / orders.length : 0,
      prevTotalCents,
      prevOrderCount: prevCompleted.length,
      byDay,
      statusCounts,
      topItems,
      byHour,
      byWeekday,
      attribution: {
        orderIds: completed.map((o) => o.id),
        items: [...items.entries()].map(([name, v]) => ({ name, qty: v.qty, cents: v.cents })),
        staff: [...staffAgg.entries()].map(([staffId, v]) => ({ staffId, cents: v.cents, count: v.count })),
      },
    };
  },

  /* the dashboard's sales half: today, the trailing week, and what just came in */
  async salesOverview(db: PrismaClient, w: OverviewWindow): Promise<SalesOverview> {
    const [todayOrders, weekOrders, latest] = await Promise.all([
      // the dashboard polls this every 18s — keep the rows narrow
      db.order.findMany({ where: { dateKey: w.today, status: { not: 'CANCELED' } }, select: { totalCents: true } }),
      db.order.findMany({
        where: { createdAt: { gte: w.since }, status: { not: 'CANCELED' } },
        select: { dateKey: true, totalCents: true, itemsSnapshot: true },
      }),
      // newest order — drives the "new order arrived" notification poller in the shell
      db.order.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, contactName: true, totalCents: true, status: true },
      }),
    ]);

    const byDay = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: w.timezone }).format(
        new Date(Date.now() - i * 86400_000),
      );
      byDay.set(key, 0);
    }
    for (const o of weekOrders) {
      if (byDay.has(o.dateKey)) byDay.set(o.dateKey, (byDay.get(o.dateKey) ?? 0) + o.totalCents);
    }

    // top items from snapshots
    const counts = new Map<string, number>();
    for (const o of weekOrders) {
      for (const line of (o.itemsSnapshot as { name: string; qty: number }[]) ?? []) {
        counts.set(line.name, (counts.get(line.name) ?? 0) + line.qty);
      }
    }
    const topItems = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    return {
      todayRevenueCents: todayOrders.reduce((s, o) => s + o.totalCents, 0),
      todayOrders: todayOrders.length,
      revenueByDay: [...byDay.entries()].map(([date, cents]) => ({ date, cents })),
      topItems,
      latestOrder: latest,
    };
  },
});
