/* Day-window maths shared by the three slot engines (orders pickup windows,
   reservation seatings, appointment/class slots). No module owns it, so it
   lives beside them rather than inside any one — and the maths lives in exactly
   one place, because a lead-time or day-boundary rule that drifts between two
   engines is how a double booking gets shipped on one side only. */

import { nowMinutes, zonedDate } from '@/lib/hours';

/** the calendar day a moment falls on in the business time zone, "YYYY-MM-DD" */
export function dateKeyFor(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

/** today's calendar day in the business time zone */
export function todayKeyFor(tz: string): string {
  return dateKeyFor(new Date(), tz);
}

/** First bookable minute-of-day: on today, `noticeMin` minutes from now; on any
    later day, midnight (the whole day is still open). */
export function earliestMinute(dateKey: string, tz: string, noticeMin: number): number {
  return dateKey === todayKeyFor(tz) ? nowMinutes(tz) + noticeMin : 0;
}

/** The window to load a day's bookings from: midnight plus 36h, wide enough to
    catch a service that opened yesterday and runs past midnight. */
export function dayWindow(dateKey: string, tz: string): { dayStart: Date; dayEnd: Date } {
  const dayStart = zonedDate(dateKey, '00:00', tz);
  return { dayStart, dayEnd: new Date(dayStart.getTime() + 36 * 3600_000) };
}
