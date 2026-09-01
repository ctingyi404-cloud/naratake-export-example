/* Can the store take an order right now? One place answers it — the slots
   endpoint, the order endpoint, and the admin panel all consult this gate, so
   a paused kitchen or a holiday can never be ordered around via a direct POST. */

import { db } from './db';
import { dateKeyFor, nowMinutes, spansFor, toMin, type WeekHours } from './hours';

const PAUSE_KEY = 'ordering.pausedUntil'; // ISO timestamp
const BLACKOUT_KEY = 'ordering.blackout'; // JSON array of "YYYY-MM-DD"

export async function getSetting(key: string): Promise<string | null> {
  return (await db.setting.findUnique({ where: { key } }))?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) await db.setting.deleteMany({ where: { key } });
  else await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export interface OrderingStatus {
  open: boolean;
  reason?: 'paused' | 'blackout' | 'closed';
  /** ISO timestamp when a pause lifts (lets the storefront show "back at …") */
  pausedUntil?: string;
  blackoutDates: string[];
}

export async function getPause(): Promise<string | null> {
  const until = await getSetting(PAUSE_KEY);
  return until && new Date(until) > new Date() ? until : null;
}

export async function getBlackoutDates(): Promise<string[]> {
  try {
    return JSON.parse((await getSetting(BLACKOUT_KEY)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export async function setPause(untilIso: string | null): Promise<void> {
  await setSetting(PAUSE_KEY, untilIso);
}

export async function setBlackoutDates(dates: string[]): Promise<void> {
  await setSetting(BLACKOUT_KEY, dates.length ? JSON.stringify([...new Set(dates)].sort()) : null);
}

/** Gate for an order landing on `dateKey` (today unless scheduled ahead). */
export async function orderingStatus(
  business: { hours: unknown; timezone: string },
  dateKey?: string,
): Promise<OrderingStatus> {
  const [pausedUntil, blackoutDates] = await Promise.all([getPause(), getBlackoutDates()]);
  const day = dateKey ?? dateKeyFor(new Date(), business.timezone);
  if (pausedUntil) return { open: false, reason: 'paused', pausedUntil, blackoutDates };
  if (blackoutDates.includes(day)) return { open: false, reason: 'blackout', blackoutDates };
  return { open: true, blackoutDates };
}

/** For ASAP orders only: is the store open at this wall-clock minute? */
export function openNow(business: { hours: unknown; timezone: string }): boolean {
  const spans = spansFor(business.hours as WeekHours, new Date(), business.timezone);
  const now = nowMinutes(business.timezone);
  return spans.some(([a, b]) => now >= toMin(a) && now < toMin(b));
}
