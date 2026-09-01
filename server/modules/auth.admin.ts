/* Admin API — the people who can sign in.

   CORE, unlike its neighbours in this folder: every site has logins whatever
   modules are on, so codegen always keeps it in admin.registry.ts.

   No role check in here. `users` is the one resource lib/permissions.ts grants
   to OWNER alone, and server/admin.ts applies that before any of these handlers
   run — the same single gate as every other route. */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { ROLES } from '@/lib/permissions';

export const routes = new Hono();

/** never select passwordHash — it has no business leaving the database */
const view = { id: true, email: true, name: true, role: true, active: true, createdAt: true } as const;

const Role = z.enum(ROLES);

/* The invariant that matters more than any permission: a site must never reach
   zero active owners, or the merchant is locked out of their own business.

   Checked AFTER the write, inside the transaction, so two owners demoting each
   other in the same second cannot both pass a before-the-fact count — the loser
   rolls back. A plain "count first" check cannot promise that. */
type Tx = Omit<typeof db, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;
class LastOwner extends Error {}

async function keepingAnOwner<T>(work: (tx: Tx) => Promise<T>): Promise<T | null> {
  try {
    return await db.$transaction(async (tx) => {
      const out = await work(tx);
      if ((await tx.adminUser.count({ where: { role: 'OWNER', active: true } })) === 0) throw new LastOwner();
      return out;
    });
  } catch (err) {
    if (err instanceof LastOwner) return null;
    throw err;
  }
}

const lockout = (c: Context) =>
  c.json(
    {
      error: {
        code: 'LAST_OWNER',
        message: 'This is the last owner account. Make someone else an owner first',
      },
    },
    409,
  );

/* ── users ── */

routes.get('/users', async (c) =>
  c.json({ users: await db.adminUser.findMany({ select: view, orderBy: { createdAt: 'asc' } }) }),
);

routes.post('/users', async (c) => {
  const body = z
    .object({
      email: z.string().email(),
      name: z.string().trim().min(1),
      password: z.string().min(8),
      role: Role,
    })
    .safeParse(await c.req.json());
  if (!body.success)
    return c.json(
      {
        error: {
          code: 'VALIDATION',
          message: 'A name, a valid email, a role, and a password of 8 or more characters are required',
        },
      },
      400,
    );
  try {
    const user = await db.adminUser.create({
      data: {
        email: body.data.email.toLowerCase(),
        name: body.data.name,
        role: body.data.role,
        // the same scrypt hashing the seeded owner got; no second password path
        passwordHash: hashPassword(body.data.password),
      },
      select: view,
    });
    return c.json({ user }, 201);
  } catch {
    // the unique index on email is the real check; two racing creates land here
    return c.json({ error: { code: 'CONFLICT', message: 'Someone already uses that email' } }, 409);
  }
});

routes.patch('/users/:id', async (c) => {
  const body = z
    .object({
      name: z.string().trim().min(1).optional(),
      role: Role.optional(),
      active: z.boolean().optional(),
      password: z.string().min(8).optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success)
    return c.json({ error: { code: 'VALIDATION', message: 'A new password must be 8 or more characters' } }, 400);
  const id = c.req.param('id');
  if (!(await db.adminUser.findUnique({ where: { id } }))) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const { password, ...rest } = body.data;
  const user = await keepingAnOwner((tx) =>
    tx.adminUser.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: hashPassword(password) } : {}) },
      select: view,
    }),
  );
  if (!user) return lockout(c);
  return c.json({ user });
});

routes.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await db.adminUser.findUnique({ where: { id } }))) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  const gone = await keepingAnOwner((tx) => tx.adminUser.delete({ where: { id } }));
  if (!gone) return lockout(c);
  return c.json({ ok: true });
});
