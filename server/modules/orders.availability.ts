/* orders — pickup slot engine. Computed in the business time zone. */

import { db } from '@/lib/db';
import { fromMin, spansFor, toMin, zonedDate, type WeekHours } from '@/lib/hours';
import { earliestMinute } from './_slots';

const PREP_MIN = 20;

export async function pickupSlots(dateKey: string): Promise<string[]> {
  const business = await db.business.findFirstOrThrow();
  const hours = business.hours as WeekHours;
  const tz = business.timezone;
  const date = zonedDate(dateKey, '12:00', tz);
  const spans = spansFor(hours, date, tz);
  const earliest = earliestMinute(dateKey, tz, PREP_MIN);

  const out: string[] = [];
  for (const [open, close] of spans) {
    let t = Math.max(toMin(open), earliest);
    t = Math.ceil(t / 15) * 15;
    const end = toMin(close) - 15;
    for (; t <= end; t += 15) out.push(fromMin(t));
  }
  return out;
}
