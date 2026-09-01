/* Admin API — settings (core-adjacent: business profile + ordering gate). */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getBlackoutDates, getPause, setBlackoutDates, setPause } from '@/lib/ordering-gate';
import { businessSnapshot, overridesFor, recordOverrides, revalidateBusiness } from '@/lib/business-db';
import { publishedBusiness, PUBLIC_BUSINESS_FIELDS, resolvePublicBusiness } from '@/lib/business-profile';
import { publicEmail, publicPhone } from '@/lib/public-contact';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';

export const routes = new Hono();

/* ── settings ── */

/* The form is filled with WHAT THIS ROW WOULD PUBLISH — every public field
   resolved as if it were taken over — rather than with what the site currently
   shows or with the raw column.

   The three differ, and the difference is the whole feature. A shop that fixed
   its phone number in the old back office has that number in the row and a
   storefront that never showed it; filling the box with the published value
   instead would put a blank in front of them and turn "press Save to publish
   your changes" into a Save that DELETES them. Filling it with the raw column
   is wrong the other way: a value the exporter's own sanitizer would drop —
   the seeded "(512) 555-0035" — would sit there looking publishable and then
   fail validation. Resolving first shows the merchant exactly what pressing
   Save would put on the internet.

   `overrides` / `stranded` / `published` ride along so the form can say, per
   field, whether the public is reading it yet and what handing it back would
   restore. */
routes.get('/settings', async (c) => {
  const [row, snapshot] = await Promise.all([db.business.findFirstOrThrow(), businessSnapshot()]);
  /* The FORM gets the raw row. It used to get resolvePublicBusiness(), and that
     destroyed data: publicPhone() returns null for anything it cannot turn into
     a tel: target, the field arrived as "", and save() PATCHes every public
     field from form state — so a merchant who opened Settings to change the tax
     rate and pressed Save wrote "" over their own phone number. On a shop whose
     site HAD a working number the banner even asked them to press it, and the
     empty value was then recorded as a deliberate takeover, so a Studio
     republish could not put it back.

     Whether a value is publishable is a WARNING, not an edit. It rides along in
     `profile.wouldPublish` and the form compares against it; the boxes show
     what the merchant typed, and Save round-trips it unchanged. */
  const wouldPublish = resolvePublicBusiness(row, PUBLIC_BUSINESS_FIELDS);
  return c.json({
    ...row,
    profile: {
      overrides: snapshot.overrides,
      stranded: snapshot.stranded,
      published: publishedBusiness(),
      /* Per field: what the public would actually get if this row were taken
         over. A value the sanitiser refuses shows up here as null while the box
         above still holds the merchant's text. */
      wouldPublish: {
        name: wouldPublish.name,
        phone: wouldPublish.phone,
        email: wouldPublish.email,
        address: wouldPublish.address,
        hours: wouldPublish.hours,
      },
    },
    // payments config rides along so the UI can warn LOUDLY when charges are mock —
    // an operator must never discover "TEST MODE" from a customer's bank statement
    payments: offers.paymentsConfig?.() ?? { provider: 'none', mode: null, publishableKey: null, connect: false, terminal: false },
  });
});

/* ordering controls: pause the kitchen, mark holidays. Enforced server-side in
   the public order/booking routes — this is state, not just UI. */
routes.get('/settings/ordering', async (c) =>
  c.json({ pausedUntil: await getPause(), blackoutDates: await getBlackoutDates() }));

routes.patch('/settings/ordering', async (c) => {
  const body = z
    .object({
      pausedUntil: z.string().datetime().nullable().optional(),
      blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  if (body.data.pausedUntil !== undefined) await setPause(body.data.pausedUntil);
  if (body.data.blackoutDates) await setBlackoutDates(body.data.blackoutDates);
  return c.json({ pausedUntil: await getPause(), blackoutDates: await getBlackoutDates() });
});

/* Anything that becomes a public URI target must clear the same bar the
   exporter sets, or the back office becomes a way to put an arbitrary string
   into a `tel:` href on a live customer site. `''` stays legal and means
   "we do not publish one" — the exporter's own value for an unusable contact,
   so clearing the field here lands the site in a state it already knows how to
   render (no link at all, rather than a dead one).

   This is stricter than what this endpoint used to accept, deliberately, and it
   rejects some things a US merchant will reasonably type: the shared rule
   anchors on `^\+?[0-9]`, so "(512) 555-0111" fails while "512-555-0111" and
   "+1 512 555 0111" pass. Being told that is strictly better than the old
   behaviour, which took the value, stored it, and silently published nothing. */
const publicPhoneField = z
  .string()
  .refine((v) => v.trim() === '' || publicPhone(v) !== null, {
    message: 'Enter a phone number we can dial, e.g. 512-555-0111 or +1 512 555 0111. Brackets are not accepted.',
  });
const publicEmailField = z
  .string()
  .refine((v) => v.trim() === '' || publicEmail(v) !== null, { message: 'Enter a real email address, e.g. hello@yourshop.com' });

routes.patch('/settings', async (c) => {
  const body = z
    .object({
      name: z.string().min(1).optional(),
      phone: publicPhoneField.optional(),
      email: publicEmailField.optional(),
      address: z.object({ line1: z.string(), city: z.string(), state: z.string(), zip: z.string() }).optional(),
      taxRateBp: z.number().int().min(0).max(3000).optional(),
      hours: z.record(z.union([z.array(z.tuple([z.string(), z.string()])), z.null()])).optional(),
      delivery: z
        .object({ enabled: z.boolean(), feeCents: z.number().int(), minCents: z.number().int(), zips: z.array(z.string()) })
        .nullable()
        .optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues, message: body.error.issues[0]?.message } }, 400);
  const current = await db.business.findFirstOrThrow();
  const updated = await db.business.update({
    where: { id: current.id },
    data: body.data as object,
  });

  /* Who owns each public field, recomputed from the saved row rather than from
     what this request happened to touch. A field whose value differs from what
     Studio published is a field the merchant chose; a field they typed back to
     the published value is a field they handed back. That makes "Use published
     value" a plain save instead of a second endpoint with its own permission
     to classify wrongly, and it makes the record stateless — no accumulation to
     drift, no way for two saves to disagree about who owns what. */
  const overrides = await recordOverrides(overridesFor(updated));
  await revalidateBusiness();

  /* Answer from the row that was just written, not from the cache we just
     purged: a read-back through `unstable_cache` inside the same request is one
     more thing that has to be true for the merchant to see their own save.

     Resolved over every public field, exactly like the GET, so the form is
     refilled from one rule. After a save the two are the same set anyway —
     every field that diverges from the published value was just recorded. */
  const { name, phone, email, address, hours } = resolvePublicBusiness(updated, PUBLIC_BUSINESS_FIELDS);
  return c.json({
    ...updated,
    name,
    phone,
    email,
    address,
    hours,
    // nothing can be stranded straight after a save: every field that differs
    // from the published value was just recorded as the merchant's
    profile: { overrides, stranded: [] as string[], published: publishedBusiness() },
  });
});
