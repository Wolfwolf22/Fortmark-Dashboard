/**
 * The business day: which calendar day it is, for the people using FortMark.
 *
 * Until the follow-up work the application had no timezone at all. Every
 * "today" was the UTC day (`dayKey`), which is right for a stored `date`
 * column and wrong for a person: at 11:30 PM in Fort Lauderdale it is already
 * tomorrow in UTC, so tomorrow's follow-up read "Due today" and today's read
 * "Overdue" for the last four or five hours of every evening.
 *
 * There is no per-user or per-brokerage timezone in the schema, the profile
 * or the session, and inventing a settings surface for Core V1 would be a
 * second system nobody asked for. So this is the smallest durable rule: one
 * application business timezone. FortMark operates in South Florida; when a
 * brokerage outside Eastern time joins, this constant is the one thing that
 * becomes a per-brokerage setting.
 *
 * Only the follow-up path uses it. Metric windows and transaction deadlines
 * still reason in UTC days (`window.ts`); moving those is a separate,
 * deliberate change with its own tests.
 *
 * Pure and dependency-free (`Intl` only), so tests can pin instants on either
 * side of a day boundary and of a daylight-saving change.
 */

/** The application's business timezone. US Eastern, with daylight saving. */
export const BUSINESS_TIME_ZONE = "America/New_York";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Wall-clock parts of an instant in a timezone. */
function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYY-MM-DD`: the calendar day this instant falls on in the business timezone. */
export function businessDayKey(at: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const p = zonedParts(at, timeZone);
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

/** Milliseconds the timezone is ahead of UTC at this instant (negative in the Americas). */
function offsetMs(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Whether `day` is a real `YYYY-MM-DD` calendar day (no Feb 30). */
export function isCalendarDay(day: string): boolean {
  const m = DAY.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Pure calendar arithmetic. */
export function dayDiff(to: string, from: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** The day after `day`. */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The instant a business day begins: local midnight, as a UTC instant.
 *
 * Solved rather than assumed: the offset is measured at the guess and again at
 * the corrected instant, so a day that begins on the other side of a
 * daylight-saving change still lands on the right side of it. Midnight is
 * never inside the transition (it happens at 2 AM), so this is unambiguous.
 */
export function businessDayStart(day: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const guess = Date.parse(`${day}T00:00:00.000Z`);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/**
 * The first instant of the business day after the one containing `at`.
 *
 * "Due today or earlier" is exactly "stored strictly before this", which is
 * what Home's SQL compares against. A day is 23, 24 or 25 hours long here, so
 * it is measured from the calendar, never by adding 24 hours.
 */
export function startOfNextBusinessDay(at: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  return businessDayStart(nextDay(businessDayKey(at, timeZone)), timeZone);
}
