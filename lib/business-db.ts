/* The database half of the business profile: which fields the merchant has
   taken over, and the cached snapshot every server surface reads.

   This file imports lib/db, so packages/codegen/src/static-site.ts drops it —
   and everything that imports it — from a site with no database. That is the
   point: nothing on a static site's render path may reach this module, and the
   import closure enforces it rather than a comment asking nicely. The pure half
   (lib/business-profile.ts) is what the footer imports and it survives.

   WHY A `Setting` ROW AND NOT A NEW TABLE. Two reasons, both about the sites
   already serving customers.

   1. scripts/db-prepare.mjs runs `npx prisma db push --skip-generate` as the
      FIRST command of `vercel-build`, so a schema change lands on the next
      publish and a schema change that `db push` refuses (a required column with
      no default, on a table that already has rows) takes the merchant's whole
      deploy down with it, three retries and thirty seconds later. `Setting` is
      already in prisma/base.prisma — the core half that ships with every
      database-backed export, module drops and all — so this feature adds no
      schema delta at all and there is nothing for `db push` to refuse.
   2. The values themselves must NOT move to a new table. The `Business` row is
      already read by 43 server call sites (orders, bookings, availability, tax,
      POS, cron). A second store for the same facts would let the booking engine
      and the footer disagree about the opening hours. One value store, plus a
      small record of which fields the merchant has spoken for. */

import { revalidateTag, unstable_cache } from 'next/cache';
import { db } from './db';
import {
  assumedOverrides,
  differsFromPublished,
  isPublicBusinessField,
  publishedBusiness,
  PUBLIC_BUSINESS_FIELDS,
  resolvePublicBusiness,
  type BusinessRowLike,
  type PublicBusiness,
  type PublicBusinessField,
} from './business-profile';

/** Purged by a settings save; see `revalidateBusiness`. */
export const BUSINESS_TAG = 'business-profile';
const OVERRIDES_KEY = 'business.overrides';

export interface BusinessSnapshot {
  /** what a visitor should read: config, with the taken-over fields applied */
  profile: PublicBusiness;
  /** the fields the merchant has taken over */
  overrides: PublicBusinessField[];
  /** stored values that differ from the published ones but are NOT live —
      an edit the merchant made before this feature existed, and which the site
      has been quietly ignoring ever since */
  stranded: PublicBusinessField[];
  /* operational fields — always the row, as they have always been */
  timezone: string;
  currency: string;
  taxRateBp: number;
  delivery: unknown;
}

function parseOverrides(value: string): PublicBusinessField[] | null {
  try {
    const raw: unknown = JSON.parse(value);
    if (!Array.isArray(raw)) return null;
    return PUBLIC_BUSINESS_FIELDS.filter((f) => raw.includes(f));
  } catch {
    return null;
  }
}

/** The recorded set, or the one to assume for a site that never recorded one.
    A malformed row is treated as "never recorded" rather than as "nothing is
    overridden": losing the merchant's takeover silently is the worse failure. */
async function currentOverrides(row: BusinessRowLike): Promise<PublicBusinessField[]> {
  const stored = await db.setting.findUnique({ where: { key: OVERRIDES_KEY } });
  return (stored && parseOverrides(stored.value)) ?? assumedOverrides(row);
}

/* Throws on a database error on purpose. `unstable_cache` does not store a
   rejected promise, so a Neon cold start or a dropped connection falls through
   to the published config for that one request and heals on the next — rather
   than pinning the fallback in the data cache until the merchant next saves. */
async function readSnapshot(): Promise<BusinessSnapshot> {
  const row = await db.business.findFirstOrThrow();
  const overrides = await currentOverrides(row);
  const live = new Set<string>(overrides);
  return {
    profile: resolvePublicBusiness(row, overrides),
    overrides,
    stranded: PUBLIC_BUSINESS_FIELDS.filter((f) => !live.has(f) && differsFromPublished(f, row)),
    timezone: row.timezone,
    currency: row.currency,
    taxRateBp: row.taxRateBp,
    delivery: row.delivery,
  };
}

/* Cached, because the client upgrade in lib/business-client.ts means
   GET /api/v1/business is now on the path of every page view: uncached that is
   one database round trip per visitor per page, on a serverless plan that bills
   for it. Tagged rather than time-boxed so a save is visible immediately
   instead of "within 60 seconds" — revalidateBusiness() below purges it. */
const cachedSnapshot = unstable_cache(readSnapshot, ['business-profile'], { tags: [BUSINESS_TAG] });

function publishedSnapshot(): BusinessSnapshot {
  const published = publishedBusiness();
  return {
    profile: published,
    overrides: [],
    stranded: [],
    timezone: published.timezone,
    currency: 'usd',
    taxRateBp: published.taxRateBp,
    delivery: null,
  };
}

/**
 * What the site should say about itself right now.
 *
 * Never throws. A footer that renders yesterday's phone number is a bad day; a
 * footer that renders a 500 is a closed shop. The same guarantee keeps
 * `next build` alive on a machine whose DATABASE_URL is not reachable yet.
 */
export async function businessSnapshot(): Promise<BusinessSnapshot> {
  try {
    return await cachedSnapshot();
  } catch {
    try {
      return await readSnapshot();
    } catch {
      return publishedSnapshot();
    }
  }
}

export async function publicBusiness(): Promise<PublicBusiness> {
  return (await businessSnapshot()).profile;
}

/** Record the takeover set. Always writes, even when empty: an explicit empty
    set is how "this merchant has spoken, and chose to follow Studio" is told
    apart from "this site predates the feature" (see `assumedOverrides`). */
export async function recordOverrides(fields: readonly string[]): Promise<PublicBusinessField[]> {
  const kept = PUBLIC_BUSINESS_FIELDS.filter((f) => fields.includes(f));
  const value = JSON.stringify(kept);
  await db.setting.upsert({
    where: { key: OVERRIDES_KEY },
    update: { value },
    create: { key: OVERRIDES_KEY, value },
  });
  return kept;
}

/** The takeover set implied by a saved row: every public field whose value
    differs from what Studio published. Typing the published value back in
    therefore hands the field back — that is what "Use published value" does,
    with no second endpoint and no second permission to get wrong. */
export function overridesFor(row: BusinessRowLike): PublicBusinessField[] {
  return PUBLIC_BUSINESS_FIELDS.filter((f) => differsFromPublished(f, row));
}

/** Drop the cached snapshot so the next read sees the save.

    Best-effort by contract: `revalidateTag` needs a Next request scope, and a
    save that succeeded must not report failure because a cache hint could not
    be delivered. Worst case the merchant waits for the next deployment's cache
    generation, which is the behaviour they have today. */
export async function revalidateBusiness(): Promise<void> {
  try {
    revalidateTag(BUSINESS_TAG);
  } catch (error) {
    console.warn('[business] could not purge the profile cache', error);
  }
}

export { isPublicBusinessField, PUBLIC_BUSINESS_FIELDS, type PublicBusinessField };
