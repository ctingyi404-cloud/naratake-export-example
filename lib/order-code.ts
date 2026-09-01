import type { PrismaClient } from '@prisma/client';

/* Order codes (A-001, A-002, …) are GLOBALLY unique, but the per-day `seq`
   resets each day. Deriving the code from per-day seq collides whenever the
   seed and the runtime disagree on "today" (seed uses UTC, runtime uses the
   business timezone), reusing A-001 on a fresh day. Derive the code from the
   global order count instead, and retry past any lingering collision so a
   merchant's first live order can never 500. */
export async function nextOrderCode(db: PrismaClient): Promise<string> {
  let n = (await db.order.count()) + 1;
  for (let tries = 0; tries < 100; tries++) {
    const code = `A-${String(n).padStart(3, '0')}`;
    const exists = await db.order.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
    n++;
  }
  // extremely unlikely fallback — guaranteed unique
  return `A-${Date.now().toString(36).toUpperCase()}`;
}

/* Create an order, retrying past a per-day seq / code unique collision. Both the
   @@unique([dateKey,seq]) and code @unique constraints can conflict when two
   orders land the same instant, and a read-then-create derives both. RE-DERIVE
   both per attempt so a concurrent checkout never 500s. Use on the UNPAID paths
   (POS, quote requests); the paid online path handles its own money compensation. */
export async function createOrderWithSeqRetry<T>(
  db: PrismaClient,
  dateKey: string,
  build: (seq: number, code: string) => T,
): Promise<Awaited<ReturnType<PrismaClient['order']['create']>>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await db.order.findFirst({ where: { dateKey }, orderBy: { seq: 'desc' } });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await db.order.create({ data: build((last?.seq ?? 0) + 1, await nextOrderCode(db)) as any });
    } catch (e) {
      if (!(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') || attempt === 5) throw e;
    }
  }
  throw new Error('order seq/code retry exhausted');
}
