/* Append-only record of what an operator did in the back office.

   CORE: "who refunded that order" must not depend on which optional modules a
   merchant enabled, so the model lives in prisma/base.prisma and this file
   ships with every site.

   Append-only is a property of the code, not of the database: nothing anywhere
   updates or deletes an AuditLog row. A log you can edit is not a log.

   The single writer is the session middleware in server/admin.ts. One writer at
   the one gate every admin route is mounted behind is the same trick the
   permission table uses: a new route is audited the moment it exists, including
   the money routes, the publish routes, and the user routes. */

import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

export interface Actor {
  id: string;
  name: string;
}

/* WHAT a request acted on, as opposed to which route did the acting.

   A story is edited through /collections/entries/:id, moved through
   /desk/:id and corrected through /collections/entries/:id/notes. Those are
   three different paths and one subject, and an editor asking "what happened to
   this piece" wants all three. Derived here rather than declared per route, so a
   route added tomorrow is attributed the day it exists — the same bet the
   permission table makes.

   The id is taken from the FIRST id-shaped segment, not the last: under
   .../entries/<entry>/revisions/<rev> the thing being acted on is the entry, and
   the revision is what it was acted on WITH. */
const SUBJECTS: [RegExp, string][] = [
  [/^\/collections\/entries\/([^/]+)/, 'entry'],
  [/^\/desk\/([^/]+)/, 'entry'],
  [/^\/orders\/([^/]+)/, 'order'],
  [/^\/catalog\/items\/([^/]+)/, 'item'],
  [/^\/customers\/([^/]+)/, 'customer'],
  [/^\/reservations\/([^/]+)/, 'reservation'],
  [/^\/appointments\/([^/]+)/, 'appointment'],
  [/^\/users\/([^/]+)/, 'user'],
];

/** Reserved words that are route shape rather than an identifier. */
/* Route words that sit where an id goes. Without 'diary' every request to
   /desk/diary was filed as a change to a story whose id was literally "diary",
   so a story's own history could not be trusted to be about that story. */
const NOT_AN_ID = new Set(['entries', 'people', 'search', 'export', 'bulk', 'me', 'diary', 'collections']);

export function subjectOf(path: string): { subjectType: string | null; subjectId: string | null } {
  for (const [re, type] of SUBJECTS) {
    const hit = re.exec(path);
    if (hit && !NOT_AN_ID.has(hit[1])) return { subjectType: type, subjectId: hit[1] };
  }
  return { subjectType: null, subjectId: null };
}

export async function record(
  actor: Actor,
  action: string,
  target: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.auditLog.create({
      // Prisma's JSON input type cannot express "some plain JSON record", so it
      // reads a Record<string, unknown> as an array candidate and rejects it.
      // What we pass is already redacted, already JSON-shaped, and never a class.
      data: {
        actorId: actor.id,
        actorName: actor.name,
        action,
        target,
        ...subjectOf(target),
        meta: meta as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // a failed log line must never swallow the work the operator actually did
    console.error('[audit] could not record', action, target, err);
  }
}

/* Keys whose VALUE never reaches the log at any depth. The trail exists to
   answer "what did they change it to", so the payload is worth keeping — but a
   password or a card number in an append-only table is a liability forever. */
const SECRET = /pass|secret|token|hash|key|cvc|card(number)?$/i;

function redact(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 120) + '…' : v;
  if (Array.isArray(v)) return depth >= 2 ? `[${v.length} items]` : v.slice(0, 10).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    if (depth >= 2) return '{…}';
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .slice(0, 24)
        .map(([k, val]) => [k, SECRET.test(k) ? '[redacted]' : redact(val, depth + 1)]),
    );
  }
  return v;
}

/** What the operator sent, redacted. JSON only: Hono caches the parse, so the
    handler still reads the body normally, and skipping other content types
    keeps a multipart upload's own `formData()` read untouched. */
export async function requestMeta(c: {
  req: { header: (n: string) => string | undefined; json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | undefined> {
  if (!c.req.header('content-type')?.includes('application/json')) return undefined;
  try {
    return { body: redact(await c.req.json()) };
  } catch {
    return undefined; // no body, or not the JSON it claimed to be
  }
}
