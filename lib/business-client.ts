'use client';

/* The visitor's side of the business profile.

   WHY A CLIENT UPGRADE AND NOT A SERVER READ. The pages that render the footer,
   the navbar and the map card are statically prerendered, and their `<head>` —
   `export const metadata`, the LocalBusiness JSON-LD — is built from
   module-scope constants. Making any of that read the database would turn every
   page on the site dynamic: a database round trip on every visit, on a plan
   that bills per invocation, to serve a phone number that changes twice a year.
   It would also be impossible on a database-free release, which ships no
   database at all and drops every file that reaches one.

   So the server keeps rendering the published value — instantly, cached, and
   correct for a crawler — and the browser upgrades it to the live one after
   mount. That is not a new idea here: `RtBusinessHours` has worked exactly this
   way since the hours endpoint existed, and this module is that pattern made
   shared so the footer and the navbar stop being the only things on the page
   still showing last month's number.

   Without a database `apiGet` is replaced by a stub that throws
   (packages/codegen/src/static-site.ts `staticApiClient`), the fetch rejects,
   and every caller keeps the baked value. That is the correct answer there:
   such a site has no back office, so there is nothing live to upgrade to. */

import { useEffect, useState } from 'react';
import { apiGet } from './client';
import { PUBLIC_BUSINESS_FIELDS, publishedBusiness, type PublicBusiness } from './business-profile';

/* One fetch per page, not one per component. The footer, the navbar, the map
   card and the opening-hours table all want the same answer, and the navbar is
   on every page — four requests where one will do is a real cost on a phone. */
let settled: PublicBusiness | null = null;
let inFlight: Promise<PublicBusiness> | null = null;

async function fetchProfile(): Promise<PublicBusiness> {
  const published = publishedBusiness();
  const live = await apiGet<Partial<PublicBusiness>>('/business');
  /* An allowlist, not a spread. `/business` also serves the operational fields
     (timezone, taxRateBp, delivery) that ordering and date formatting read from
     the row already; letting those in through the back door would change how
     dates render on the strength of a settings screen that never claimed to. */
  const out: PublicBusiness = { ...published };
  for (const field of PUBLIC_BUSINESS_FIELDS) {
    const value = live[field];
    if (value !== undefined && value !== null) (out as Record<string, unknown>)[field] = value;
  }
  return out;
}

function load(): Promise<PublicBusiness> {
  if (settled) return Promise.resolve(settled);
  inFlight ??= fetchProfile()
    .then((profile) => {
      settled = profile;
      return profile;
    })
    .catch(() => {
      // no live answer (no API on this release, offline, cold database): the
      // baked value is not a degraded state, it is what the page already shows
      inFlight = null;
      return publishedBusiness();
    });
  return inFlight;
}

/**
 * The business profile, starting at the published value and upgrading to the
 * live one once it lands.
 *
 * The first render deliberately returns the published value even when the
 * answer is already cached: the server rendered that HTML, and returning
 * anything else on the hydrating render is a mismatch React will discard the
 * whole tree over.
 */
export function useLiveBusiness(): PublicBusiness {
  const [profile, setProfile] = useState<PublicBusiness>(publishedBusiness);
  useEffect(() => {
    let alive = true;
    void load().then((next) => {
      if (alive) setProfile(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return profile;
}
