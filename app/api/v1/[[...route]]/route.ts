import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { publicRoutes } from '@/server/public';
import { assistantRoutes } from '@/server/assistant';
import { adminRoutes } from '@/server/admin';
import { cronRoutes } from '@/server/cron';

export const dynamic = 'force-dynamic';

/* Vercel kills a function at maxDuration, and the platform default (10–15s) is
   shorter than the register's card-present poll: the function died while a
   customer's card was on the reader, and the authorisation stayed alive with
   nobody left holding the intent id to cancel it. 60s is the ceiling every plan
   allows, and a ceiling costs nothing — a request that finishes in 40ms still
   finishes in 40ms.

   This is the floor, not the fix. server/pos.ts also splits the charge into
   start + status + abandon so no request has to hold a connection open across a
   human decision at all; the long-poll route stays only until the register UI
   moves to it. */
export const maxDuration = 60;

const app = new Hono().basePath('/api/v1');

app.route('/admin', adminRoutes);
app.route('/cron', cronRoutes);
app.route('/', assistantRoutes);
app.route('/', publicRoutes);

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND' } }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, 500);
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
