/** Pure calendar arithmetic and advisory warnings; no provider calls or source mutations. */
import { businessDayKey, businessDayStart, dayDiff, isCalendarDay, nextDay } from "../metrics/business-day.ts";
import { businessLocalToUtc, nextActionLocalParts } from "../contacts/next-action.ts";
import { CALENDAR_KINDS, type CalendarItem, type CalendarKind, type CalendarQuery, type CalendarWarning } from "./domain.ts";

export const MAX_CALENDAR_QUERY_DAYS = 93;
export const DEFAULT_PLANNING_BUFFER_MINUTES = 15;

/** Exclusive local-day bounds, measured from the calendar rather than 24-hour additions. */
export function calendarQueryWindow(query: Pick<CalendarQuery, "fromDay" | "toDay">): { from: string; to: string } | null {
  if (!isCalendarDay(query.fromDay) || !isCalendarDay(query.toDay)) return null;
  const days = dayDiff(query.toDay, query.fromDay);
  if (days < 1 || days > MAX_CALENDAR_QUERY_DAYS) return null;
  return { from: businessDayStart(query.fromDay).toISOString(), to: businessDayStart(query.toDay).toISOString() };
}

/** One canonical query contract for routes, source services and the isolated preview. */
export function readCalendarQuery(params: URLSearchParams): CalendarQuery | null {
  const allowed = ["fromDay", "toDay", "kinds"];
  if ([...params.keys()].some(key => !allowed.includes(key)) || allowed.some(key => params.getAll(key).length > 1)) return null;
  const fromDay = params.get("fromDay"), toDay = params.get("toDay");
  if (!fromDay || !toDay || !calendarQueryWindow({ fromDay, toDay })) return null;
  const rawKinds = params.get("kinds");
  if (rawKinds === null) return { fromDay, toDay };
  const kinds = rawKinds.split(",");
  if (!kinds.length || new Set(kinds).size !== kinds.length || kinds.some(kind => !(CALENDAR_KINDS as readonly string[]).includes(kind))) return null;
  return { fromDay, toDay, kinds: kinds as CalendarKind[] };
}

function instant(value: string | null | undefined): number | null {
  if (!value || !isCalendarDay(value.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** All-day facts retain their stored date; actual intervals can occur on several local days. */
export function calendarItemOccursOnDay(item: CalendarItem, day: string): boolean {
  if (!isCalendarDay(day)) return false;
  if (item.allDay) return item.day === day;
  const starts = instant(item.startsAt);
  if (starts === null) return false;
  const ends = instant(item.endsAt);
  const from = businessDayStart(day).getTime(), to = businessDayStart(nextDay(day)).getTime();
  if (item.endsAt !== null) return ends !== null && ends > starts && starts < to && ends > from;
  // An untimed tour/task marker is a point; it never borrows an appointment duration.
  return !item.blocksTime && starts >= from && starts < to;
}

/** A copy, with all-day facts first within each date and instants compared numerically. */
export function sortCalendarItems(items: readonly CalendarItem[]): CalendarItem[] {
  return [...items].sort((a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay)
    || (instant(a.startsAt) ?? Infinity) - (instant(b.startsAt) ?? Infinity) || a.id.localeCompare(b.id));
}

export function itemsForDay(items: readonly CalendarItem[], day: string): CalendarItem[] {
  return [...items.filter(item => calendarItemOccursOnDay(item, day))].sort((a, b) => Number(b.allDay) - Number(a.allDay)
    || (instant(a.startsAt) ?? Infinity) - (instant(b.startsAt) ?? Infinity) || a.id.localeCompare(b.id));
}

export type CalendarLocalScheduleResult =
  | { ok: true; startsAt: string; ambiguous: boolean; preservedExistingTime: boolean }
  | { ok: false; reason: "invalid" | "nonexistent_time" };

/** Preserve an unchanged later fall-back instant; new repeated times choose the earlier occurrence. */
export function calendarLocalSchedule(day: string, time: string, originalStartsAt?: string | null): CalendarLocalScheduleResult {
  const converted = businessLocalToUtc(day, time);
  if (!converted.ok) return converted;
  const original = instant(originalStartsAt) === null ? null : nextActionLocalParts(originalStartsAt!);
  const preservedExistingTime = original?.day === day && original.time === time;
  return { ok: true, startsAt: preservedExistingTime ? originalStartsAt! : converted.dueAt, ambiguous: converted.ambiguous, preservedExistingTime };
}

/** Advisory planning gaps are never traffic, driving estimates or a permission to move appointments. */
export function buildCalendarWarnings(items: readonly CalendarItem[], options: { bufferMinutes?: number } = {}): CalendarWarning[] {
  const buffer = options.bufferMinutes ?? DEFAULT_PLANNING_BUFFER_MINUTES;
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 60) throw new RangeError("Choose a planning buffer from 0 to 60 minutes.");
  const seen = new Set<string>();
  const appointments = items.flatMap(item => {
    if (seen.has(item.id) || item.kind !== "showing" || !item.blocksTime || item.allDay || item.status !== "scheduled") return [];
    const starts = instant(item.startsAt), ends = instant(item.endsAt);
    if (starts === null || ends === null || ends <= starts) return [];
    seen.add(item.id);
    return [{ item, starts, ends }];
  }).sort((a, b) => a.starts - b.starts || a.ends - b.ends || a.item.id.localeCompare(b.item.id));
  const warnings: CalendarWarning[] = [];
  for (let i = 0; i < appointments.length; i++) {
    const before = appointments[i];
    for (let j = i + 1; j < appointments.length; j++) {
      const after = appointments[j];
      const gap = (after.starts - before.ends) / 60_000;
      // Sorted starts let us bound work without skipping any later overlapping interval.
      if (gap >= buffer && gap >= 0) break;
      const overlap = after.starts < before.ends;
      if (!overlap && (buffer === 0 || gap >= buffer)) continue;
      const kind = overlap ? "overlap" : "planning_buffer";
      warnings.push({
        id: `${kind}:${JSON.stringify([before.item.id, after.item.id])}`,
        kind, itemIds: [before.item.id, after.item.id], day: businessDayKey(new Date(after.starts)), gapMinutes: gap,
        message: overlap ? "These scheduled showings overlap." : `Less than your ${buffer}-minute planning buffer remains between these showings. Driving time has not been calculated.`,
      });
    }
  }
  return warnings;
}
