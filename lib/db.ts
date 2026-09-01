import { PrismaClient } from '@prisma/client';

/* SQLite serializes writes on a single connection, so concurrent booking
   transactions (Serializable isolation) queue up. The default socket timeout is
   too short for that queue and the waiting transactions abort with P1008 — verified
   to turn a correct 12/12 class fill into a 3/12 under-fill. A longer socket_timeout
   lets them wait their turn. Only touches file: (SQLite) URLs; production Postgres
   (Neon) is left exactly as the deploy set it. */
function tunedUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('file:')) return url;
  const [base, query] = url.split('?');
  const params = new URLSearchParams(query);
  if (!params.has('socket_timeout')) params.set('socket_timeout', '30');
  if (!params.has('connection_limit')) params.set('connection_limit', '1');
  return `${base}?${params.toString()}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const url = tunedUrl();
export const db =
  globalForPrisma.prisma ?? new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
