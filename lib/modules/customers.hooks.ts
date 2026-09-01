/* customers' side of a void: the points the member spent come back.
   Plus what customers OFFERS the rest of the site: the marketing list, the
   opt-in write behind the "keep me posted" box on a booking form, and the
   profile and points writes a checkout makes (orders states WHICH member and
   HOW MANY points; how a member is stored stays in here). */

import type { PrismaClient } from '@prisma/client';
import { registerOffers, registerRestitution } from '../hooks';
import { findMemberByPhone } from '../member';

/** credit a balance — one write, two callers: the restitution leg an existing
    order owes, and the checkout ladder's undo for a burn that never landed. */
const credit = async (db: PrismaClient, customerId: string, points: number) => {
  await db.customer.updateMany({ where: { id: customerId }, data: { loyaltyPoints: { increment: points } } });
};

registerRestitution({
  restoreLoyalty: credit,
});

registerOffers({
  async deductLoyalty(tx: PrismaClient, customerId: string, points: number) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) return;
    await tx.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: Math.max(0, customer.loyaltyPoints - points) },
    });
  },
  findMember: (db: PrismaClient, phone: string) => findMemberByPhone(db, phone),
  async optIn(db: PrismaClient, contact: { email: string; phone: string; name: string }) {
    await db.customer.upsert({
      where: { email: contact.email },
      update: { marketingOptIn: true },
      create: { email: contact.email, phone: contact.phone, name: contact.name, marketingOptIn: true },
    });
  },
  async subscribers(db: PrismaClient) {
    // only the address leaves this function — don't haul whole profiles
    const rows = await db.customer.findMany({
      where: { marketingOptIn: true, email: { not: null } },
      select: { email: true },
    });
    return rows.map((cu) => ({ email: cu.email! }));
  },
  async upsertMember(db: PrismaClient, contact) {
    // consent needs an address to be worth anything, and is raise-only: an
    // unchecked box on a later order never unsubscribes an existing member,
    // which is also why the email is only rewritten when consent is given.
    const optIn = !!(contact.marketingOptIn && contact.email);
    try {
      const customer = await db.customer.upsert({
        where: { phone: contact.phone },
        update: { name: contact.name, ...(optIn ? { marketingOptIn: true, email: contact.email } : {}) },
        create: {
          phone: contact.phone,
          name: contact.name,
          email: contact.email || undefined,
          marketingOptIn: optIn,
        },
      });
      return customer.id;
    } catch {
      /* that email is already another member's — the order still stands, it
         just goes down unlinked rather than merging two people */
      return undefined;
    }
  },
  async burnPoints(db: PrismaClient, customerId: string, points: number) {
    // the balance guard rides IN the update, so the read and the decrement
    // cannot be split by a concurrent order spending the same points
    return (
      (
        await db.customer.updateMany({
          where: { id: customerId, loyaltyPoints: { gte: points } },
          data: { loyaltyPoints: { decrement: points } },
        })
      ).count > 0
    );
  },
  returnPoints: credit,
  async earnPoints(db: PrismaClient, customerId: string, points: number) {
    await db.customer.update({ where: { id: customerId }, data: { loyaltyPoints: { increment: points } } });
  },
});
