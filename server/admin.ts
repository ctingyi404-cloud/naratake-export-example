/* Admin API — the session gate and the routes that guard it.

   Auth, the session middleware and the permission check are CORE: they ship
   with every site. Every merchant-facing surface (catalog, orders, bookings,
   marketing…) lives in server/modules/<module>.admin.ts and is mounted at the
   bottom of this file, AFTER the middleware — so a moved route is still 401
   without a session, and still 403 for a role that may not reach it. */

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashPassword, SESSION_COOKIE, signToken, verifyPassword, verifyToken } from '@/lib/auth';
import { record, requestMeta } from '@/lib/audit';
import { actionOf, adminPath, can, resourceOf } from '@/lib/permissions';
import { clientIp, limited } from './shared';
import { offers } from '@/lib/hooks';
import '@/lib/hooks-init';
import { ADMIN_MODULE_ROUTES } from './modules/admin.registry';

export const adminRoutes = new Hono();

/* ── auth ── */

adminRoutes.post('/auth/login', async (c) => {
  /* The one unauthenticated write in the back office, so the one that can be
     guessed at forever. Same limiter the public forms use; clientIp takes the
     rightmost x-forwarded-for token, which a client cannot append past. */
  if (await limited(`admin-login:${clientIp(c)}`, 10))
    return c.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a minute and try again' } },
      429,
    );
  const body = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION' } }, 400);
  const user = await db.adminUser.findUnique({ where: { email: body.data.email.toLowerCase() } });
  if (!user || !user.active || !verifyPassword(body.data.password, user.passwordHash))
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Wrong email or password' } }, 401);
  const token = signToken({ sub: user.id, role: user.role });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return c.json({ ok: true, name: user.name, role: user.role });
});

adminRoutes.post('/auth/logout', async (c) => {
  /* Sign out of BOTH apps. The Inquiries door hands this person an inbox
     session; leaving it open on a shared front-counter machine after a
     deliberate sign-out is how "I logged out" becomes false. Read who this is
     BEFORE dropping the cookie, and never let the remote call delay the local
     logout — offers.platformSignOut is best-effort by contract. */
  const payload = verifyToken(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (payload && offers.platformSignOut) {
    const user = await db.adminUser.findUnique({ where: { id: payload.sub } });
    if (user) await offers.platformSignOut(user.email).catch(() => {});
  }
  return c.json({ ok: true });
});

/* Everything below requires a session, AND a role allowed to do this to this.

   The check lives here rather than in the handlers on purpose: Hono runs
   handlers in registration order and the module routes mount at the bottom of
   this file, so every back-office route in the site passes through these lines.
   There is no route to forget to guard. lib/permissions.ts holds the table. */
adminRoutes.use('*', async (c, next) => {
  const payload = verifyToken(getCookie(c, SESSION_COOKIE));
  if (!payload) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);

  /* The token carries a role, but the ROW is the truth. Reading it per request
     is what makes "demote" and "deactivate" take effect now instead of whenever
     a 12-hour cookie happens to expire — the difference between firing someone
     and firing someone who still has the till until tonight. */
  const user = await db.adminUser.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);

  const path = adminPath(c.req.path);
  const action = actionOf(c.req.method, path);
  const resource = resourceOf(path);
  const actor = { id: user.id, name: user.name };

  if (!can(user.role, action, resource)) {
    // a refused privileged attempt is exactly what a trail is for
    await record(actor, `${action}:${resource}`, path, { denied: true, role: user.role });
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Your account does not have permission to do that' } },
      403,
    );
  }

  c.set('userId' as never, user.id as never);
  // who is acting, for anything that records a decision (a revision, a correction)
  c.set('actor' as never, (user.name || user.email) as never);
  if (action === 'read') return next(); // reads are not events; logging them buries the ones that are

  /* Read the payload BEFORE the handler consumes it (Hono caches the parse, so
     the handler still sees it), write the row after, with what happened.

     Never the body of a credential route: change-password calls its fields
     `current` and `next`, names no key-based redaction can recognize as
     secrets, and an append-only table is a bad place to learn that. The row
     itself still records that the password was changed, by whom, when. */
  const meta = resource === 'account' ? undefined : await requestMeta(c);
  await next();
  await record(actor, `${action}:${resource}`, path, { ...meta, status: c.res.status });
});

adminRoutes.get('/me', async (c) => {
  const payload = verifyToken(getCookie(c, SESSION_COOKIE))!;
  const user = await db.adminUser.findUnique({ where: { id: payload.sub } });
  return c.json({ id: user?.id, name: user?.name, email: user?.email, role: user?.role });
});

adminRoutes.post('/auth/change-password', async (c) => {
  const payload = verifyToken(getCookie(c, SESSION_COOKIE))!;
  const body = z
    .object({ current: z.string(), next: z.string().min(8) })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: { code: 'VALIDATION', message: 'New password must be 8+ characters' } }, 400);
  const user = await db.adminUser.findUniqueOrThrow({ where: { id: payload.sub } });
  if (!verifyPassword(body.data.current, user.passwordHash))
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Current password is wrong' } }, 401);
  await db.adminUser.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(body.data.next) },
  });
  return c.json({ ok: true });
});

/* Module routes, mounted last on purpose: Hono runs the handlers a request
   matches in REGISTRATION order, so the session middleware above always runs
   first. Moving this loop above the `use('*')` would open the whole back
   office to anyone. */
for (const routes of ADMIN_MODULE_ROUTES) adminRoutes.route('/', routes);
