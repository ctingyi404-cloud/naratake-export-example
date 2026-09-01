/* The check-then-act guard every quoteMeta-flagged money leg runs under.

   This is core money infrastructure, not any one module's logic. It used to sit
   inside lib/redemption.ts next to the coupon rules, which meant the refund core
   had to import the coupons module to get a transaction primitive — the single
   thing that made promotions impossible to remove. */

import type { PrismaClient } from '@prisma/client';

/** Transient transaction failure worth retrying: serialization conflict
    (P2034), transaction/connection timeout (P2028/P1008), or a raw SQLite
    busy/lock. Mirrors lib/tx.ts but without importing the Prisma namespace, so
    these param-client helpers stay drivable by a fake in unit tests. */
function transient(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (typeof code === 'string' && ['P2034', 'P2028', 'P1008'].includes(code)) return true;
  const msg = e instanceof Error ? e.message : '';
  return /database is locked|sqlite_busy|write conflict|deadlock|could not serialize|socket timeout/i.test(msg);
}

/** Run `fn` under Serializable isolation so a check-then-act on quoteMeta can
    never race itself. The flags that make restitution idempotent live inside a
    JSON column, which no portable single-statement guard can filter on (SQLite
    has no JSON path filters), so the read and the write must share a
    transaction instead.

    When `db` is already a transaction client — Prisma's tx client has no
    `$transaction` — `fn` runs inline: the caller's transaction already supplies
    the isolation. That is what lets a module's restitution hook join
    restituteOrder's transaction rather than opening a second, racing one.

    Retrying is safe because `fn` must stay free of external side effects: a
    rolled-back attempt leaves no trace, and the retry re-reads the fresh flags.
    Never put a payment-provider call inside it. */
export async function serialize<T>(db: PrismaClient, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  const run = (db as unknown as {
    $transaction?: (f: (tx: PrismaClient) => Promise<T>, opts?: unknown) => Promise<T>;
  }).$transaction;
  if (typeof run !== 'function') return fn(db);
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await run.call(db, fn, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });
    } catch (e) {
      last = e;
      if (!transient(e)) throw e;
      await new Promise((r) => setTimeout(r, 12 * (attempt + 1) + Math.floor(Math.random() * 25)));
    }
  }
  throw last;
}

/** Prisma's InputJsonValue rejects Record<string, unknown> — round-trip to a
    plain JSON value. */
export function jsonValue(v: Record<string, unknown>): Record<string, never> {
  return JSON.parse(JSON.stringify(v));
}
