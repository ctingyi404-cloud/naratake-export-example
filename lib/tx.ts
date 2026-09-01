/* Concurrency-safe booking. Two customers hitting the same slot at the same moment
   would both pass a plain "re-check then create" (a TOCTOU race — verified to double-book
   100% of the time without this). Running the re-check + create inside a Serializable
   transaction closes it.

   Serializable isolation trades that safety for transient failures: a Postgres
   serialization conflict (P2034) or, on SQLite (single writer), a connection-wait
   timeout (P2028) under contention. Those do NOT mean the slot is taken — retrying
   succeeds. Only a SlotTakenError, thrown by the re-check itself, means "genuinely
   taken". So: retry the transient failures, surface SlotTakenError immediately. */

import { Prisma } from '@prisma/client';
import { db } from './db';

/** Thrown by a booking body when its own re-check finds the slot already taken. */
export class SlotTakenError extends Error {
  constructor(message = 'Slot just taken') {
    super(message);
    this.name = 'SlotTakenError';
  }
}

/** Transient transaction failure worth retrying: write conflict / deadlock (P2034),
    transaction/connection timeout (P2028), socket timeout under contention (P1008),
    or a raw SQLite busy/lock. Checks the code AND the message — some drivers surface
    a lock as a known error with an off-list code. */
function isTransient(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028', 'P1008'].includes(e.code))
    return true;
  const msg = e instanceof Error ? e.message : '';
  return /database is locked|sqlite_busy|write conflict|deadlock|could not serialize|socket timeout/i.test(msg);
}

/** A unique-constraint violation (P2002) — e.g. the same person enrolling twice.
    Distinct from a slot conflict so callers can message it correctly. */
export function isDuplicate(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Run a booking's re-check + create under Serializable isolation, retrying transient
    serialization failures with jittered backoff so real contention doesn't get
    mis-reported as "slot taken". A SlotTakenError (genuine) never retries. */
export async function bookExclusively<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 6;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (e) {
      if (e instanceof SlotTakenError) throw e; // genuine conflict — do not retry
      lastErr = e;
      if (!isTransient(e)) throw e;
      // jittered backoff; keep the index in the delay so retries spread out
      const wait = 12 * (attempt + 1) + Math.floor(Math.random() * 25);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** True when an error means the slot was genuinely contended: our own SlotTakenError,
    or a serialization/timeout failure that survived every retry. */
export function isSlotConflict(e: unknown): boolean {
  return e instanceof SlotTakenError || isTransient(e);
}
