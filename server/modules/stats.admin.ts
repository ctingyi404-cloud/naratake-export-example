/* Admin API — the dashboard overview. CORE: it ships with every site.

   This route used to live in analytics.admin.ts, next to /stats/reports, on the
   reasonable-looking grounds that both are "stats". But the two serve different
   screens, and the screens do not have the same life: Reports is the analytics
   module's own screen and goes when analytics goes, while the Dashboard is the
   first thing EVERY merchant sees after signing in and can never go anywhere.
   Analytics is off on every template we ship, so analytics.admin.ts was dropped
   from every export and this route with it — a 404 behind a working login, six
   em dashes where the day's numbers belong, and a silent one on the shell's
   unread badge and new-order chime, which poll it from every screen.

   Nothing here needed analytics in the first place. The route already asks each
   module over its own tables through `offers` (lib/hooks.ts) and queries exactly
   one table directly — form submissions, which are core. So it is not "the
   analytics route the dashboard borrows", it is the dashboard's own route, and
   it belongs where the dashboard does: in the core, mounted on every site
   whatever else is installed (codegen's admin registry keeps it, the way it
   keeps settings, auth and media).

   A module that is off leaves its key OUT rather than reporting a zero it
   cannot back, and the dashboard hides the tile that key would have filled. */

import { Hono } from 'hono';
import { db } from '@/lib/db';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init'; // registers the hooks of whichever modules this site has

export const routes = new Hono();

routes.get('/stats/overview', async (c) => {
  const business = await db.business.findFirstOrThrow();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date());
  const since = new Date(Date.now() - 7 * 86400_000);

  // one tile per module that has one, plus the inbox, which is core
  const [sales, upcomingResv, upcomingAppts, pendingReviews, unreadInbox, publishedPosts] = await Promise.all([
    offers.salesOverview?.(db, { today, since, timezone: business.timezone }),
    offers.upcomingReservations?.(db),
    offers.upcomingAppointments?.(db),
    offers.pendingReviews?.(db),
    db.formSubmission.count({ where: { read: false } }),
    offers.publishedPosts?.(db),
  ]);

  // assembled key by key so the order stays the dashboard's, and so a module
  // that is off leaves its key out rather than reporting a zero it cannot back
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };
  put('todayRevenueCents', sales?.todayRevenueCents);
  put('todayOrders', sales?.todayOrders);
  put('upcomingReservations', upcomingResv);
  put('upcomingAppointments', upcomingAppts);
  put('pendingReviews', pendingReviews);
  put('unreadInbox', unreadInbox);
  put('publishedPosts', publishedPosts);
  put('revenueByDay', sales?.revenueByDay);
  put('topItems', sales?.topItems);
  put('latestOrder', sales?.latestOrder);
  return c.json(out);
});
