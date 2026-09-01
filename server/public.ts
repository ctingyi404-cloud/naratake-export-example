/* Public API consumed by the storefront. Mounted under /api/v1.

   A registry, not a route file: the handful of routes every site has live here,
   and each optional module's routes live in server/modules/<id>.public.ts and
   are mounted below. Codegen regenerates this list with only the enabled
   modules, so a disabled module's code never ships. Mount order follows the
   order the routes were declared in before the split — no two patterns overlap
   today, and keeping the order means none can start shadowing another. */

import { Hono } from 'hono';
import { db } from '@/lib/db';
import { businessSnapshot } from '@/lib/business-db';
import { clientIp, limited } from './shared';
/* ── REGISTRY ─────────────────────────────────────────────── */
import { routes as catalogRoutes } from './modules/catalog.public';
import { routes as ordersRoutes } from './modules/orders.public';
import { routes as paymentsRoutes } from './modules/payments.public';
import { routes as promotionsRoutes } from './modules/promotions.public';
import { routes as customersRoutes } from './modules/customers.public';

const MODULE_ROUTES = [catalogRoutes, ordersRoutes, paymentsRoutes, promotionsRoutes, customersRoutes];
/* ── END REGISTRY ─────────────────────────────────────── */

export const publicRoutes = new Hono();

/* ── core (always on: settings + media) ── */

/* The one endpoint that tells the storefront who this business is.

   The profile half (name/phone/email/address/hours) is RESOLVED, not raw: a
   field the merchant has taken over in the back office comes from the row, and
   every other field comes from the config the site was published with, so a
   site nobody has edited answers exactly what its pages already render. The
   operational half stays the raw row, as it always has — ordering and slot
   maths have read the row directly for as long as they have existed.

   Cached and purged on save (lib/business-db.ts), because every page's footer
   and navbar now ask this question after mount. */
publicRoutes.get('/business', async (c) => {
  const s = await businessSnapshot();
  return c.json({
    name: s.profile.name,
    phone: s.profile.phone,
    email: s.profile.email,
    address: s.profile.address,
    timezone: s.timezone,
    taxRateBp: s.taxRateBp,
    hours: s.profile.hours,
    delivery: s.delivery,
  });
});

/* admin uploads live in the DB (serverless fs is read-only); ids are immutable
   so the CDN/browser may cache forever */
publicRoutes.get('/media/:id', async (c) => {
  const a = await db.mediaAsset.findUnique({ where: { id: c.req.param('id') } });
  if (!a) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  return c.body(new Uint8Array(a.data), 200, { 'content-type': a.mime, 'cache-control': 'public, max-age=31536000, immutable' });
});

/* ── public photo upload (quote requests) ── */

publicRoutes.post('/forms/upload', async (c) => {
  const ip = clientIp(c);
  if (await limited(`upload:${ip}`, 10)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: { code: 'VALIDATION' } }, 400);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: { code: 'VALIDATION', message: 'Max 5MB' } }, 400);
  const okTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!okTypes.includes(file.type)) return c.json({ error: { code: 'VALIDATION', message: 'Images only' } }, 400);
  // database, not filesystem — serverless deploys (Vercel) have a read-only fs,
  // so the old disk write meant every real-world quote photo died with EROFS
  const asset = await db.mediaAsset.create({
    data: { data: Buffer.from(await file.arrayBuffer()), mime: file.type },
  });
  return c.json({ url: `/api/v1/media/${asset.id}` });
});

/* ── modules ── */

MODULE_ROUTES.forEach((r) => publicRoutes.route('/', r));
