/* Admin API — media uploads. */

import { Hono } from 'hono';
import { db } from '@/lib/db';

export const routes = new Hono();

/* ── media ── */

routes.post('/media', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: { code: 'VALIDATION' } }, 400);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: { code: 'VALIDATION', message: 'Max 5MB' } }, 400);
  // No image/svg+xml: media is served same-origin with its stored mime and no
  // sanitization, so an uploaded SVG carrying <script> is a stored-XSS primitive
  // that runs in the site's origin. Raster formats only (matches the public path).
  const okTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!okTypes.includes(file.type)) return c.json({ error: { code: 'VALIDATION', message: 'Images only' } }, 400);
  // database, not filesystem: serverless deploys (Vercel) have a read-only fs,
  // so a disk write means every real-world upload fails with EROFS
  const asset = await db.mediaAsset.create({
    data: { data: Buffer.from(await file.arrayBuffer()), mime: file.type },
  });
  return c.json({ url: `/api/v1/media/${asset.id}` });
});
