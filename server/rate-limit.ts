/* Rate limiting, and the address a limit is counted against.

   Its own file rather than a corner of shared.ts because it is the one piece of
   the server with two implementations and a failure mode, and because a limiter
   that cannot be imported without dragging in the ORM is a limiter nobody
   tests. shared.ts re-exports these names, so every existing caller is unchanged.

   One window, two stores. Which one a site gets depends on whether it was given
   somewhere shared to count in, and nothing else has to change.

   The in-memory limiter is per-INSTANCE, which on Vercel means per lambda: a
   site running on eight of them let an attacker through at eight times the
   limit, and the site owner had no way of knowing. That is fine for a shop
   whose whole traffic fits one instance and wrong for anything that scales,
   which is exactly the site that most needs the limit.

   So: if the deployment has KV credentials (Upstash, or Vercel KV — same REST
   protocol), the count lives there and every instance sees the same number. If
   it does not, the memory limiter runs exactly as before. No new dependency
   either way; the REST API is one fetch.

   Set BOTH of these to turn it on (Vercel KV's KV_REST_API_* pair is read too):

     UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io
     UPSTASH_REDIS_REST_TOKEN=<token>
*/

const WINDOW_MS = 60_000;

const KV_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '';
/** whether this site counts in a shared store — read once, at module load */
export const sharedRateLimit = !!(KV_URL && KV_TOKEN);

const hits = new Map<string, number[]>();

/** the process-local window. Also the fallback when the shared store is down —
    degraded is the right answer there, because failing OPEN on a network blip
    hands an attacker the whole endpoint and failing CLOSED takes the site off
    the air for everybody. */
function limitedLocally(key: string, max: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  /* The map never shrank: every distinct key ever seen stayed forever, so a
     scripted attacker rotating IPs was also a slow memory leak. Swept here
     rather than on a timer, so it costs nothing on an idle site. */
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  }
  return arr.length > max;
}

/* A fixed window rather than a sliding one, because a shared sliding window
   costs a sorted set and a read-modify-write per request. The cost of the
   simpler shape is a burst across a window boundary of up to 2×max, which is
   the wrong thing to optimise when the alternative was unbounded ×N. */
async function limitedInKv(key: string, max: number): Promise<boolean> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / WINDOW_MS)}`;
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    // INCR then EXPIRE: the key exists for one window and then it does not, so
    // the store never grows with the number of addresses that have ever visited
    body: JSON.stringify([
      ['INCR', bucket],
      ['EXPIRE', bucket, '120'],
    ]),
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const out = (await res.json()) as { result?: number }[];
  const count = Number(out?.[0]?.result ?? 0);
  if (!Number.isFinite(count) || count <= 0) throw new Error('kv bad reply');
  return count > max;
}

/** True when this key has already used up its allowance for the current minute. */
export async function limited(key: string, max = 20): Promise<boolean> {
  if (!sharedRateLimit) return limitedLocally(key, max);
  try {
    return await limitedInKv(key, max);
  } catch {
    return limitedLocally(key, max);
  }
}


/* the rate-limit key must be an IP the CLIENT cannot forge. x-forwarded-for is a
   client-appendable list; the trusted proxy appends the real connecting IP LAST,
   so take the rightmost token (fall back to x-real-ip, then a constant). Taking
   the first token — as the old code did — let an attacker rotate a spoofed
   leading value per request to get an unlimited fresh bucket every time. */
export function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return c.req.header('x-real-ip') ?? 'local';
}

