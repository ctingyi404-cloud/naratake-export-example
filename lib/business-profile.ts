/* The business profile a visitor reads, and the rule that decides where each
   field comes from.

   THE PROBLEM THIS SOLVES. This site has always had two copies of "what is our
   phone number". `site.config.json` holds the copy Naratake baked in at export
   time, and 112 reads across 26 files render it. The `Business` row holds the
   copy the back office edits, and 43 server call sites (orders, bookings,
   availability, tax, POS) already honour it. Nothing joined them, so a merchant
   could change their phone number in Settings, watch the booking engine respect
   it, and never see the site change. The dashboard even told them to do it:
   "Replace the placeholder phone and address in Settings" — a check that could
   never go green.

   THE RULE. Per field, the published config wins UNTIL the merchant explicitly
   takes that field over from the back office. The set of taken-over fields is
   recorded separately (lib/business-db.ts), never inferred from the values,
   because a value can differ for two opposite reasons:

     - the merchant typed something here            → their value must win
     - Naratake republished with a new value        → the NEW config must win

   Inferring from a diff cannot tell those apart, and guessing wrong is a live
   customer site showing a number nobody chose. Recording the decision at the
   moment the merchant makes it can.

   THE CONSEQUENCE, STATED OUT LOUD. Once a merchant edits their phone here,
   editing it in Studio and republishing no longer changes the site: the person
   standing in the shop outranks the file. "Use published value" in Settings
   hands the field back.

   This module is PURE — no database client, direct or transitive — on purpose.
   A database-free release (a portfolio, a landing page, a brochure, and
   anything published as a storefront delivery) ships no Prisma, no server/, and
   no admin at all; packages/codegen/src/static-site.ts derives that drop set by
   import closure, so a file that reaches the database takes every importer down
   with it. The footer and the map card import THIS file and keep working with
   nothing but the baked config. lib/business-db.ts is the half that touches the
   row, and it is dropped, unread, on a site that has no row to read.

   Note for whoever edits these comments: that drop set is seeded by a plain
   regex over each file's SOURCE, so merely naming the Prisma client package
   here — even inside a comment — deletes this file from every static export,
   and the footer with it. Write about the database without spelling the import. */

import { site } from './site-config';
import { publicBusinessName, publicEmail, publicPhone } from './public-contact';

export type PublicBusiness = (typeof site)['business'];
export type WeekHoursValue = PublicBusiness['hours'];

/** The fields a merchant can take over from the back office.

    Deliberately only what a shop changes without redesigning anything: the
    name over the door, how to reach them, where they are, when they are open.
    `taxRateBp`, `delivery`, `timezone` and `currency` stay purely operational —
    the back office has always edited those and no visitor renders them as the
    business profile. `logo`, `socials`, `license` and `schemaType` stay with
    Studio because changing them is a design decision, not a Tuesday. */
export const PUBLIC_BUSINESS_FIELDS = ['name', 'phone', 'email', 'address', 'hours'] as const;
export type PublicBusinessField = (typeof PUBLIC_BUSINESS_FIELDS)[number];

const FIELD_SET = new Set<string>(PUBLIC_BUSINESS_FIELDS);
export const isPublicBusinessField = (v: string): v is PublicBusinessField => FIELD_SET.has(v);

/** What Naratake published. Already sanitized by the exporter — this is the
    value every page renders today and the fallback for every field nobody has
    taken over. */
export function publishedBusiness(): PublicBusiness {
  return site.business;
}

/** The stored shape this module can consume: a `Business` row, or the body of
    a settings PATCH. Everything is `unknown` because a Json column is. */
export interface BusinessRowLike {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  hours?: unknown;
}

function asAddress(raw: unknown): PublicBusiness['address'] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const part = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  const out = { line1: part('line1'), city: part('city'), state: part('state'), zip: part('zip') };
  // an address with nothing in it is not an override, it is an empty row; the
  // published address is better than a footer that reads ", , "
  return out.line1 || out.city || out.state || out.zip ? out : null;
}

function asHours(raw: unknown): WeekHoursValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, [string, string][] | null> = {};
  for (const [day, spans] of Object.entries(raw as Record<string, unknown>)) {
    if (spans === null) {
      out[day] = null;
      continue;
    }
    if (!Array.isArray(spans)) continue;
    const clean = spans.filter(
      (s): s is [string, string] =>
        Array.isArray(s) && s.length === 2 && typeof s[0] === 'string' && typeof s[1] === 'string',
    );
    out[day] = clean;
  }
  return Object.keys(out).length ? (out as WeekHoursValue) : null;
}

/**
 * The one join between the two copies. `overrides` names the fields the
 * merchant has taken over; everything else comes from the published config.
 *
 * Every value that becomes a URI target goes through the exporter's own
 * sanitizer on the way out (lib/public-contact.ts), so a stored value the
 * exporter would have dropped renders exactly as it renders today — as nothing
 * — instead of as a live `tel:` href full of whatever was typed.
 */
export function resolvePublicBusiness(
  row: BusinessRowLike | null | undefined,
  overrides: Iterable<string>,
): PublicBusiness {
  const published = publishedBusiness();
  const out: PublicBusiness = { ...published };
  if (!row) return out;
  const on = new Set(overrides);

  // a nameless site is not a choice anyone can make on purpose
  if (on.has('name')) out.name = publicBusinessName(row.name) ?? published.name;
  // '' is the exporter's own "unusable, draw no link" value, so an unusable
  // stored contact lands in exactly the state the config path already produces
  if (on.has('phone')) out.phone = publicPhone(row.phone) ?? '';
  if (on.has('email')) out.email = publicEmail(row.email) ?? '';
  if (on.has('address')) out.address = asAddress(row.address) ?? published.address;
  if (on.has('hours')) out.hours = asHours(row.hours) ?? published.hours;
  return out;
}

/* Key order is not information. Postgres `jsonb` reorders object keys on the
   way in, so the SAME hours read back from a Neon deployment stringify
   differently from the config they were seeded from — which would have flagged
   every Postgres site as "you have unpublished changes" on day one. Compare
   canonically or do not compare. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** Are these two values the same business fact? Canonical, so key order and
    the difference between an absent and an empty span never read as a change. */
export function sameBusinessValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** Would this stored value, if taken over, actually change what a visitor
    reads? Used to decide what a Save takes over: typing the published value
    back in is not a takeover, so the field keeps tracking Studio. */
export function differsFromPublished(field: PublicBusinessField, row: BusinessRowLike): boolean {
  // both sides through the same normalizer, so "differs" can only ever mean the
  // VALUE differs — never that one side happened to be shaped by the exporter
  const mine = resolvePublicBusiness(row, [field]);
  const theirs = resolvePublicBusiness(publishedBusiness(), [field]);
  return !sameBusinessValue(mine[field], theirs[field]);
}

/** Fields whose stored value differs from what the site publishes. */
export function divergentFields(row: BusinessRowLike | null | undefined): PublicBusinessField[] {
  if (!row) return [];
  return PUBLIC_BUSINESS_FIELDS.filter((f) => differsFromPublished(f, row));
}

/**
 * The override set to assume for a site that has never recorded one.
 *
 * Only `hours`, and only when the row already disagrees with the config. This
 * is not a guess, it is a description of the shipped behaviour: `RtBusinessHours`
 * has always re-fetched `GET /api/v1/business` after mount and replaced the
 * baked hours with the row's, unconditionally. Every other field has always
 * shown the config. Assuming this exact set is what makes an already-published
 * site that gains this code render precisely what it rendered yesterday —
 * including the one field where the database already won.
 *
 * It applies once. The first Save writes an explicit set and this stops being
 * consulted.
 */
export function assumedOverrides(row: BusinessRowLike | null | undefined): PublicBusinessField[] {
  return row && differsFromPublished('hours', row) ? ['hours'] : [];
}
