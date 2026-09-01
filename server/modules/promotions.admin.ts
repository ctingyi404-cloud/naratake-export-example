/* Admin API — coupons, gift cards, and mailing a coupon to the audience. */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { money } from '@/lib/money';
import { couponValueError } from '@/lib/redemption';
import { broadcast } from './_broadcast';

export const routes = new Hono();

/* ── coupons ── */

const CouponBody = z.object({
  code: z.string().min(2).max(24),
  kind: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().min(1),
  minSubtotalCents: z.number().int().nullable().optional(),
  description: z.string().optional().nullable(),
  maxRedemptions: z.number().int().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(), // quote.ts already enforces expiry
  active: z.boolean().optional(),
  signupReward: z.boolean().optional(),
});

/* at most one coupon is THE signup reward — clear the flag elsewhere first */
const claimSignupReward = () =>
  db.coupon.updateMany({ where: { signupReward: true }, data: { signupReward: false } });

routes.get('/coupons', async (c) => c.json({ coupons: await db.coupon.findMany() }));
routes.post('/coupons', async (c) => {
  const body = CouponBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  // a 150% coupon would record discountCents > subtotal (audit commerce#12)
  const bad = couponValueError(body.data.kind, body.data.value);
  if (bad) return c.json({ error: { code: 'VALIDATION', message: bad } }, 400);
  if (body.data.signupReward) await claimSignupReward();
  return c.json(await db.coupon.create({ data: { ...body.data, code: body.data.code.toUpperCase() } }));
});
routes.patch('/coupons/:id', async (c) => {
  const body = CouponBody.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  // clamp against the EFFECTIVE kind/value pair — a partial PATCH can flip
  // either side (audit commerce#12)
  if (body.data.value !== undefined || body.data.kind !== undefined) {
    const current = await db.coupon.findUnique({ where: { id: c.req.param('id') } });
    if (!current) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    const bad = couponValueError(
      (body.data.kind ?? current.kind) as 'PERCENT' | 'FIXED',
      body.data.value ?? current.value,
    );
    if (bad) return c.json({ error: { code: 'VALIDATION', message: bad } }, 400);
  }
  if (body.data.signupReward) await claimSignupReward();
  return c.json(await db.coupon.update({ where: { id: c.req.param('id') }, data: body.data }));
});
routes.delete('/coupons/:id', async (c) => {
  await db.coupon.delete({ where: { id: c.req.param('id') } });
  return c.json({ ok: true });
});

routes.post('/marketing/coupons/:id/send', async (c) => {
  const coupon = await db.coupon.findUnique({ where: { id: c.req.param('id') } });
  if (!coupon) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  if (!coupon.active)
    return c.json({ error: { code: 'VALIDATION', message: 'Coupon is disabled — enable it first' } }, 400);
  const off = coupon.kind === 'PERCENT' ? `${coupon.value}% off` : `${money(coupon.value)} off`;
  return c.json(
    await broadcast(`${off} for you — code ${coupon.code}`, [
      coupon.description ?? `Here's ${off} on your next order, just for our subscribers.`,
      `Use code <strong style="letter-spacing:2px">${coupon.code}</strong> at checkout.`,
      coupon.minSubtotalCents ? `Valid on orders over ${money(coupon.minSubtotalCents)}.` : '',
    ].filter(Boolean)),
  );
});

/* ── gift cards ── */

routes.get('/giftcards', async (c) =>
  c.json({ giftcards: await db.giftCard.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }),
);

/* deactivate/reactivate — a lost or disputed card must be stoppable */
routes.patch('/giftcards/:id', async (c) => {
  const body = z.object({ active: z.boolean() }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  return c.json(await db.giftCard.update({ where: { id: c.req.param('id') }, data: body.data }));
});

routes.post('/giftcards/issue', async (c) => {
  const body = z
    .object({ amountCents: z.number().int().min(100).max(100000), note: z.string().optional() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const { randomBytes } = await import('node:crypto');
  const code = `GC-${randomBytes(4).toString('hex').toUpperCase()}`;
  return c.json(
    await db.giftCard.create({
      data: { code, initialCents: body.data.amountCents, balanceCents: body.data.amountCents },
    }),
  );
});
