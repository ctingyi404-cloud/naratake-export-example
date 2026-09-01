/* Pure money-integrity cores, no I/O.

   1) intentVerdict — the single decision table for accepting a captured intent.
   2) runLadder — sequential tender claims with reverse-order compensation.

   payments.ts and server/public.ts only wire these to Stripe and Prisma; the
   golden cases live in test/tender-ladder.test.ts. */

export type IntentVerdict = 'ok' | 'processing' | 'mismatch' | 'unpaid';

/** Only a settled intent counts as paid. 'processing' is not money yet (delayed
    payment methods can still fail), so it is surfaced as retry-later instead of
    being recorded as revenue the merchant may never receive. */
export function intentVerdict(status: string, amountCents: number, expectedCents: number): IntentVerdict {
  if (status === 'processing') return 'processing';
  if (status !== 'succeeded') return 'unpaid';
  return amountCents === expectedCents ? 'ok' : 'mismatch';
}

export interface ClaimStep {
  /** atomically claim the resource; false = lost the race / balance moved */
  claim: () => Promise<boolean>;
  /** undo a successful claim; called in reverse order on any later failure */
  release: () => Promise<void>;
  /** error surfaced when THIS claim fails */
  fail: { code: string; message: string };
}

export type LadderOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; failedAt: number };

/** Claim every step in order, then run `finalize`. On a lost claim, a throwing
    claim, or a throwing finalize, release everything already claimed in reverse
    order (best effort, never throws) and report which rung failed. `failedAt`
    is the step index, or steps.length when finalize itself failed. */
export async function runLadder<T>(
  steps: ClaimStep[],
  finalize: () => Promise<T>,
  finalFail: { code: string; message: string },
): Promise<LadderOutcome<T>> {
  const claimed: ClaimStep[] = [];
  const unwind = async () => {
    for (const s of [...claimed].reverse()) {
      try {
        await s.release();
      } catch {
        /* compensation is best effort — never mask the original failure */
      }
    }
  };
  for (let i = 0; i < steps.length; i++) {
    let ok = false;
    try {
      ok = await steps[i].claim();
    } catch {
      ok = false;
    }
    if (!ok) {
      await unwind();
      return { ok: false, ...steps[i].fail, failedAt: i };
    }
    claimed.push(steps[i]);
  }
  try {
    return { ok: true, value: await finalize() };
  } catch {
    await unwind();
    return { ok: false, ...finalFail, failedAt: steps.length };
  }
}
