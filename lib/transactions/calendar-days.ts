/** Transaction dates are entered calendar days; "today" follows New York. */
import { businessDayKey, dayDiff, isCalendarDay } from "../metrics/business-day.ts";
export const isValidCalendarDay = isCalendarDay;
export const calendarDayKey = (now: Date = new Date()): string => businessDayKey(now);
/** Compatibility ISO projection, at noon UTC. Display through formatTransactionDay. */
export function calendarDayIso(day: string): string | undefined { return isCalendarDay(day) ? `${day}T12:00:00.000Z` : undefined; }
export function transactionDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string" && isCalendarDay(value)) return value;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? businessDayKey(instant) : null;
}
export function calendarDayDistance(to: string, from: string): number { return dayDiff(to, from); }
export function daysUntilTransactionDay(value: string | Date | null | undefined, now = new Date()): number | null { const day = transactionDay(value); return day ? dayDiff(day, businessDayKey(now)) : null; }
export function formatTransactionDay(value: string | Date | null | undefined, short = false): string {
  const day = transactionDay(value); if (!day) return "—";
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(short ? {} : { year: "numeric" as const }), timeZone: "UTC" });
}
export function transactionDeadlineState(day: string, completedAt: Date | string | null, now = new Date()): "done" | "upcoming" | "overdue" { return completedAt ? "done" : day < businessDayKey(now) ? "overdue" : "upcoming"; }
