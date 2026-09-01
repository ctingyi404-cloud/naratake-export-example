/* The register's offline half: a catalog snapshot it can price against, and a
   queue of cash sales it still owes the server.

   Everything here is pure except the browser KV adapter at the bottom, so the
   state machine and the offline/online pricing agreement are unit-testable in
   node (test/pos-offline.test.ts).

   Pricing calls the SAME computeQuote() the server calls. There is no second
   money implementation here — only a second caller. The register's manual
   dollar discount is handed to computeQuote as a FIXED coupon because that is
   the vocabulary it already has for "take N cents off, clamped at the subtotal,
   allocated proportionally onto the taxable lines" — which is exactly what
   server/pos.ts pricePos() does. The two agree by construction, and
   test/pos-offline.test.ts pins the agreement with a golden case.

   What offline CANNOT do, and why, is OFFLINE_LIMITS. Read it before adding a
   tender to the offline path. */

import {
  computeQuote,
  type ComputedQuote,
  type CouponRecord,
  type QuoteCtx,
  type QuoteLineInput,
} from './quote-calc';

/* ────────────────────────────────────────────────────────────────────────────
   What offline cannot do
   ──────────────────────────────────────────────────────────────────────────── */

/* Each of these needs the database or the card network, and there is no honest
   way to fake it at the counter:

   card     — the reader is driven server-side (server/pos.ts:207-231): no
              internet, no authorization. "I'll charge it later" is a promise
              the card can still decline.
   giftcard — the balance lives in the DB and must be decremented atomically
              (pos.ts:365-373). Offline we can neither read the true balance nor
              stop the same card being spent twice on two registers.
   coupon   — validity, expiry and the redemption cap are DB rows.
   loyalty  — points hang off the member row; redeeming without it either
              gives away money we cannot debit or refuses a member who has it.
   deposit  — an appointment's already-paid deposit is claimed once
              (pos.ts:354-360). Crediting it blind double-spends it.

   `sale` blocks the whole checkout; `tender` only darkens one control. */
export const OFFLINE_LIMITS = [
  { id: 'card', blocks: 'tender' },
  { id: 'giftcard', blocks: 'sale' },
  { id: 'coupon', blocks: 'tender' },
  { id: 'loyalty', blocks: 'tender' },
  { id: 'deposit', blocks: 'sale' },
] as const;

export type OfflineLimit = (typeof OFFLINE_LIMITS)[number]['id'];

/** Which limits stand in the way of THIS cart right now. Empty = cash checkout
    is honest. A gift code typed into the box or a deposit riding along from a
    booking is not a warning, it is a refusal: we would have to invent a balance. */
export function offlineBlockers(cart: { giftCode?: string; depositCents?: number }): OfflineLimit[] {
  const out: OfflineLimit[] = [];
  if (cart.giftCode?.trim()) out.push('giftcard');
  if ((cart.depositCents ?? 0) > 0) out.push('deposit');
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   Catalog snapshot
   ──────────────────────────────────────────────────────────────────────────── */

export const SNAPSHOT_KEY = 'adm.pos.snapshot';
export const QUEUE_KEY = 'adm.pos.queue';

/** Bump when the shape changes. An older snapshot is dropped, never guessed at:
    a register pricing against a shape it half-understands is worse than one
    that says it has no price list. */
export const SNAPSHOT_VERSION = 2;

export interface SnapModifierGroup {
  name: string;
  min: number;
  max: number;
  options: { name: string; priceCents: number }[];
}
export interface SnapItem {
  id: string;
  name: string;
  priceCents: number;
  taxable: boolean;
  available: boolean;
  modifiers: SnapModifierGroup[];
}
export interface SnapCategory {
  id: string;
  name: string;
  type: string;
  items: SnapItem[];
}
export interface SnapNamed {
  id: string;
  name: string;
  active: boolean;
}

/** Everything the register needs to run a cash sale with the network gone. */
export interface CatalogSnapshot {
  version: number;
  /** ms epoch of capture — shown to the cashier, because a stale price list is
      the one thing offline pricing can be wrong about */
  at: number;
  taxRateBp: number;
  categories: SnapCategory[];
  /** the open shift as of capture, so a reload while offline is not met with
      "open a shift" against a server it cannot reach */
  shift: { id: string; openedAt: string; openingCashCents: number } | null;
  staff: SnapNamed[];
  terminals: SnapNamed[];
}

interface RawItem {
  id: string;
  name: string;
  priceCents: number;
  taxable?: boolean;
  available?: boolean;
  modifiers?: SnapModifierGroup[] | null;
}
interface RawCategory {
  id: string;
  name: string;
  type?: string;
  items?: RawItem[];
}

/** Strip the catalog down to what pricing and the product grid need. Images and
    descriptions are the bulk of a catalog row and none of them reach the total. */
export function buildSnapshot(input: {
  categories: RawCategory[];
  taxRateBp: number;
  shift?: { id: string; openedAt: string; openingCashCents: number } | null;
  staff?: SnapNamed[];
  terminals?: SnapNamed[];
  now?: number;
}): CatalogSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    at: input.now ?? Date.now(),
    taxRateBp: input.taxRateBp,
    categories: input.categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type ?? 'MENU',
      items: (c.items ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        priceCents: i.priceCents,
        // Item.taxable is non-null with @default(true) — a missing field means an
        // older API shape, and guessing "not taxable" undercharges tax silently
        taxable: i.taxable !== false,
        available: i.available !== false,
        modifiers: i.modifiers ?? [],
      })),
    })),
    shift: input.shift ?? null,
    staff: input.staff ?? [],
    terminals: input.terminals ?? [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   Offline pricing — one implementation, two callers
   ──────────────────────────────────────────────────────────────────────────── */

/** Never shown: the register's discount is a number the cashier typed, not a
    code they redeemed. It exists only to reach computeQuote's FIXED branch. */
const POS_DISCOUNT_CODE = '__POS_DISCOUNT__';

const posDiscountCoupon = (cents: number): CouponRecord => ({
  code: POS_DISCOUNT_CODE,
  kind: 'FIXED',
  value: cents,
  active: true,
  endsAt: null,
  minSubtotalCents: null,
  maxRedemptions: null,
  redeemed: 0,
});

export interface PosPriceInput {
  taxRateBp: number;
  discountCents: number;
  tipCents: number;
  now?: Date;
}

/** The context the register hands computeQuote. Pickup, no delivery, no coupon
    row, no gift card, no member — the register is in-store and, offline, cash
    only (OFFLINE_LIMITS). Exported so a test can prove the shape rather than
    trust a comment. */
export function posQuoteCtx(o: PosPriceInput): QuoteCtx {
  return {
    taxRateBp: o.taxRateBp,
    mode: 'pickup',
    tipCents: o.tipCents,
    delivery: null,
    coupon: o.discountCents > 0 ? posDiscountCoupon(o.discountCents) : null,
    giftCard: null,
    loyalty: null,
    now: o.now,
  };
}

/** Price a register cart with no server. Same function, same arithmetic, same
    rounding as the online path. */
export function priceOffline(lines: QuoteLineInput[], o: PosPriceInput): ComputedQuote {
  const q = computeQuote(lines, posQuoteCtx(o));
  // the synthetic coupon is an argument shape, not something the cashier applied
  return { ...q, couponCode: undefined };
}

/* ────────────────────────────────────────────────────────────────────────────
   The queue
   ──────────────────────────────────────────────────────────────────────────── */

/* QUEUED     taken at the counter, never sent
   SENDING    a replay is in flight right now
   SYNCED     the server recorded it, at the amount we charged — done
   DRIFT      recorded, but the server priced it differently than the drawer
              took. Real money is missing or extra; a human must settle it
   UNCERTAIN  the send neither succeeded nor definitively failed (tab died,
              gateway timeout). Resolved by LOOKING, never by guessing
   FAILED     the server refused, definitively, and recorded nothing */
export type QueueState = 'QUEUED' | 'SENDING' | 'SYNCED' | 'DRIFT' | 'UNCERTAIN' | 'FAILED';

export interface QueuedCart {
  items: { itemId: string; qty: number; modifiers: string[] }[];
  discountCents: number;
  tipCents: number;
  /* Only ever set on a sale the register rang while ONLINE and then failed to
     confirm. A sale taken offline can carry neither (OFFLINE_LIMITS), but a
     parked online sale must replay as the exact cart it was priced as. */
  giftCardCode?: string;
  depositCredit?: { appointmentId: string; cents: number };
}

export interface QueuedSale {
  /** client-generated at the counter, stable for the life of the sale. This is
      the idempotency key: it rides to the server on every attempt and is what a
      duplicate check matches on. */
  key: string;
  /** ms epoch the cashier completed it (NOT when the server records it) */
  at: number;
  state: QueueState;
  cart: QueuedCart;
  staffId?: string;
  terminalId?: string;
  /** what the register charged, offline, from the snapshot's prices */
  totalCents: number;
  taxCents: number;
  /** what the drawer physically took and gave back */
  tenderedCents: number;
  changeCents: number;
  /** receipt lines, so the sale can be read and re-printed with no server */
  lines: { name: string; qty: number; unitCents: number }[];
  attempts: number;
  /** the booking this sale checked out, closed once the sale is recorded */
  apptId?: string;
  orderCode?: string;
  /** set only on DRIFT: what the server priced it at instead */
  serverTotalCents?: number;
  message?: string;
}

/** Short, human-sayable reference for the paper receipt of a sale that has no
    order code yet. "OFF-" is the cashier's cue that it is not recorded. */
export const provisionalCode = (s: { key: string }) => `OFF-${s.key.slice(-5).toUpperCase()}`;

/* The idempotency key, carried where the server already stores free text:
   server/pos.ts writes `note` onto Order.notes, so the key is durable and
   queryable TODAY, before /pos/orders grows a real idempotency check.

   EVERY register cash sale carries it, not just the offline ones. A cash sale
   whose POST dies in flight has already had its change counted out, and without
   a key on that order there is no way to answer "did it land?" except guessing.
   Eight opaque characters in a field POS orders otherwise leave empty is a
   cheap price for never losing or double-booking a drawer sale. */
export const NOTE_TAG = 'REG#';
/** The closing marker makes the key a whole token. Without it `REG#k1` matches
    an order tagged `REG#k1x`, and reconciliation settles one sale against a
    different sale's order — a duplicate and a loss in one move. */
const NOTE_END = ';';
export const saleNote = (s: { key: string }) => `${NOTE_TAG}${s.key}${NOTE_END}`;
export const noteHasKey = (note: string | null | undefined, key: string) =>
  !!note && note.includes(`${NOTE_TAG}${key}${NOTE_END}`);

export function makeSaleKey(now = Date.now()): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `off_${now.toString(36)}_${rnd}`;
}

export function newSale(
  draft: Omit<QueuedSale, 'key' | 'at' | 'state' | 'attempts'> & { key?: string; at?: number },
): QueuedSale {
  const at = draft.at ?? Date.now();
  return { ...draft, key: draft.key ?? makeSaleKey(at), at, state: 'QUEUED', attempts: 0 };
}

/** A sale the register rang ONLINE whose confirmation never came back. It is
    born UNCERTAIN, not QUEUED: it was already sent, so an order may exist, and
    the only safe next move is to look rather than to send again. */
export function parkedSale(draft: Parameters<typeof newSale>[0], message: string): QueuedSale {
  return advance(advance(newSale(draft), { type: 'send' }), { type: 'indeterminate', message });
}

/* ── state machine ── */

export type SyncEvent =
  | { type: 'send' }
  /** the server recorded it (fresh POST, or found by reconciliation) */
  | { type: 'recorded'; orderCode: string; serverTotalCents: number }
  /** the server answered and refused; nothing was written */
  | { type: 'reject'; message: string }
  /** could not even be attempted (signed out, rate-limited) — retry later */
  | { type: 'defer'; message?: string }
  /** we do not know whether it was written */
  | { type: 'indeterminate'; message?: string }
  /** reconciliation looked and the order is genuinely not there */
  | { type: 'notFound' }
  /** operator asked to try a FAILED sale again */
  | { type: 'retry' }
  /** operator has seen and settled a DRIFT */
  | { type: 'acknowledge' };

/* One transition table. Anything not listed leaves the sale untouched, which is
   the important half: `send` on a SYNCED sale is a no-op, so a double sync
   cannot create a second order even if every other guard fails. */
export function advance(s: QueuedSale, e: SyncEvent): QueuedSale {
  switch (e.type) {
    case 'send':
      // only a clean QUEUED sale may go out. FAILED needs an operator, UNCERTAIN
      // needs a look, SENDING is already in flight, SYNCED/DRIFT are recorded.
      return s.state === 'QUEUED'
        ? { ...s, state: 'SENDING', attempts: s.attempts + 1, message: undefined }
        : s;
    case 'recorded': {
      if (s.state !== 'SENDING' && s.state !== 'UNCERTAIN') return s;
      const drift = e.serverTotalCents !== s.totalCents;
      return {
        ...s,
        state: drift ? 'DRIFT' : 'SYNCED',
        orderCode: e.orderCode,
        serverTotalCents: drift ? e.serverTotalCents : undefined,
        message: undefined,
      };
    }
    case 'reject':
      return s.state === 'SENDING' ? { ...s, state: 'FAILED', message: e.message } : s;
    case 'defer':
      return s.state === 'SENDING' ? { ...s, state: 'QUEUED', message: e.message } : s;
    case 'indeterminate':
      return s.state === 'SENDING' ? { ...s, state: 'UNCERTAIN', message: e.message } : s;
    case 'notFound':
      return s.state === 'UNCERTAIN' ? { ...s, state: 'QUEUED', message: undefined } : s;
    case 'retry':
      return s.state === 'FAILED' ? { ...s, state: 'QUEUED', message: undefined } : s;
    case 'acknowledge':
      return s.state === 'DRIFT' ? { ...s, state: 'SYNCED' } : s;
  }
}

/** A tab that died mid-send leaves SENDING on disk. On the next load we do not
    know whether the server committed it, so it becomes UNCERTAIN and waits to
    be looked up. Re-sending it blind is how one sale becomes two. */
export function hydrate(entries: QueuedSale[]): QueuedSale[] {
  return entries.map((s) =>
    s.state === 'SENDING'
      ? { ...s, state: 'UNCERTAIN' as const, message: 'Register closed while syncing' }
      : s,
  );
}

export const sendable = (entries: QueuedSale[]) => entries.filter((s) => s.state === 'QUEUED');
export const needsLookup = (entries: QueuedSale[]) => entries.filter((s) => s.state === 'UNCERTAIN');

export interface QueueStatus {
  /** anything the server does not yet hold, correctly, as an order */
  pending: number;
  queued: number;
  sending: number;
  uncertain: number;
  failed: number;
  drift: number;
  /** cash in the drawer the server has no order for — the exact amount a
      Z-report run right now would come up short */
  unrecordedCashCents: number;
  /** charged minus recorded across DRIFT sales; positive = drawer holds more
      than the books say */
  driftCents: number;
  oldestAt: number | null;
}

export function queueStatus(entries: QueuedSale[]): QueueStatus {
  const s: QueueStatus = {
    pending: 0, queued: 0, sending: 0, uncertain: 0, failed: 0, drift: 0,
    unrecordedCashCents: 0, driftCents: 0, oldestAt: null,
  };
  for (const e of entries) {
    if (e.state === 'SYNCED') continue;
    s.pending++;
    if (e.state === 'DRIFT') {
      s.drift++;
      s.driftCents += e.totalCents - (e.serverTotalCents ?? e.totalCents);
    } else {
      // QUEUED / SENDING / UNCERTAIN / FAILED: no order exists, or none we can
      // prove exists. Either way the drawer holds cash the books do not.
      s.unrecordedCashCents += e.totalCents;
      if (e.state === 'QUEUED') s.queued++;
      else if (e.state === 'SENDING') s.sending++;
      else if (e.state === 'UNCERTAIN') s.uncertain++;
      else s.failed++;
    }
    s.oldestAt = s.oldestAt === null ? e.at : Math.min(s.oldestAt, e.at);
  }
  return s;
}

/** Reconcile UNCERTAIN sales against orders the server actually has, by the
    idempotency key stamped into the note. Pure: the caller does the fetching. */
export function reconcileEvents(
  entries: QueuedSale[],
  orders: { code: string; notes?: string | null; totalCents: number }[],
): { key: string; event: SyncEvent }[] {
  return needsLookup(entries).map((s) => {
    const hit = orders.find((o) => noteHasKey(o.notes, s.key));
    return {
      key: s.key,
      event: hit
        ? ({ type: 'recorded', orderCode: hit.code, serverTotalCents: hit.totalCents } as const)
        : ({ type: 'notFound' } as const),
    };
  });
}

/* ── talking to /pos/orders ── */

/** The body a queued sale replays as. `note` carries the idempotency key;
    `tenderedCents` is what the drawer really took, so the server's own
    "insufficient cash" check still catches a price that moved UP while the
    register was offline. */
export function orderBody(s: QueuedSale) {
  return {
    ...s.cart,
    staffId: s.staffId,
    terminalId: s.terminalId,
    note: saleNote(s),
    payment: { method: 'cash' as const, tenderedCents: s.tenderedCents },
  };
}

/* An HTTP outcome, classified into an event.

   The bias is deliberate and one-directional: when in doubt, UNCERTAIN. Calling
   an uncertain outcome "rejected" re-sends a sale the server already recorded
   and books it twice; calling it "recorded" drops a real sale. Being wrong
   toward UNCERTAIN costs the operator one lookup and nothing else.

   400/402/409/422 are the only statuses treated as definitive refusals, and
   only because server/pos.ts proves nothing survives them: rejectRingUp runs
   after runLadder has released every claim, and the order row is deleted if the
   payment write fails (pos.ts:432-437). A 5xx does not carry that proof — not
   even this route's own 500 — because a platform gateway can time out AFTER the
   write committed. */
export function classifyFailure(status: number | null, message: string): SyncEvent {
  if (status === null) return { type: 'indeterminate', message };
  if (status === 400 || status === 402 || status === 409 || status === 422)
    return { type: 'reject', message };
  if (status === 401 || status === 403 || status === 429) return { type: 'defer', message };
  return { type: 'indeterminate', message };
}

export interface HttpLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** POST one queued sale. Returns the event to feed `advance` — it never mutates
    the sale, so the caller stays in control of persistence ordering. */
export async function postQueuedSale(
  s: QueuedSale,
  send: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<HttpLike>,
  url = '/api/v1/admin/pos/orders',
): Promise<SyncEvent> {
  let res: HttpLike;
  try {
    res = await send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody(s)),
    });
  } catch (e) {
    // the request may or may not have reached the handler — the browser cannot tell
    return { type: 'indeterminate', message: errText(e) };
  }
  let body: { code?: string; totalCents?: number; error?: { message?: string; code?: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // a reply we cannot read is not a reply we can act on
    if (res.ok) return { type: 'indeterminate', message: 'Unreadable reply' };
  }
  if (res.ok && typeof body.code === 'string')
    return {
      type: 'recorded',
      orderCode: body.code,
      serverTotalCents: typeof body.totalCents === 'number' ? body.totalCents : s.totalCents,
    };
  if (res.ok) return { type: 'indeterminate', message: 'Recorded without an order code' };
  return classifyFailure(res.status, body.error?.message ?? body.error?.code ?? `HTTP ${res.status}`);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Did this failure mean "the network is gone", as opposed to "the server said
    no"? fetch rejects with a TypeError when it cannot reach the host; a reply
    that is not JSON (a captive portal's login page, a proxy's error page) blows
    up in res.json() as a SyntaxError. Both mean the register is on its own. */
export function isOfflineError(e: unknown): boolean {
  if (e instanceof TypeError || e instanceof SyntaxError) return true;
  const name = (e as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'NetworkError';
}

/* ────────────────────────────────────────────────────────────────────────────
   Persistence
   ──────────────────────────────────────────────────────────────────────────── */

/** Storage, narrowed to what this file needs and injectable in tests. `set`
    returning false means the browser refused — the caller must NOT tell the
    cashier the sale is safe. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

export const browserKV: KV = {
  get(key) {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
};

export function saveSnapshot(kv: KV, snap: CatalogSnapshot): boolean {
  return kv.set(SNAPSHOT_KEY, JSON.stringify(snap));
}

export function loadSnapshot(kv: KV): CatalogSnapshot | null {
  const raw = kv.get(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as CatalogSnapshot;
    // a shape from an older register prices against rules we no longer run
    if (s?.version !== SNAPSHOT_VERSION || typeof s.taxRateBp !== 'number' || !Array.isArray(s.categories))
      return null;
    return s;
  } catch {
    return null;
  }
}

export function saveQueue(kv: KV, entries: QueuedSale[]): boolean {
  return kv.set(QUEUE_KEY, JSON.stringify(entries));
}

const VALID_STATES: QueueState[] = ['QUEUED', 'SENDING', 'SYNCED', 'DRIFT', 'UNCERTAIN', 'FAILED'];

/** Read the queue, hydrated. `corrupt` means the stored value could not be
    parsed: the raw text is copied aside under a `.corrupt` key rather than
    dropped, because the thing we would be dropping is money the drawer already
    took, and it must stay recoverable by hand. */
export function loadQueue(kv: KV): { entries: QueuedSale[]; corrupt: boolean } {
  const raw = kv.get(QUEUE_KEY);
  if (!raw) return { entries: [], corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    kv.set(`${QUEUE_KEY}.corrupt.${Date.now()}`, raw);
    return { entries: [], corrupt: true };
  }
  if (!Array.isArray(parsed)) {
    kv.set(`${QUEUE_KEY}.corrupt.${Date.now()}`, raw);
    return { entries: [], corrupt: true };
  }
  const entries: QueuedSale[] = [];
  let corrupt = false;
  for (const row of parsed as QueuedSale[]) {
    if (!row || typeof row.key !== 'string' || typeof row.totalCents !== 'number') {
      corrupt = true;
      continue;
    }
    entries.push({
      ...row,
      // an unrecognized state is not a reason to forget the sale — it is a
      // reason to make a human look at it
      state: VALID_STATES.includes(row.state) ? row.state : 'UNCERTAIN',
      attempts: typeof row.attempts === 'number' ? row.attempts : 0,
      at: typeof row.at === 'number' ? row.at : Date.now(),
      lines: Array.isArray(row.lines) ? row.lines : [],
    });
  }
  if (corrupt) kv.set(`${QUEUE_KEY}.corrupt.${Date.now()}`, raw);
  return { entries: hydrate(entries), corrupt };
}

/** How long a settled sale stays on the device, so the cashier can still
    re-print it. SYNCED is the only state that is ever dropped — everything else
    is money nobody has accounted for yet, and no amount of age changes that. */
export const KEEP_SYNCED_MS = 24 * 60 * 60 * 1000;

export function pruneQueue(entries: QueuedSale[], now = Date.now(), keepMs = KEEP_SYNCED_MS): QueuedSale[] {
  return entries.filter((s) => {
    if (s.state !== 'SYNCED') return true;
    const age = now - s.at;
    // a machine whose clock jumped writes a wild `at`; a delta that large is a
    // clock event, not an old sale (same reasoning as ui.tsx pruneDrafts)
    return !(age > keepMs && age < keepMs * 30);
  });
}
