/* Helpers several public modules need. Lives outside server/modules/ so no
   module owns it and every module may import it. */

import { z } from 'zod';
import { db } from '@/lib/db';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init'; // registers the hooks of whichever modules this site has

/* The limiter moved to its own file (two stores, a fallback, and a test that
   must not need the ORM to run). Re-exported here so every route file that
   already imports these two names from this module still reads the way it did.

   Do NOT write an import statement inside a comment anywhere in this tree: the
   drop-closure and the hot-plug gate both find imports by regex over the source
   text, and neither of them knows what a comment is. An example in prose is
   indistinguishable from a dependency, and the site it invents is dropped. */
export { clientIp, limited, sharedRateLimit } from './rate-limit';

/* raise-only marketing consent from a booking form: a checked box adds the
   guest to the list; unchecked never downgrades an existing subscriber.

   The list is a customers table, so the write belongs to the customers module
   (lib/modules/customers.hooks.ts) and this only asks. Unlike a refund leg, a
   missing hook here is NOT an error: nothing is owed. A site without customers
   has no list to join, so the box collects nothing and the booking — which is
   what the guest actually came for — goes through exactly as before. */
export async function bookingOptIn(body: { marketingOptIn?: boolean; email?: string; phone: string; name: string }) {
  if (!body.marketingOptIn || !body.email) return;
  try {
    await offers.optIn?.(db, { email: body.email, phone: body.phone, name: body.name });
  } catch { /* phone conflict — fine */ }
}

/* customers manage their own appointment with the confirmation code + the
   phone they booked with (same last-4 verification as order tracking) */
export const ApptLookup = z.object({ code: z.string().min(2), phone: z.string().min(4) });
export const apptLast4 = (s: string) => s.replace(/\D/g, '').slice(-4);
