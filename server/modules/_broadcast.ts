/* Shared by analytics.admin.ts (the broadcast composer) and promotions.admin.ts
   (mail this coupon to the list). Neither module owns it, so it lives beside
   them rather than inside either — a coupon blast must not need the reports
   module installed, and vice versa.

   It is tempting to call it customers-owned, since the audience is a Customer
   table. It is not: making it customers-owned would drop this file when
   customers is off, and the import closure would then take promotions.admin.ts
   and analytics.admin.ts with it — a coupons-only site would lose every coupon
   and gift-card route to fix a mailing list it never had. So the two module
   tables it reaches for are read through hooks instead (lib/hooks.ts): the
   subscriber list from customers, the featured item cards from catalog. Both
   are things a module OFFERS. Absent, they yield nothing rather than failing:
   no list means an empty send, no menu means an email with no item cards. */

import { db } from '@/lib/db';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init'; // registers the hooks of whichever modules this site has
import { marketingShell, sendEmail } from '@/lib/notify';
import { money } from '@/lib/money';
import { getSiteUrl } from '@/lib/site-url';

/* one email per opted-in customer, each with its own signed unsubscribe link
   (CAN-SPAM); mock mode lands every copy in NotificationLog for testing */
/** featured catalog items rendered as simple email cards with an order link */
export async function featuredRows(itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const items = (await offers.featuredItems?.(db, itemIds.slice(0, 3))) ?? [];
  const orderUrl = `${getSiteUrl()}/order`;
  return items.map(
    (it) =>
      `<div style="border:1px solid #e5e3dd;border-radius:10px;padding:14px 16px;margin:4px 0">` +
      `<strong style="font-size:15px">${it.name}</strong>` +
      `<span style="float:right;font-weight:700">${money(it.priceCents)}</span>` +
      (it.description ? `<br><span style="color:#6b6b66;font-size:13.5px">${it.description}</span>` : '') +
      `<br><a href="${orderUrl}" style="font-size:13px;font-weight:600">Order now →</a></div>`,
  );
}

export async function broadcast(subject: string, rows: string[], itemIds: string[] = []): Promise<{ sent: number; failed: number }> {
  const business = await db.business.findFirstOrThrow();
  const allRows = [...rows, ...(await featuredRows(itemIds))];
  const subscribers = (await offers.subscribers?.(db)) ?? [];
  let sent = 0;
  let failed = 0;
  for (const cu of subscribers) {
    if (await sendEmail(cu.email, subject, marketingShell(business.name, subject, allRows, cu.email))) sent++;
    else failed++;
  }
  return { sent, failed };
}
