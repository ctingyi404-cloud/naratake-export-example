/* Opening-hours helpers shared by ordering slots, reservations, and
   appointment availability. All times operate in the business time zone. */

export type WeekHours = Record<string, [string, string][] | null>;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function dayKeyFor(date: Date, timezone: string): string {
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
    .format(date)
    .toLowerCase()
    .slice(0, 3);
  return wd;
}

/** minutes since midnight for "HH:MM" */
export function toMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMin(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function spansFor(hours: WeekHours, date: Date, timezone: string): [string, string][] {
  const key = dayKeyFor(date, timezone);
  return hours[key] ?? [];
}

/** "YYYY-MM-DD" in the business time zone */
export function dateKeyFor(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

/** local wall-clock minutes now in the business tz */
export function nowMinutes(timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Build a UTC Date for a local wall time on a given local date key. */
export function zonedDate(dateKey: string, hm: string, timezone: string): Date {
  // find the UTC offset for that date in the tz by probing
  const probe = new Date(`${dateKey}T${hm}:00Z`);
  const local = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(probe);
  const lh = Number(local.find((p) => p.type === 'hour')?.value ?? 0);
  const lm = Number(local.find((p) => p.type === 'minute')?.value ?? 0);
  const wanted = toMin(hm);
  const got = lh * 60 + lm;
  let diff = wanted - got;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return new Date(probe.getTime() + diff * 60_000);
}

export function weekdayFor(dateKey: string, timezone: string): number {
  const d = zonedDate(dateKey, '12:00', timezone);
  return DAY_KEYS.indexOf(dayKeyFor(d, timezone));
}
