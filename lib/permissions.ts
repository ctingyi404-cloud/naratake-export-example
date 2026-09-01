/* Who may do what in the back office.

   One table, applied in ONE place: the session middleware in server/admin.ts
   that every module's routes are mounted behind. Per-handler checks are the
   usual way to do this and the usual way to forget it — mounting order already
   guarantees the middleware runs first, so classifying the request there means
   a route added tomorrow is governed the moment it exists.

   Pure on purpose (role + method + path in, verdict out): this is a security
   boundary, and test/permissions.test.ts pins the rules that matter. */

export const ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);

/** What a request DOES. `money` is carved out of `write` because moving a
    customer's money — and changing the prices and tax that decide how much
    moves — is the one thing the weakest role must never reach. */
export type Action = 'read' | 'write' | 'delete' | 'money';

/* The surfaces that actually exist, one per path prefix in
   server/modules/*.admin.ts. `account` is a person's own login; `other` is the
   catch-all for anything unmapped, which fails closed for STAFF without ever
   locking an owner out of a route nobody has classified yet. */
export type Resource =
  | 'account'
  | 'users'
  | 'settings'
  | 'media'
  | 'catalog'
  | 'orders'
  | 'pos'
  | 'terminals'
  | 'reservations'
  | 'appointments'
  | 'customers'
  | 'marketing'
  | 'reviews'
  | 'promotions'
  | 'content'
  | 'collections'
  | 'desk'
  | 'ads'
  | 'analytics'
  | 'other';

/* Longest-specific first; matched as a whole path segment so /staff never
   swallows /staffing. Several prefixes share a resource when one screen's
   routes were split across files (/classes and /staff are appointments). */
const PREFIXES: [string, Resource][] = [
  ['/me', 'account'],
  ['/auth', 'account'],
  ['/users', 'users'],
  ['/settings', 'settings'],
  ['/media', 'media'],
  ['/catalog', 'catalog'],
  ['/orders', 'orders'],
  ['/pos', 'pos'],
  ['/terminals', 'terminals'],
  ['/reservations', 'reservations'],
  ['/appointments', 'appointments'],
  ['/classes', 'appointments'],
  ['/staff', 'appointments'],
  ['/customers', 'customers'],
  ['/inbox', 'customers'],
  ['/marketing', 'marketing'],
  ['/reviews', 'reviews'],
  ['/coupons', 'promotions'],
  ['/giftcards', 'promotions'],
  ['/content', 'content'],
  ['/collections', 'collections'],
  ['/desk', 'desk'],
  ['/ads', 'ads'],
  ['/stats', 'analytics'],
];

/* Routes that move money, named individually because "which POST spends the
   merchant's money" is not derivable from the verb. Listed even where the
   resource is already out of STAFF's reach: the classification is the intent,
   and it must survive someone widening a grant later. */
const MONEY = [
  /^\/orders\/[^/]+\/refund$/, //            refund a customer
  /^\/appointments\/[^/]+\/refund-deposit$/, // return a booking deposit
  /^\/pos\/terminal\/void$/, //              void a card-present charge
  /^\/settings$/, //                         tax rate, delivery fee, minimums
  /^\/catalog\/items(\/.*)?$/, //            prices
  /^\/giftcards(\/.*)?$/, //                 issue or adjust stored value
];

const ALL: Action[] = ['read', 'write', 'delete', 'money'];
const NONE: Action[] = [];

/* `only` overrides `fallback` for the resources named. Read it as a sentence:
   a manager runs the whole business but cannot mint logins; a shift worker
   reads everything they need and writes only what a shift produces. */
const GRANTS: Record<Role, { fallback: Action[]; only?: Partial<Record<Resource, Action[]>> }> = {
  OWNER: { fallback: ALL },
  MANAGER: { fallback: ALL, only: { users: NONE } },
  STAFF: {
    fallback: ['read'],
    only: {
      users: NONE,
      analytics: NONE, // the revenue dashboard is the owner's business
      account: ['read', 'write'], // own name and password, always
      orders: ['read', 'write'],
      pos: ['read', 'write'],
      reservations: ['read', 'write'],
      appointments: ['read', 'write'],
      customers: ['read', 'write'],
      media: ['read', 'write'],
      // a writer moves their own story along; that is what a desk is for
      desk: ['read', 'write'],
      // who bought what, and for how much attention, is the owner's business
      ads: NONE,
    },
  },
};

/** Strip the API mount prefix so the tables above read like the route files. */
export function adminPath(path: string): string {
  const p = path.startsWith('/api/v1/admin') ? path.slice('/api/v1/admin'.length) : path;
  return p.replace(/\/+$/, '') || '/';
}

export function resourceOf(path: string): Resource {
  const p = adminPath(path);
  for (const [prefix, r] of PREFIXES) if (p === prefix || p.startsWith(prefix + '/')) return r;
  return 'other';
}

/* Reading a story's HISTORY is not the same permission as reading the story.

   A revision holds what an editor took OUT: a salary band pulled from a job
   post, a client name removed from a case study, a paragraph retracted after
   legal review. An account that may read the current entry has no claim on the
   versions somebody decided the public should not see, so history asks for the
   permission to change the entry rather than the permission to read it. */
const HISTORY = /^\/collections\/entries\/[^/]+\/(revisions|history)(\/|$)/;

export function actionOf(method: string, path: string): Action {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return HISTORY.test(adminPath(path)) ? 'write' : 'read';
  const p = adminPath(path);
  if (MONEY.some((re) => re.test(p))) return 'money';
  return m === 'DELETE' ? 'delete' : 'write';
}

/** The whole gate. An unrecognized role grants nothing (a row edited by hand,
    a token from an older shape) rather than defaulting to something useful. */
export function can(role: string, action: Action, resource: Resource): boolean {
  if (!isRole(role)) return false;
  const grant = GRANTS[role];
  return (grant.only?.[resource] ?? grant.fallback).includes(action);
}
