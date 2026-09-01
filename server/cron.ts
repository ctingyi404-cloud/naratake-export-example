/* Scheduled jobs — hit these from Vercel Cron, GitHub Actions, or any curl on
   a timer. Locked behind CRON_SECRET: send it as `X-Cron-Secret` (or Vercel's
   `Authorization: Bearer <secret>`). Without CRON_SECRET set, every call 401s
   so a fresh deploy never exposes an open job endpoint.

   A registry, not a job file: each optional module's scheduled work lives in
   server/modules/<id>.cron.ts and is listed below. Codegen regenerates this
   list with only the enabled modules, so a disabled module's code never ships.

   Which side of the line a job falls on:
     · a job one module owns end to end ships its own route — orders owns
       /weekly-digest — and is mounted at the bottom;
     · a job that is ONE email covering whatever is installed stays here and
       reads the registry: /reminders walks every module with bookings due
       tomorrow, /winback needs customers, orders and promotions at once.
   NotificationLog is core, and both composite jobs keep their idempotency
   checks here, so the ledger behaves identically whichever modules are on. */

import { Hono } from 'hono';
import { db } from '@/lib/db';
import { emailShell, marketingShell, sendEmail, sendSms } from '@/lib/notify';
import { money } from '@/lib/money';
import { zonedDate } from '@/lib/hours';

/** one booking due a day-before reminder, whatever kind of booking it was */
export type ReminderRow = { what: string; code: string; at: Date; phone: string; email: string | null };

/** What a module adds to the schedule. Every field is optional — a module
    contributes only the pieces it owns, and the composite jobs above run with
    whatever they find. */
export type CronModule = {
  /** bookings starting inside the window, under the key the JSON reports */
  reminders?: (startsAt: { gte: Date; lt: Date }) => Promise<{ key: string; rows: ReminderRow[] }>;
  /** win-back inputs: who may be mailed, when they last ordered, what to offer */
  subscribers?: () => Promise<{ id: string; email: string | null; name: string | null }[]>;
  // null keys are guest orders — never looked up, never dropped either
  lastOrderAt?: (customerIds: string[]) => Promise<Map<string | null, Date>>;
  signupReward?: () => Promise<{ code: string; kind: string; value: number } | null>;
  /** jobs this module owns outright */
  routes?: Hono;
};
/* ── REGISTRY ─────────────────────────────────────────────── */
import { jobs as ordersJobs } from './modules/orders.cron';
import { jobs as promotionsJobs } from './modules/promotions.cron';
import { jobs as customersJobs } from './modules/customers.cron';

const MODULE_CRONS: CronModule[] = [ordersJobs, promotionsJobs, customersJobs];
/* ── END REGISTRY ─────────────────────────────────────── */

/** the installed module that supplies a capability, if any site here has one */
const provider = <K extends keyof CronModule>(k: K): NonNullable<CronModule[K]> | undefined =>
  MODULE_CRONS.find((m) => m[k])?.[k] as NonNullable<CronModule[K]> | undefined;

export const cronRoutes = new Hono();

cronRoutes.use('*', async (c, next) => {
  const secret = process.env.CRON_SECRET;
  const given = c.req.header('x-cron-secret') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || given !== secret) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  await next();
});

/* Day-before reminders for tomorrow's reservations and appointments. SMS is
   the US default; email is the fallback when no phone was left. Re-runs are
   idempotent — NotificationLog is the ledger (exact message already sent =
   skip), so a twice-daily cron never double-texts a customer. */
cronRoutes.get('/reminders', async (c) => {
  const business = await db.business.findFirstOrThrow();
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(
    new Date(Date.now() + 86400_000),
  );
  const start = zonedDate(dateKey, '00:00', business.timezone);
  const startsAt = { gte: start, lt: new Date(start.getTime() + 86400_000) };
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour: 'numeric', minute: '2-digit' });

  const due = await Promise.all(MODULE_CRONS.filter((m) => m.reminders).map((m) => m.reminders!(startsAt)));

  let sent = 0;
  const remind = async (what: string, code: string, at: Date, phone: string, email: string | null) => {
    const msg = `Reminder from ${business.name}: ${what} tomorrow at ${timeFmt.format(at)} (${code}). See you then!`;
    if (await db.notificationLog.findFirst({ where: { body: { contains: msg } } })) return;
    if (phone) await sendSms(phone, msg);
    else if (email)
      await sendEmail(email, `Reminder: tomorrow at ${timeFmt.format(at)} — ${business.name}`,
        emailShell(business.name, 'See you tomorrow!', [msg]));
    else return;
    sent++;
  };
  const counts: Record<string, number> = {};
  for (const { key, rows } of due) {
    counts[key] = rows.length;
    for (const r of rows) await remind(r.what, r.code, r.at, r.phone, r.email);
  }

  return c.json({ ok: true, date: dateKey, ...counts, sent });
});

/* Win-back — opted-in customers whose last order is older than ?days (default
   60) get a warm nudge with the house signup-reward coupon when one is active.
   Idempotent per month: skips anyone nudged in the last 30 days, so a daily
   cron never nags. Call daily alongside /reminders. */
cronRoutes.get('/winback', async (c) => {
  const days = Math.max(14, Math.min(365, Number(c.req.query('days')) || 60));
  const business = await db.business.findFirstOrThrow();
  const cutoff = new Date(Date.now() - days * 86400_000);
  const nagCutoff = new Date(Date.now() - 30 * 86400_000);

  const listSubscribers = provider('subscribers');
  const subscribers = listSubscribers ? await listSubscribers() : [];
  if (subscribers.length === 0) return c.json({ ok: true, sent: 0 });

  const lastOrderAt = provider('lastOrderAt');
  const lastOrder = lastOrderAt
    ? await lastOrderAt(subscribers.map((s) => s.id))
    : new Map<string | null, Date>();

  const signupReward = provider('signupReward');
  const reward = signupReward ? await signupReward() : null;
  const subject = `We miss you at ${business.name}`;

  let sent = 0;
  for (const cu of subscribers) {
    const last = lastOrder.get(cu.id);
    if (!last || last > cutoff) continue; // never ordered → welcome flow owns them
    const nagged = await db.notificationLog.findFirst({
      where: { recipient: cu.email!, subject, createdAt: { gt: nagCutoff } },
    });
    if (nagged) continue;
    const rows = [
      `${cu.name ? `${cu.name.split(' ')[0]}, it` : 'It'}'s been a while — we'd love to have you back.`,
      ...(reward
        ? [`Come see what's new: code <strong>${reward.code}</strong> gets you ${
            reward.kind === 'PERCENT' ? `${reward.value}% off` : `${money(reward.value)} off`
          } your next order.`]
        : ["Come see what's new on the menu."]),
    ];
    if (await sendEmail(cu.email!, subject, marketingShell(business.name, subject, rows, cu.email!))) sent++;
  }
  return c.json({ ok: true, days, candidates: subscribers.length, sent });
});

/* ── modules ── */

/* Last, like the back office does it: the CRON_SECRET check above is a `use`
   registered before these mounts, so it guards them too. Moving this line above
   it would publish every module's job as an open endpoint. */
MODULE_CRONS.forEach((m) => m.routes && cronRoutes.route('/', m.routes));
