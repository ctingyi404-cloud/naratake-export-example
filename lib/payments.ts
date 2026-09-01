/* PaymentProvider abstraction: Stripe when keys are present, an honest mock
   otherwise. The mock returns client secrets the checkout UI recognizes and
   auto-succeeds, so the whole flow works with zero keys.

   Stripe Connect (platform mode): when STRIPE_CONNECT_ACCOUNT_ID is set, the
   STRIPE_SECRET_KEY is the PLATFORM's key and charges are routed to the
   merchant's connected account (destination charges). The merchant never
   creates their own Stripe account keys — the operator onboards them once via
   Connect and sets the acct_… id here. STRIPE_APPLICATION_FEE_BP (basis
   points, e.g. 150 = 1.5%) optionally takes a platform fee per charge. */

import Stripe from 'stripe';
import { db } from './db';
import { intentVerdict, type IntentVerdict } from './tender-ladder';

export interface CreatedIntent {
  provider: 'STRIPE' | 'MOCK';
  clientSecret: string;
  externalId: string;
}

const stripeKey = process.env.STRIPE_SECRET_KEY;
export const stripe = stripeKey ? new Stripe(stripeKey) : null;

const connectAccount = process.env.STRIPE_CONNECT_ACCOUNT_ID || null;
const applicationFeeBp = Number(process.env.STRIPE_APPLICATION_FEE_BP ?? 0);

/* Test keys charge nobody. Without this the back office called a `sk_test_` site
   "live charges enabled" and stamped every order green PAID, so a merchant could
   trade for a week on a rehearsal key and only find out at the bank. The key
   prefix is the only signal Stripe gives us — there is no API call for it. */
export type StripeMode = 'test' | 'live';
export function stripeMode(): StripeMode | null {
  if (!stripeKey) return null;
  return /^(sk|rk)_live_/.test(stripeKey) ? 'live' : 'test';
}

/** Is there an in-store card reader to drive?

    The register's card button falls through to a SIMULATED charge when this is
    false, which is fine for a demo and a lie on a live site: the sale records as
    MOCK, no money moves, and the settings banner still said "live charges
    enabled". The back office has to be able to say "reader: none". */
export function terminalReady(): boolean {
  return !!(stripe && process.env.STRIPE_TERMINAL_READER_ID);
}

export function paymentsConfig() {
  return {
    provider: stripe ? 'stripe' : 'mock',
    mode: stripeMode(),
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
    connect: !!connectAccount,
    terminal: terminalReady(),
  };
}

/** The Connect routing every charge on this site must carry.

    In platform mode the money belongs to the MERCHANT, not to us: the charge is
    a destination charge onto their connected account and our cut is the
    application fee. The online checkout said so; the register did not, and
    created a bare intent — so a shop on platform mode had its online orders
    settle to its own account and its IN-STORE card sales settle into ours.
    Exported once so a third charge path cannot repeat the mistake. */
export function connectRouting(amountCents: number): Record<string, unknown> {
  if (!connectAccount) return {};
  return {
    transfer_data: { destination: connectAccount },
    on_behalf_of: connectAccount,
    ...(applicationFeeBp > 0
      ? { application_fee_amount: Math.round((amountCents * applicationFeeBp) / 10000) }
      : {}),
  };
}

export async function createIntent(
  amountCents: number,
  metadata: Record<string, string>,
): Promise<CreatedIntent> {
  if (stripe) {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata,
      ...connectRouting(amountCents),
    });
    return { provider: 'STRIPE', clientSecret: intent.client_secret!, externalId: intent.id };
  }
  // the charged amount rides IN the id so the keyless path can verify it exactly
  // like Stripe does — stateless (no store to consult, safe across instances) and
  // it keeps the demo honest: a total that shifts after capture is caught here too.
  const id = `mock_pi_${amountCents}_${Math.random().toString(36).slice(2, 10)}`;
  return { provider: 'MOCK', clientSecret: `${id}_secret`, externalId: id };
}

/** Amount encoded into a mock charge id (`mock_pi_<cents>_<rand>` online,
    `mock_term_<cents>_<rand>` at the register), or null for a legacy id that
    predates the format. */
export function mockChargeAmount(externalId: string): number | null {
  const m = /^mock_(?:pi|term)_(\d+)_/.exec(externalId);
  return m ? Number(m[1]) : null;
}

/** Confirm the intent settled for the expected amount before accepting an order.
    Only 'succeeded' (or a mock intent in keyless mode) counts as paid; a
    'processing' intent is reported so the route can tell the customer to wait
    instead of recording revenue that may never arrive. */
export async function verifyIntent(
  externalId: string,
  expectedAmountCents: number,
): Promise<{ ok: boolean; provider: 'STRIPE' | 'MOCK'; reason?: Exclude<IntentVerdict, 'ok'> }> {
  // MOCK intents are ONLY trusted when Stripe isn't configured (dev / keyless demo).
  // With a real STRIPE_SECRET_KEY set, a forged `mock_pi_…` id MUST be rejected —
  // otherwise anyone could POST a fake intent id and place free "paid" orders.
  if (!stripe) {
    if (!externalId.startsWith('mock_pi_')) return { ok: false, provider: 'MOCK', reason: 'unpaid' };
    // ids minted before this format carry no amount — treat them as matching so an
    // in-flight checkout during a deploy is not rejected
    const amount = mockChargeAmount(externalId);
    const verdict = intentVerdict('succeeded', amount ?? expectedAmountCents, expectedAmountCents);
    return verdict === 'ok' ? { ok: true, provider: 'MOCK' } : { ok: false, provider: 'MOCK', reason: verdict };
  }
  let intent: { status: string; amount: number };
  try {
    intent = await stripe.paymentIntents.retrieve(externalId);
  } catch {
    // unknown/forged id is an unpaid order, not a 500
    return { ok: false, provider: 'STRIPE', reason: 'unpaid' };
  }
  const verdict = intentVerdict(intent.status, intent.amount, expectedAmountCents);
  return verdict === 'ok'
    ? { ok: true, provider: 'STRIPE' }
    : { ok: false, provider: 'STRIPE', reason: verdict };
}

/* ── card-present reader ──────────────────────────────────────────────────

   Every Stripe call the register makes lives here, so server/pos.ts is a route
   file and this is the only place that knows what a reader is.

   The charge is THREE steps on purpose — start, status, abandon — because the
   one-request version (create, dispatch, then poll ~45s inside the same call)
   is a request a serverless platform is free to kill while a customer's card is
   on the reader. When that happened, the authorisation stayed alive and nobody
   was left holding the intent id to cancel it. Split, a dropped browser costs
   nothing: the id is already in the caller's hands and asking again is free. */

const readerId = () => process.env.STRIPE_TERMINAL_READER_ID;

export interface TerminalCharge {
  /** succeeded = the money is TAKEN and must be rung up; pending = still at the
      reader; canceled = dead; unknown = Stripe does not know this id */
  state: 'succeeded' | 'pending' | 'canceled' | 'unknown';
  chargedCents: number;
}

/** Put a card-present charge on the reader; returns the intent id to poll. */
export async function startTerminalCharge(amountCents: number): Promise<string> {
  const reader = readerId();
  if (!stripe || !reader) throw new Error('No card reader is configured');
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    payment_method_types: ['card_present'],
    capture_method: 'automatic',
    // in-store money belongs to the merchant exactly as much as online money
    // does — without this the register's takings settled into the PLATFORM's
    // balance on every platform-mode site
    ...connectRouting(amountCents),
  });
  try {
    await stripe.terminal.readers.processPaymentIntent(reader, { payment_intent: intent.id });
  } catch (e) {
    // the reader never took the job (offline, busy, mid-action). The intent is
    // still presentable to a card, so kill it before reporting the failure.
    await abandonTerminalCharge(intent.id);
    throw e;
  }
  return intent.id;
}

/** One non-blocking look at a card-present charge. */
export async function terminalChargeStatus(intentId: string): Promise<TerminalCharge> {
  if (!stripe) return { state: 'unknown', chargedCents: 0 };
  const intent = await stripe.paymentIntents.retrieve(intentId).catch(() => null);
  if (!intent) return { state: 'unknown', chargedCents: 0 };
  const state =
    intent.status === 'succeeded' ? 'succeeded' : intent.status === 'canceled' ? 'canceled' : 'pending';
  return { state, chargedCents: intent.amount };
}

export type AbandonOutcome =
  /** the card was taken after all — this is a real sale, ring it up */
  | { state: 'succeeded'; chargedCents: number }
  /** nothing is authorised; the customer was not charged */
  | { state: 'canceled' }
  /** could NOT be cancelled: the authorisation is alive and needs a human */
  | { state: 'stuck' };

/** Stop a card-present charge that is not going to become a sale (the cashier
    gave up, the poll timed out, the ring-up never happened).

    Order matters: clear the reader FIRST, or a customer can tap a card into the
    intent between our decision and the cancel. Then look once more before
    cancelling — a card tapped at the buzzer is real money, and throwing it away
    is worse than the timeout it came from. */
export async function abandonTerminalCharge(intentId: string): Promise<AbandonOutcome> {
  if (!stripe) return { state: 'canceled' };
  const reader = readerId();
  if (reader) await stripe.terminal.readers.cancelAction(reader).catch(() => {});
  const now = await terminalChargeStatus(intentId);
  if (now.state === 'succeeded') return { state: 'succeeded', chargedCents: now.chargedCents };
  if (now.state === 'canceled') return { state: 'canceled' };
  return (await cancelIntent(intentId)) ? { state: 'canceled' } : { state: 'stuck' };
}

/** Cancel an intent that was never captured. Returns false if Stripe refused —
    which means the money is still somewhere, and the caller must say so. */
async function cancelIntent(externalId: string): Promise<boolean> {
  if (!stripe) return false;
  try {
    return (await stripe.paymentIntents.cancel(externalId)).status === 'canceled';
  } catch {
    return false;
  }
}

/** Refund a charge, in full or in part. Connect destination charges pull the
    funds back from the merchant account (reverse_transfer) and return the platform
    fee. Mock intents moved no money, so there is nothing to reverse.

    Omitting `amountCents` refunds everything, which is Stripe's own default and
    was ALSO the only thing this could do: refunding one dish meant refunding the
    whole ticket and re-ringing it. */
export async function refundIntent(externalId: string, amountCents?: number): Promise<void> {
  if (!stripe) return;
  await stripe.refunds.create({
    payment_intent: externalId,
    ...(amountCents !== undefined ? { amount: amountCents } : {}),
    ...(connectAccount
      ? { reverse_transfer: true, ...(applicationFeeBp > 0 ? { refund_application_fee: true } : {}) }
      : {}),
  });
}

/** Refund a captured intent on a reject path BEFORE recordPayment ran. The
    client captures before posting, so every reject between capture and
    recordPayment must hand the money back — but never touch an intent that
    already backs a recorded payment (a forged replay must not claw back a
    legit charge). A successful refund leaves a REFUNDED payment row because
    Stripe keeps reporting a refunded intent as 'succeeded': without the row,
    retrying the same intent would buy a free order. An intent that can be
    neither refunded nor canceled (still processing) stays untouched and
    reusable. Returns true when the money is definitely not ours. */
export async function refundIntentSafe(externalId?: string | null): Promise<boolean> {
  if (!externalId) return false;
  try {
    if (await intentConsumed(externalId)) return false;
    // Captured money goes back as a refund; an authorisation the reader never
    // completed CANNOT be refunded at all — Stripe only lets you cancel it. A
    // stranded card-present charge is one or the other and the cashier has no
    // way to tell which, so "Void last charge" tries both before giving up.
    try {
      await refundIntent(externalId);
    } catch (e) {
      if (!(await cancelIntent(externalId))) throw e;
    }
    await db.payment.create({
      data: { provider: stripe ? 'STRIPE' : 'MOCK', externalId, amountCents: 0, status: 'REFUNDED' },
    });
    return true;
  } catch {
    /* best effort — anything left over is visible in the Stripe dashboard */
    return false;
  }
}

/** True once refundIntentSafe handed this charge back: the REFUNDED row is the
    marker (Stripe keeps reporting a refunded intent as `succeeded`). Callers use
    it to tell "we gave your money back, pay again" apart from "not confirmed". */
export async function intentVoided(externalId: string): Promise<boolean> {
  return (await db.payment.count({ where: { externalId, status: 'REFUNDED' } })) > 0;
}

/** Guard against payment-intent replay: a paid intent must produce exactly one
    order/gift card/appointment. Stripe reports the intent as `succeeded` on every
    retrieve, so verifyIntent alone can't tell a fresh order from a replay — this
    checks whether the intent was already consumed. The @unique on Payment.externalId
    is the atomic backstop for the concurrent-replay race. */
export async function intentConsumed(externalId: string): Promise<boolean> {
  return (await db.payment.count({ where: { externalId } })) > 0;
}

/* ── partial refunds ──────────────────────────────────────────────────────

   ONE arithmetic for "how much of this payment may still go back". A second one
   would eventually disagree with the first, and the difference would be money. */

export interface RefundablePayment {
  status: string;
  externalId: string | null;
  amountCents: number;
  refundedCents?: number | null;
}

/** Cents already handed back on this payment. The shared restitution path
    (lib/modules/payments.hooks) stamps a fully refunded row REFUNDED in one
    atomic claim without touching refundedCents, so status is the stronger
    statement of the two and is read first. */
export function refundedSoFar(p: RefundablePayment): number {
  if (p.status === 'REFUNDED') return p.amountCents;
  return Math.min(p.amountCents, Math.max(0, p.refundedCents ?? 0));
}

/** Cents still refundable. Cash and gift tender carry no externalId, so they
    come back as 0 — there is no card to reverse. */
export function refundableRemaining(p: RefundablePayment | null | undefined): number {
  if (!p?.externalId) return 0;
  if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED') return 0;
  return Math.max(0, p.amountCents - refundedSoFar(p));
}

export type RefundRefusal = 'not_refundable' | 'nothing_left' | 'exceeds_remaining' | 'invalid_amount';

export type RefundPlan =
  | { ok: true; cents: number; refundedTotal: number; status: 'REFUNDED' | 'PARTIALLY_REFUNDED' }
  | { ok: false; reason: RefundRefusal; remainingCents: number };

/** What a refund of `requestCents` (default: everything left) would do to the
    row. Pure — the whole decision table is unit-tested. */
export function planRefund(p: RefundablePayment, requestCents?: number): RefundPlan {
  const remaining = refundableRemaining(p);
  if (remaining <= 0)
    return {
      ok: false,
      reason: p.externalId && (p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED') ? 'nothing_left' : 'not_refundable',
      remainingCents: 0,
    };
  const cents = requestCents ?? remaining;
  if (!Number.isInteger(cents) || cents <= 0) return { ok: false, reason: 'invalid_amount', remainingCents: remaining };
  if (cents > remaining) return { ok: false, reason: 'exceeds_remaining', remainingCents: remaining };
  const refundedTotal = refundedSoFar(p) + cents;
  return {
    ok: true,
    cents,
    refundedTotal,
    status: refundedTotal >= p.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  };
}

export type RefundOutcome =
  | { ok: true; cents: number; refundedTotalCents: number; remainingCents: number; status: 'REFUNDED' | 'PARTIALLY_REFUNDED' }
  | { ok: false; reason: RefundRefusal | 'raced' | 'provider'; remainingCents: number; message?: string };

/** Refund part of a card payment (or all that is left of it).

    Safe under a double-clicked button by construction: refundedCents is the
    compare-and-set key, so a second writer that read the same row finds the
    value it planned against has moved and refunds NOTHING, rather than sending
    Stripe a second refund. A provider failure hands the claim straight back, so
    the money stays exactly as refundable as it was. */
export async function refundPayment(paymentId: string, requestCents?: number): Promise<RefundOutcome> {
  const payment = (await db.payment.findUnique({ where: { id: paymentId } })) as
    | (RefundablePayment & { id: string })
    | null;
  if (!payment) return { ok: false, reason: 'not_refundable', remainingCents: 0 };
  const plan = planRefund(payment, requestCents);
  if (!plan.ok) return plan;

  const was = { status: payment.status, refundedCents: payment.refundedCents ?? 0 };
  const claim = await db.payment.updateMany({
    where: { id: paymentId, status: was.status, refundedCents: was.refundedCents },
    data: { refundedCents: plan.refundedTotal, status: plan.status },
  });
  if (claim.count === 0) return { ok: false, reason: 'raced', remainingCents: refundableRemaining(payment) };

  try {
    await refundIntent(payment.externalId!, plan.cents);
  } catch (e) {
    await db.payment.updateMany({
      where: { id: paymentId, refundedCents: plan.refundedTotal },
      data: was,
    });
    return {
      ok: false,
      reason: 'provider',
      remainingCents: refundableRemaining(payment),
      message: e instanceof Error ? e.message : 'Refund failed',
    };
  }
  return {
    ok: true,
    cents: plan.cents,
    refundedTotalCents: plan.refundedTotal,
    remainingCents: payment.amountCents - plan.refundedTotal,
    status: plan.status,
  };
}

/* ── what a shift actually took ──────────────────────────────────────────── */

/** Money no bank will ever settle: a register charge the SIMULATED reader
    invented (no secret key, or no reader id). Counting it as card revenue is
    why "expected card" could never match a Stripe payout, and the cashier had
    nothing on the report to explain the gap. Cash is real money whichever
    provider recorded it. */
export const isSimulatedTender = (p: { provider: string; kind?: string }) =>
  p.provider === 'MOCK' && p.kind !== 'POS_CASH';

export async function recordPayment(p: {
  provider: 'STRIPE' | 'MOCK';
  externalId: string;
  amountCents: number;
  tipCents?: number;
  orderId?: string;
}): Promise<string> {
  const row = await db.payment.create({
    data: {
      provider: p.provider,
      externalId: p.externalId,
      amountCents: p.amountCents,
      tipCents: p.tipCents ?? 0,
      status: 'SUCCEEDED',
      orderId: p.orderId ?? null,
    },
  });
  return row.id;
}
