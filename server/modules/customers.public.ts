/* customers — public routes (loyalty, website forms, unsubscribe). */

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { signData } from '@/lib/auth';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';
import { emailShell, marketingShell, notifyOwner, sendEmail } from '@/lib/notify';
import { findMemberByPhone } from '@/lib/member';
import { tok } from '@/lib/codes';
import { clientIp, limited } from '../shared';

export const routes = new Hono();

/* ── loyalty ── */

routes.post('/loyalty/balance', async (c) => {
  // a membership+points oracle for any known phone — rate-limit it hard
  if (await limited(`loybal:${clientIp(c)}`, 8)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = z.object({ phone: z.string().min(4) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  // exact normalized last-10 match across all candidates — a contains-first-match
  // let another customer sharing the last-4 shadow the real member
  const member = await findMemberByPhone(db, body.data.phone);
  if (!member) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  return c.json({ points: member.loyaltyPoints });
});

/* ── forms ── */

const FormBody = z.object({
  kind: z.enum(['contact', 'newsletter', 'quote']),
  name: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  message: z.string().max(2000).optional(),
  meta: z.record(z.unknown()).optional(),
  website: z.string().optional(),
});

routes.post('/forms', async (c) => {
  const ip = clientIp(c);
  if (await limited(`forms:${ip}`)) return c.json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = FormBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', issues: body.error.issues } }, 400);
  if (body.data.website) return c.json({ error: { code: 'VALIDATION' } }, 400);

  // orders owns turning a quote request into an order; without that module the
  // request falls through to the inbox below, where the owner still sees it
  if (body.data.kind === 'quote' && offers.createQuoteOrder) {
    const business = await db.business.findFirstOrThrow();
    const order = await offers.createQuoteOrder(db, body.data as { name?: string; phone?: string; email?: string; message?: string; meta?: object });
    // the platform hears every inquiry the owner does (form.submitted, §5.1);
    // fire-and-forget by contract — the customer's submit never waits on it
    await offers.platformEmit?.(db, 'form.submitted', {
      name: body.data.name, phone: body.data.phone, email: body.data.email,
      message: body.data.message, formKind: 'quote',
    });
    await notifyOwner(
      `New quote request from ${order.contactName}`,
      emailShell(business.name, `Quote request ${order.code}`, [
        `${order.contactName} · ${order.contactPhone}${order.contactEmail ? ` · ${order.contactEmail}` : ''}`,
        body.data.message ? `“${body.data.message}”` : '',
        'Reply from the back office → Orders.',
      ].filter(Boolean)),
    );
    return c.json({ ok: true, code: order.code });
  }

  await db.formSubmission.create({
    data: {
      kind: body.data.kind,
      name: body.data.name,
      email: body.data.email || null,
      phone: body.data.phone,
      message: body.data.message,
      meta: body.data.meta as object | undefined,
    },
  });
  if (body.data.kind !== 'newsletter') {
    // newsletter signups are list-building, not leads — they stay out of the inbox
    await offers.platformEmit?.(db, 'form.submitted', {
      name: body.data.name, phone: body.data.phone, email: body.data.email,
      message: body.data.message, formKind: body.data.kind,
    });
    const business = await db.business.findFirstOrThrow();
    await notifyOwner(
      `✉️ New ${body.data.kind} message${body.data.name ? ` from ${body.data.name}` : ''}`,
      emailShell(business.name, 'New website message', [
        [body.data.name, body.data.phone, body.data.email].filter(Boolean).join(' · '),
        body.data.message ? `“${body.data.message}”` : '',
      ].filter(Boolean)),
    );
    if (body.data.email) {
      await sendEmail(
        body.data.email,
        `We got your message — ${business.name}`,
        emailShell(business.name, 'Thanks for reaching out', [
          `We received your message and will get back to you within one business day.`,
          `Need us sooner? Call ${business.phone}.`,
        ]),
      );
    }
  }
  if (body.data.kind === 'newsletter' && body.data.email) {
    try {
      const email = body.data.email;
      const existing = await db.customer.findUnique({ where: { email } });
      await db.customer.upsert({
        where: { email },
        update: { marketingOptIn: true },
        create: { email, marketingOptIn: true },
      });
      // welcome email (with the signup-reward coupon when one is active) — only
      // on a NEW opt-in, so re-submitting the form never spams an existing fan.
      // The coupon is promotions' to read: no coupons means no code, and the
      // mail still goes — it confirms the subscription, which is its own reason
      // to exist, and closes on the postal address CAN-SPAM requires.
      if (!existing?.marketingOptIn) {
        const business = await db.business.findFirstOrThrow();
        const reward = (await offers.signupReward?.(db)) ?? null;
        const addr = business.address as { line1: string; city: string; state: string; zip: string };
        const rows = [
          `Thanks for joining the ${business.name} list — offers and news land here first.`,
          ...(reward
            ? [
                `Here's a welcome treat: use code <strong>${reward.code}</strong> ${
                  reward.kind === 'PERCENT' ? `for ${reward.value}% off` : `for $${(reward.value / 100).toFixed(2).replace(/\.00$/, '')} off`
                }${reward.minSubtotalCents ? ` orders over $${(reward.minSubtotalCents / 100).toFixed(2).replace(/\.00$/, '')}` : ''}.`,
              ]
            : []),
          `${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip}`,
        ];
        await sendEmail(email, `Welcome to ${business.name}`, marketingShell(business.name, 'You’re on the list', rows, email));
      }
    } catch { /* fine */ }
  }
  return c.json({ ok: true });
});

/* ── unsubscribe (CAN-SPAM) — every marketing email links here ──
   The HMAC sig proves the link came from one of our emails, so a plain GET
   can flip the opt-out with no login. Only signed emails ever reach the
   success page, so echoing the address back is safe. */

const unsubPage = (rows: string) =>
  `<!doctype html><body style="font-family:system-ui,sans-serif;text-align:center;padding:80px 24px">${rows}</body>`;

routes.get('/unsubscribe', async (c) => {
  const email = c.req.query('email') ?? '';
  const sig = c.req.query('sig') ?? '';
  if (!email || sig !== signData(`unsub:${email}`))
    return c.html(unsubPage('<h1 style="font-size:20px">This unsubscribe link is invalid.</h1>'), 400);
  await db.customer.updateMany({ where: { email }, data: { marketingOptIn: false } });
  return c.html(
    unsubPage(
      `<h1 style="font-size:22px">You're unsubscribed.</h1><p style="color:#666">${email} will no longer receive marketing emails from us.</p>`,
    ),
  );
});
