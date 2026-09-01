/* Password hashing (scrypt) and signed session tokens (HMAC-SHA256).
   No external crypto dependencies. */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/* Session tokens and unsubscribe links are only as trustworthy as this key.
   A hardcoded constant fallback would let anyone forge an OWNER cookie, so we
   fail closed: in production a missing/short JWT_SECRET aborts boot; elsewhere
   we mint a random per-process secret (valid within one run, never a guessable
   constant) and warn loudly. */
function resolveSecret(): string {
  const env = process.env.JWT_SECRET;
  if (env && env.length >= 32) return env;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters in production. ' +
        'Refusing to boot with a weak or missing session-signing secret.',
    );
  }
  console.warn(
    '[auth] JWT_SECRET is missing or under 32 chars — using a random per-process ' +
      'dev secret. Sessions reset on restart; set a strong JWT_SECRET before deploying.',
  );
  return randomBytes(48).toString('hex');
}

/* resolved lazily on first sign/verify, never at module load: `next build`
   runs with NODE_ENV=production and would otherwise abort the BUILD (which
   needs no secret) instead of the boot. Any real request still fails closed. */
let _secret: string | undefined;
function secret(): string {
  return (_secret ??= resolveSecret());
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Short HMAC tag over arbitrary data (unsubscribe links, etc.) — same secret
    as session tokens, so a link can prove it came from us without a table. */
export function signData(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('hex').slice(0, 32);
}

/** Constant-time check of a `signData` tag. A plain `===` on a secret leaks its
    contents through how long the comparison takes, and these tags guard
    unpublished stories, so the comparison has to be blind to how far it got. */
export function verifyData(data: string, tag: string | undefined): boolean {
  if (!tag) return false;
  const want = Buffer.from(signData(data), 'utf8');
  const got = Buffer.from(tag, 'utf8');
  return want.length === got.length && timingSafeEqual(want, got);
}

interface TokenPayload {
  sub: string;
  role: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds = 60 * 60 * 12): string {
  const body: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(createHmac('sha256', secret()).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyToken(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = b64url(createHmac('sha256', secret()).update(data).digest());
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  try {
    const payload = JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as TokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'ls_admin_session';
