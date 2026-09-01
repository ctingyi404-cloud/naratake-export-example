/* Admin API — catalog (categories, items, reorder, bulk import, CSV export). */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { parseMoneyCents, toCsv } from '@/lib/csv';

export const routes = new Hono();

/* ── catalog ── */

routes.get('/catalog', async (c) => {
  const categories = await db.category.findMany({
    orderBy: { sort: 'asc' },
    include: { items: { orderBy: { sort: 'asc' } } },
  });
  return c.json({ categories });
});

const CategoryBody = z.object({ name: z.string().min(1), nameZh: z.string().optional(), type: z.enum(['MENU', 'PRODUCT', 'SERVICE']) });

routes.post('/catalog/categories', async (c) => {
  const body = CategoryBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  // max+1, not count(): after a delete, count() reissues a taken sort value
  const max = await db.category.aggregate({ _max: { sort: true } });
  return c.json(await db.category.create({ data: { ...body.data, sort: (max._max.sort ?? -1) + 1 } }));
});

routes.patch('/catalog/categories/:id', async (c) => {
  const body = CategoryBody.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  return c.json(await db.category.update({ where: { id: c.req.param('id') }, data: body.data }));
});

routes.delete('/catalog/categories/:id', async (c) => {
  await db.category.delete({ where: { id: c.req.param('id') } });
  return c.json({ ok: true });
});

const ItemBody = z.object({
  categoryId: z.string(),
  name: z.string().min(1),
  nameZh: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  descriptionZh: z.string().optional().nullable(),
  priceCents: z.number().int().min(0),
  imageUrl: z.string().optional().nullable(),
  available: z.boolean().optional(),
  taxable: z.boolean().optional(), // services are sales-tax exempt in most US states
  badges: z.array(z.string()).optional(),
  durationMin: z.number().int().nullable().optional(),
  depositCents: z.number().int().nullable().optional(),
  modifiers: z
    .array(
      z.object({
        name: z.string(),
        min: z.number().int(),
        max: z.number().int(),
        options: z.array(z.object({ name: z.string(), priceCents: z.number().int() })),
      }),
    )
    .optional(),
});

routes.post('/catalog/items', async (c) => {
  const body = ItemBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  const max = await db.item.aggregate({ where: { categoryId: body.data.categoryId }, _max: { sort: true } });
  return c.json(
    await db.item.create({
      data: { ...body.data, badges: body.data.badges ?? [], modifiers: body.data.modifiers ?? [], sort: (max._max.sort ?? -1) + 1 } as never,
    }),
  );
});

/* one transaction re-numbers an ordered id list — the storefront shows exactly
   this order (public routes orderBy sort asc) */
routes.patch('/catalog/reorder', async (c) => {
  const body = z
    .object({ categoryIds: z.array(z.string()).optional(), itemIds: z.array(z.string()).optional() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  if (body.data.categoryIds)
    await db.$transaction(body.data.categoryIds.map((id, i) => db.category.update({ where: { id }, data: { sort: i } })));
  if (body.data.itemIds)
    await db.$transaction(body.data.itemIds.map((id, i) => db.item.update({ where: { id }, data: { sort: i } })));
  return c.json({ ok: true });
});

/* paste-in bulk import: 40 lines of "name, price" become 40 items in one call */
routes.post('/catalog/items/bulk', async (c) => {
  const body = z
    .object({
      categoryId: z.string(),
      items: z
        .array(z.object({ name: z.string().min(1), priceCents: z.number().int().min(0), description: z.string().optional() }))
        .min(1)
        .max(200),
    })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  const { categoryId, items } = body.data;
  const max = await db.item.aggregate({ where: { categoryId }, _max: { sort: true } });
  const base = (max._max.sort ?? -1) + 1;
  await db.$transaction(
    items.map((it, i) =>
      db.item.create({ data: { categoryId, ...it, badges: [], modifiers: [], sort: base + i } as never }),
    ),
  );
  return c.json({ created: items.length });
});

/* The download half of the round trip. It used to hand-roll its own escaping
   and emit no BOM, so the file it produced could not be opened cleanly in Excel
   in Chinese and did not match what the importer expects — one format, one
   file, or "download, edit, upload" is a promise the product cannot keep. */
routes.get('/catalog/export.csv', async (c) => {
  const cats = await db.category.findMany({ orderBy: { sort: 'asc' }, include: { items: { orderBy: { sort: 'asc' } } } });
  const rows: (string | number)[][] = [CATALOG_HEADERS.slice()];
  for (const cat of cats)
    for (const it of cat.items)
      rows.push([cat.name, it.name, it.nameZh ?? '', (it.priceCents / 100).toFixed(2), it.description ?? '', it.available ? '1' : '0']);
  return c.text(toCsv(rows), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="catalog.csv"',
  });
});

/** The columns of catalog.csv, in order. The importer reads by header name, so
    a merchant may reorder or omit columns — this is the shape we WRITE. */
export const CATALOG_HEADERS = ['category', 'name', 'nameZh', 'price', 'description', 'available'];

/* The upload half.

   A merchant arrives with a spreadsheet from their POS and used to retype it
   row by row, which is where a site stops being worth the afternoon. Rows are
   matched on (category, name) so the same file can be uploaded twice: the
   second run updates instead of duplicating, which is what "edit the file and
   send it again" has to mean. Categories are created as needed.

   Never all-or-nothing: one bad price must not reject 199 good rows, so every
   failure is reported with its line number and the rest still land. */
routes.post('/catalog/import', async (c) => {
  const body = z
    .object({
      rows: z
        .array(
          z.object({
            category: z.string().optional(),
            name: z.string().optional(),
            nameZh: z.string().optional(),
            price: z.string().optional(),
            description: z.string().optional(),
            available: z.string().optional(),
          }),
        )
        .min(1)
        .max(1000),
      /** what a category with no `type` column becomes */
      defaultType: z.enum(['MENU', 'PRODUCT', 'SERVICE']).optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);

  const defaultType = body.data.defaultType ?? 'MENU';
  let created = 0;
  let updated = 0;
  const failed: { line: number; name: string; reason: string }[] = [];
  // cache by lowercased name so "Appetizers" and "appetizers" are one category
  const catCache = new Map<string, string>();

  for (const [i, raw] of body.data.rows.entries()) {
    const line = i + 2; // +1 for the header row, +1 because humans count from 1
    const name = (raw.name ?? '').trim();
    const catName = (raw.category ?? '').trim() || 'Menu';
    try {
      if (!name) { failed.push({ line, name: '', reason: 'no name' }); continue; }
      const priceCents = parseMoneyCents(raw.price);
      if (priceCents == null) { failed.push({ line, name, reason: `price "${raw.price ?? ''}" is not a number` }); continue; }
      if (priceCents < 0) { failed.push({ line, name, reason: 'price is negative' }); continue; }

      const key = catName.toLowerCase();
      let categoryId = catCache.get(key);
      if (!categoryId) {
        const existing = await db.category.findFirst({ where: { name: { equals: catName } } });
        if (existing) categoryId = existing.id;
        else {
          const max = await db.category.aggregate({ _max: { sort: true } });
          const cat = await db.category.create({ data: { name: catName, type: defaultType, sort: (max._max.sort ?? -1) + 1 } });
          categoryId = cat.id;
        }
        catCache.set(key, categoryId);
      }

      const available = raw.available == null || raw.available === '' ? undefined : /^(1|true|yes|y|是|有)$/i.test(raw.available.trim());
      const prior = await db.item.findFirst({ where: { categoryId, name } });
      const data = {
        name,
        nameZh: raw.nameZh?.trim() || null,
        description: raw.description?.trim() || null,
        priceCents,
        ...(available === undefined ? {} : { available }),
      };
      if (prior) {
        await db.item.update({ where: { id: prior.id }, data });
        updated++;
      } else {
        const max = await db.item.aggregate({ where: { categoryId }, _max: { sort: true } });
        await db.item.create({ data: { categoryId, ...data, badges: [], modifiers: [], sort: (max._max.sort ?? -1) + 1 } as never });
        created++;
      }
    } catch (e) {
      failed.push({ line, name, reason: e instanceof Error ? e.message : 'could not save' });
    }
  }
  return c.json({ created, updated, failed });
});

routes.patch('/catalog/items/:id', async (c) => {
  const body = ItemBody.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  return c.json(await db.item.update({ where: { id: c.req.param('id') }, data: body.data as never }));
});

routes.delete('/catalog/items/:id', async (c) => {
  await db.item.delete({ where: { id: c.req.param('id') } });
  return c.json({ ok: true });
});
