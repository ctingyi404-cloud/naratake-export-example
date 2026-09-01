/* Finding the loyalty member behind a phone number — customers' data, and the
   only part of loyalty that touches the database.

   The points math next door in lib/loyalty.ts is pure and is imported by the
   storefront's ordering widget, so keeping the two apart is what lets a site
   drop the customers module without dropping the checkout UI with it. */

import type { PrismaClient } from '@prisma/client';

/** last 10 digits with every separator stripped — the canonical member key */
export function normalizePhone10(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

/** Exact member lookup: strip non-digits and compare the full last-10 across
    ALL candidates. Never a contains-first-match — two customers sharing a
    last-4 must not shadow each other. */
export async function findMemberByPhone(db: PrismaClient, phone: string) {
  const digits = normalizePhone10(phone);
  if (digits.length < 10) return null;
  const candidates = await db.customer.findMany({ where: { phone: { contains: digits.slice(-4) } } });
  return candidates.find((m) => m.phone != null && normalizePhone10(m.phone) === digits) ?? null;
}
