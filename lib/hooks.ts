/* Where modules meet without importing each other.

   Voiding a paid order can owe the customer money through five different
   tables, and each one belongs to a different module: the card charge is
   payments, the gift-card balance and the coupon redemption are promotions, the
   loyalty points are customers, the consumed booking deposit is appointments.
   Written as direct imports, that made the refund core depend on four modules
   at once and none of them could be removed.

   So the refund core states WHAT is owed (lib/restitution.ledgerLegs, a pure
   function of one Order row) and each module registers HOW to pay it back. A
   module that is not installed simply never registers, and the leg it would
   have handled can never be planned either, because its data cannot exist.

   Registration happens in lib/hooks-init.ts, which codegen regenerates with
   only the enabled modules. */

import type { PrismaClient } from '@prisma/client';

/** Either a plain client or a transaction client — every hook must work inside
    restituteOrder's Serializable transaction. */
type Tx = PrismaClient;

export interface RestitutionHooks {
  /** payments: refund the captured charge. Claims the payment atomically and
      returns the cents actually refunded (0 when another run already claimed
      it). Runs OUTSIDE any transaction — it makes a network call. */
  refundCard?(db: PrismaClient, paymentId: string, refund: (externalId: string) => Promise<void>): Promise<number>;
  /** promotions: put a gift-card tender back on the card it was drawn from */
  restoreGift?(tx: Tx, code: string, cents: number): Promise<void>;
  /** promotions: hand a capped coupon's redemption back so codes stop leaking.
      Takes the code, not the order: coupons must not know orders exist. */
  releaseCoupon?(tx: Tx, code: string): Promise<boolean>;
  /** customers: return redeemed loyalty points to the member */
  restoreLoyalty?(tx: Tx, customerId: string, points: number): Promise<void>;
  /** appointments: make a POS-consumed booking deposit creditable again */
  releaseDeposit?(tx: Tx, appointmentId: string): Promise<void>;
}

export const restitution: RestitutionHooks = {};

export function registerRestitution(h: RestitutionHooks): void {
  Object.assign(restitution, h);
}

/* ── what a module OFFERS ─────────────────────────────────────────────────

   Same seam, opposite failure rule, and the difference is worth stating.

   A restitution leg is OWED: the data already exists, so the module that
   services it MUST be installed and a missing hook is MissingModuleError
   (below) — skipping it would keep the customer's money.

   The hooks here are conveniences a module OFFERS to code outside it: the
   marketing list, the item cards an email may feature, the "keep me posted"
   box on a booking form. If the module is absent then so is its data and
   nobody is owed anything — there is no list to mail, no item to feature, and
   an opt-in that is never collected costs the guest nothing. So a missing hook
   here is a legitimate no-op, never an error. */

export interface ModuleOffers {
  /** platform_link: queue a site event for Naratake Operations. Fire-and-forget
      BY CONTRACT — implementations never throw and never block the business
      write they ride along with. Absent module = absent hook = silence, which
      the platform is built to tolerate. */
  platformEmit?(db: PrismaClient, type: string, payload: Record<string, unknown>): Promise<void>;
  /** platform_link: close this person's inbox session too, so "sign out" is
      true in both apps. Best-effort by contract — logging out must never fail
      because a third party is slow. */
  platformSignOut?(email: string): Promise<void>;
  /** customers: the loyalty member behind a phone number, for redeeming points
      at checkout. Without the module there are no members, so no points can be
      redeemed and the quote simply carries no loyalty line. */
  findMember?(db: PrismaClient, phone: string): Promise<{ id: string; loyaltyPoints: number } | null>;
  /** orders: turn a quote request from the contact form into an
      AWAITING_APPROVAL order. Without the module the request still lands in the
      inbox, so nothing is lost — there is just no order board to put it on. */
  createQuoteOrder?(
    db: PrismaClient,
    req: { name?: string; phone?: string; email?: string; message?: string; meta?: object },
  ): Promise<{ code: string; contactName: string; contactPhone: string; contactEmail: string | null }>;
  /** customers: take back the points a now-canceled order earned, clamped at
      zero. A deduction, not a debt — skipping it leaves the member better off,
      so a missing module is a no-op here. */
  deductLoyalty?(tx: PrismaClient, customerId: string, points: number): Promise<void>;
  /** orders: how much each of these customers has spent, for the profile list.
      Without ordering there is no spend to show. */
  customerSpend?(db: PrismaClient, customerIds: string[]): Promise<Record<string, { count: number; cents: number }>>;
  /** appointments: a booking deposit tendered at the register. `quote` decides
      how much of it applies (or refuses with a cashier-readable reason);
      `claim`/`release` are the atomic consume and its compensation. A shop with
      no booking engine has no deposits, so the register simply never offers the
      tender. */
  depositTender?: {
    quote(db: PrismaClient, appointmentId: string, claimCents: number, dueCents: number): Promise<{ appliedCents: number; error?: string }>;
    claim(db: PrismaClient, appointmentId: string): Promise<boolean>;
    release(db: PrismaClient, appointmentId: string): Promise<void>;
  };
  /** appointments: staff names for the ids a register sale is rung up under.
      No booking engine means no staff, so the order board shows none. */
  staffNames?(db: PrismaClient, ids: string[]): Promise<Record<string, string>>;
  /** payments: the deposit money-machine appointments borrows. Absent module ⇒
      deposits simply cannot be collected — services keep their depositCents on
      the row, but the public API quotes 0, the widget never shows a card step,
      and the deposit-intent route refuses. This is the seam that lets a salon
      buy appointments WITHOUT buying payments (UPGRADE-delivery-chain §4.1). */
  depositPayments?: {
    createIntent(
      amountCents: number,
      metadata: Record<string, string>,
    ): Promise<{ provider: 'STRIPE' | 'MOCK'; clientSecret: string; externalId: string }>;
    verifyIntent(externalId: string, expectedAmountCents: number): Promise<{ ok: boolean; provider: 'STRIPE' | 'MOCK'; reason?: string }>;
    refundIntent(externalId: string, amountCents?: number): Promise<void>;
    refundIntentSafe(externalId?: string | null): Promise<boolean>;
    intentConsumed(externalId: string): Promise<boolean>;
    recordPayment(p: { provider: 'STRIPE' | 'MOCK'; externalId: string; amountCents: number }): Promise<string>;
    /** refund + mark the recorded row — the public booking flow's "slot race
        after money moved" exit, kept here so the flow never names Payment */
    refundStranded(externalId: string, paymentId: string): Promise<void>;
    /** payment status per id, for the admin board's paid/refunded pills */
    paymentStatusByIds(ids: string[]): Promise<Record<string, string>>;
  };
  /** appointments+payments (co-owned): the merchant-side deposit refund.
      Registered only when both modules ship — an absent hook means this site
      has no deposits to refund. */
  refundApptDeposit?(
    db: PrismaClient,
    appointmentId: string,
  ): Promise<{ ok: true; refundedCents: number } | { ok: false; code: string; message?: string }>;
  /** payments: whether real charges are live or the site is in mock mode. The
      settings screen warns LOUDLY when it is mock; a site that takes no money
      online has nothing to warn about. */
  paymentsConfig?(): {
    provider: string;
    /** 'test' | 'live' from the key prefix, null when no key — a test key charges
        nobody, and the back office has to say so instead of showing PAID. */
    mode?: 'test' | 'live' | null;
    publishableKey: string | null;
    connect: boolean;
    /** an in-store reader is configured; false means the register SIMULATES card */
    terminal?: boolean;
  };
  /** collections: every published entry that has its own page, for the sitemap.
      A site without content types contributes none. */
  /** desk: a story that no longer exists cannot be on anyone's desk. Collections
      cannot name Assignment without breaking severability, so it asks; a site
      with no desk simply has no one to ask. */
  entryRemoved?(db: PrismaClient, entryId: string): Promise<void>;
  /** content: every published post, for the sitemap. Named as an offer for the
      same reason collections are — the sitemap route must not reach for a model
      that a site without that module does not have. It did, which is why the
      whole route had to be swapped out for a pages-only one whenever content was
      off, taking every collection entry out of the sitemap with it. */
  postUrls?(db: PrismaClient): Promise<{ slug: string; publishedAt: Date | null }[]>;
  /** content: every property with a page of its own, for the sitemap. A sold
      home stays listed — a link a brokerage handed out must not 404. */
  listingUrls?(db: PrismaClient): Promise<{ slug: string | null }[]>;
  /* `locale` is a plain string here on purpose: lib/hooks is the seam every
     module reaches the site through, and it must not import a type that only
     exists once collections is switched on. */
  sitemapEntries?(db: PrismaClient, collections: string[], locale?: string): Promise<{ collection: string; slug: string; updatedAt: Date }[]>;
  /** customers: raise-only marketing consent for a booking contact. */
  optIn?(db: PrismaClient, contact: { email: string; phone: string; name: string }): Promise<void>;
  /** customers: everyone who may be sent a marketing email. */
  subscribers?(db: PrismaClient): Promise<{ email: string }[]>;
  /** customers: the profile behind a checkout — created or updated, returning
      the id the order is stamped with, or undefined when the email already
      belongs to somebody else. Marketing consent is raise-only here too.
      Without the module there is no profile to keep and the order carries no
      customerId; the name, phone and email still ride on the order row, which
      is what the kitchen, the tracker and every notification read. */
  upsertMember?(
    db: PrismaClient,
    contact: { name: string; phone: string; email?: string; marketingOptIn?: boolean },
  ): Promise<string | undefined>;
  /** customers: spend a member's points at checkout. Guarded, so two orders
      racing for one balance cannot both win: returns false when the balance
      moved under it and the caller walks its tender ladder back.
      Absent module ⇒ absent members ⇒ buildQuote already refused to price the
      redemption (loyaltyError, loyaltyAppliedCents 0) and checkout rejected it,
      so there is no burn to miss and no discount to honour. */
  burnPoints?(db: PrismaClient, customerId: string, points: number): Promise<boolean>;
  /** customers: hand burnt points back — the checkout ladder's undo for
      burnPoints, reached only on a path that burnt them. (The same repayment
      owed by an order that already exists is restitution.restoreLoyalty, which
      must NOT be silently skipped; this one cannot be owed without a burn.) */
  returnPoints?(db: PrismaClient, customerId: string, points: number): Promise<void>;
  /** customers: credit the points an order earns as it completes. No members,
      no balance to credit — and nothing was promised, since a site without the
      module never showed a points balance to earn against. */
  earnPoints?(db: PrismaClient, customerId: string, points: number): Promise<void>;
  /** promotions: the house signup reward, when one is live. The welcome email
      exists to confirm the subscription; the code is a treat on top. Without
      the module there are no coupons, so the mail goes out without one. */
  signupReward?(
    db: PrismaClient,
  ): Promise<{ code: string; kind: string; value: number; minSubtotalCents: number | null } | null>;
  /** catalog: the menu highlights the AI assistant grounds its answers in. */
  groundingItems?(
    db: PrismaClient,
  ): Promise<{ name: string; categoryName: string; priceCents: number; description: string | null }[]>;
  /** catalog: the items an email may feature, in the order they render. */
  featuredItems?(
    db: PrismaClient,
    ids: string[],
  ): Promise<{ name: string; priceCents: number; description: string | null }[]>;

  /* ── what each module can REPORT ──
     The reports screen and the dashboard read every module, so they are
     composed rather than queried: each offer below answers over its own
     module's tables and analytics only stitches the answers together. See the
     block under registerOffers for the shapes. */

  /** orders: the sales spine of the reports screen — and, in `attribution`,
      the completed sales the three offers under it hang their own numbers on. */
  salesReport?(db: PrismaClient, w: ReportWindow): Promise<SalesReport>;
  /** payments: how those sales were tendered, for the cash/card donut. */
  paymentMix?(db: PrismaClient, orderIds: string[]): Promise<{ cashCents: number; cardCents: number }>;
  /** catalog: those sales' lines gathered into menu categories, biggest first. */
  categoryRevenue?(
    db: PrismaClient,
    items: { name: string; qty: number; cents: number }[],
  ): Promise<{ name: string; cents: number }[]>;
  /** appointments: the same sales credited to the staff who rang them up. */
  staffSales?(
    db: PrismaClient,
    staff: { staffId: string; cents: number; count: number }[],
  ): Promise<{ name: string; cents: number; count: number }[]>;
  /** promotions: lifetime redemptions per code, so a campaign that carried one
      can show what it actually brought in. */
  couponRedemptions?(db: PrismaClient): Promise<{ code: string; redeemed: number }[]>;

  /** orders: today and the trailing week, for the dashboard's sales tiles. */
  salesOverview?(db: PrismaClient, w: OverviewWindow): Promise<SalesOverview>;
  /* one dashboard tile each, counted over the module's own table. No module,
     no tile — the dashboard already hides the ones it has no module for. */
  /** reservations: confirmed table bookings still ahead. */
  upcomingReservations?(db: PrismaClient): Promise<number>;
  /** appointments: confirmed appointments still ahead. */
  upcomingAppointments?(db: PrismaClient): Promise<number>;
  /** reviews: reviews waiting for the owner to approve them. */
  pendingReviews?(db: PrismaClient): Promise<number>;
  /** content: articles already published, which the local-SEO card scores on. */
  publishedPosts?(db: PrismaClient): Promise<number>;
}

export const offers: ModuleOffers = {};

export function registerOffers(h: ModuleOffers): void {
  Object.assign(offers, h);
}

/* ── what a report is made of ─────────────────────────────────────────────

   Reports are the one screen that legitimately reads every table on the site,
   which is exactly why they must not import every module. So analytics states
   only the WINDOW — how long, ending when, in which timezone — and each module
   answers for its own tables. Analytics never learns what a Category or a
   StaffMember is; it receives finished sections and lays them out.

   Sales are the spine, because the other sections are all cuts OF sales: the
   tender mix, the category split and the staff league table are the same
   completed orders counted three other ways. Those orders belong to the orders
   module, so its report carries the little that the cuts need — which orders,
   which lines, which staff — under `attribution`. Analytics hands that batch
   straight to the offers that asked for it and never reads inside. That keeps
   this a courier, not a query language: a module gets the sales, and answers
   with a finished section or nothing at all. */

/** the period a report covers */
export interface ReportWindow {
  /** how many days the window spans, and how many `byDay` buckets to fill */
  days: number;
  since: Date;
  /** start of the equal-length period before `since`, for the vs-previous deltas */
  prevSince: Date;
  /** IANA zone the business trades in — every day, hour and weekday key is in it */
  timezone: string;
}

export interface SalesReport {
  totalCents: number;
  orderCount: number;
  aovCents: number;
  cancelRate: number;
  prevTotalCents: number;
  prevOrderCount: number;
  byDay: { date: string; cents: number }[];
  statusCounts: Record<string, number>;
  topItems: { name: string; qty: number }[];
  byHour: { hour: number; count: number }[];
  byWeekday: { dow: string; count: number }[];
  /** the completed sales the other report offers cut differently */
  attribution: {
    orderIds: string[];
    items: { name: string; qty: number; cents: number }[];
    staff: { staffId: string; cents: number; count: number }[];
  };
}

/** today plus the trailing week the dashboard charts */
export interface OverviewWindow {
  /** today's dateKey in the business timezone, e.g. "2026-07-25" */
  today: string;
  since: Date;
  timezone: string;
}

export interface SalesOverview {
  todayRevenueCents: number;
  todayOrders: number;
  revenueByDay: { date: string; cents: number }[];
  topItems: { name: string; qty: number }[];
  latestOrder: { id: string; code: string; contactName: string; totalCents: number; status: string } | null;
}

/** A leg was owed but the module that pays it is not installed. That means the
    site holds data it cannot service — a misconfiguration, never a silent skip.
    Thrown inside the transaction so it rolls back and the refund stays owed and
    retryable rather than being marked done. */
export class MissingModuleError extends Error {
  constructor(leg: string, module: string) {
    super(`Cannot restore ${leg}: the ${module} module is not installed on this site.`);
    this.name = 'MissingModuleError';
  }
}
