/** Calendar navigation uses calendar-day arithmetic, independent of the browser timezone. */
import { businessDayKey, businessDayStart, isCalendarDay } from "@/lib/metrics/business-day";
export type CalendarView = "day" | "week" | "month";
export function calendarToday(now = new Date()): string { return businessDayKey(now); }
export function addCalendarDays(day: string, count: number): string { return new Date(Date.parse(`${day}T12:00:00.000Z`) + count * 86_400_000).toISOString().slice(0, 10); }
export function calendarWeekStart(day: string): string { const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay(); return addCalendarDays(day, -((weekday + 6) % 7)); }
export function calendarDays(view: CalendarView, day: string): string[] {
  if (view === "day") return [day];
  const first = view === "week" ? calendarWeekStart(day) : calendarWeekStart(`${day.slice(0, 7)}-01`);
  const nextMonth = new Date(`${day.slice(0, 7)}-01T12:00:00.000Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const last = view === "week" ? addCalendarDays(first, 6) : addCalendarDays(calendarWeekStart(addCalendarDays(nextMonth.toISOString().slice(0, 10), -1)), 6);
  const result: string[] = []; for (let next = first; next <= last; next = addCalendarDays(next, 1)) result.push(next); return result;
}
export function shiftCalendarDay(view: CalendarView, day: string, direction: number): string {
  if (view !== "month") return addCalendarDays(day, direction * (view === "week" ? 7 : 1));
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00.000Z`); date.setUTCMonth(date.getUTCMonth() + direction);
  const last = new Date(date); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  return `${date.toISOString().slice(0, 7)}-${String(Math.min(Number(day.slice(8, 10)), last.getUTCDate())).padStart(2, "0")}`;
}
export function formatCalendarDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }): string { return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00.000Z`)); }
export function calendarRangeLabel(view: CalendarView, day: string): string {
  if (view === "day") return formatCalendarDay(day);
  if (view === "month") return formatCalendarDay(day, { month: "long", year: "numeric" });
  const days = calendarDays(view, day); return `${formatCalendarDay(days[0], { month: "short", day: "numeric" })} – ${formatCalendarDay(days[6], { month: "short", day: "numeric", year: "numeric" })}`;
}
export function calendarInstantRange(view: CalendarView, day: string): { from: string; to: string } { const days = calendarDays(view, day); return { from: businessDayStart(days[0]).toISOString(), to: businessDayStart(addCalendarDays(days[days.length - 1], 1)).toISOString() }; }
export function readCalendarDay(value: string | null, now = new Date()): string { return value && isCalendarDay(value) ? value : calendarToday(now); }
export function calendarTime(value: string): string { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }

import { CALENDAR_KINDS, type CalendarItem, type CalendarKind, type CalendarPage, type CalendarRescheduleInput } from "@/lib/calendar/domain";
import { calendarLocalSchedule } from "@/lib/calendar/scheduling";
export function calendarQueryRange(view: CalendarView, day: string): { fromDay: string; toDay: string } { const days = calendarDays(view, day); return { fromDay: days[0], toDay: addCalendarDays(days[days.length - 1], 1) }; }
export function calendarQueryCurrent(key: string, data: { key: string; result: CalendarPage } | undefined, error?: unknown): CalendarPage | undefined { const status = (error as { status?: number } | null)?.status; return data?.key === key && status !== 401 && status !== 403 && status !== 404 ? data.result : undefined; }
export function readCalendarKinds(value: string | null): CalendarKind[] { return value === null ? [...CALENDAR_KINDS] : CALENDAR_KINDS.filter(kind => value.split(",").includes(kind)); }
export function calendarFailure(error: unknown): string {
  const { status, code } = (error ?? {}) as { status?: number; code?: string };
  if (status === 401) return "Your session expired. Sign in again to load your calendar.";
  if (status === 403) return "You no longer have access to this calendar item. Open its source to review your access.";
  if (status === 404) return "This item is no longer available. Refresh the calendar to review the current work.";
  if (code === "time_conflict") return "You already have a showing during this time. Choose another start time or duration.";
  if (code === "closing_deadline_conflict") return "This closing deadline is tied to the file’s scheduled closing date. Open the transaction to review both dates.";
  if (code === "invalid_assignee") return "The person assigned to this action is no longer eligible. Open the contact to review the assignee.";
  if (code === "invalid_date") return "Choose a valid future date and time for this appointment or client action.";
  if (status === 409) return "The saved source changed. Review its current date before continuing.";
  if (code === "invalid_calendar" || code === "invalid_calendar_reschedule" || status === 400) return "This date or time could not be saved. Review the fields and try again.";
  return "The calendar could not be confirmed. Refresh the saved work and try again.";
}
export function calendarPartial(page: CalendarPage): boolean { return page.sources.some(source => source.status !== "available" || source.truncated); }
export function calendarSourceChanged(opening: CalendarItem, current: CalendarItem | null | undefined): boolean {
  if (current === null) return true;
  if (!current) return false;
  if (opening.reschedule && current.reschedule && sameCalendarTarget(opening,current) && Date.parse(current.reschedule.expectedUpdatedAt) < Date.parse(opening.reschedule.expectedUpdatedAt)) return false;
  return JSON.stringify(current.reschedule) !== JSON.stringify(opening.reschedule) || current.startsAt !== opening.startsAt || current.endsAt !== opening.endsAt || current.day !== opening.day;
}
export function sameCalendarTarget(a: CalendarItem, b: CalendarItem): boolean {
  if (!a.reschedule || !b.reschedule || a.reschedule.kind !== b.reschedule.kind || a.reschedule.sourceId !== b.reschedule.sourceId) return false;
  if (a.reschedule.kind === "next_action" && b.reschedule.kind === "next_action") return a.reschedule.actionId === b.reschedule.actionId;
  if (a.reschedule.kind === "transaction_deadline" && b.reschedule.kind === "transaction_deadline") return a.reschedule.deadlineId === b.reschedule.deadlineId;
  return true;
}
export interface CalendarDateDraft { day: string; time: string; duration: string }
export function calendarDateDraft(item: CalendarItem): CalendarDateDraft {
  const time = item.startsAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(new Date(item.startsAt)) : "09:00";
  return { day: item.day, time, duration: item.startsAt && item.endsAt ? String(Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000)) : "45" };
}
export function calendarRescheduleValue(opening: CalendarItem, draft: CalendarDateDraft): { ok: true; input: Omit<CalendarRescheduleInput, "requestId">; ambiguous: boolean } | { ok: false; message: string } {
  if (!opening.reschedule || !isCalendarDay(draft.day)) return { ok: false, message: "Choose a valid calendar date." };
  if (opening.reschedule.kind === "transaction_deadline") return { ok: true, input: { source: opening.reschedule, dueDate: draft.day }, ambiguous: false };
  const local = calendarLocalSchedule(draft.day, draft.time, opening.startsAt ?? undefined);
  if (!local.ok) return { ok: false, message: local.reason === "nonexistent_time" ? "This time does not exist in New York because clocks move forward. Choose another time." : "Choose a valid New York date and time." };
  if (opening.reschedule.kind === "showing") { const minutes = Number(draft.duration); if (!/^\d+$/.test(draft.duration) || minutes < 15 || minutes > 240) return { ok: false, message: "Showing duration must be 15–240 minutes." }; return { ok: true, input: { source: opening.reschedule, startsAt: local.startsAt, endsAt: new Date(Date.parse(local.startsAt) + minutes * 60_000).toISOString() }, ambiguous: local.ambiguous }; }
  return { ok: true, input: { source: opening.reschedule, startsAt: local.startsAt }, ambiguous: local.ambiguous };
}
export function calendarWriteUncertain(error: unknown): boolean { const status = (error as { status?: number } | null)?.status; return status === undefined || status >= 500; }
export function calendarReceiptRecoverable(item: CalendarItem): boolean { return item.reschedule?.kind === "showing" || item.reschedule?.kind === "transaction_deadline"; }
export function freezeCalendarReschedule(input: Omit<CalendarRescheduleInput, "requestId">, makeId: () => string = () => crypto.randomUUID()): CalendarRescheduleInput { return Object.freeze({ ...input, source: Object.freeze({ ...input.source }), requestId: makeId() }); }
export function calendarSaveAllowed(state: { busy: boolean; retry: boolean; recovering: boolean; hasAttempt: boolean; writable: boolean; stale: boolean; blocked: boolean; uncertain: boolean; hasFresh: boolean; dirty: boolean }): boolean { if (state.busy) return false; if (state.retry) return state.recovering && state.hasAttempt; return state.writable && !state.stale && !state.blocked && !state.uncertain && !state.hasFresh && state.dirty; }

export function calendarStatusLabel(status: string): string { const text = status.replaceAll("_", " "); return text ? text[0].toUpperCase() + text.slice(1) : "Recorded"; }

export function calendarReviewQueries(item: CalendarItem, proposedDay?: string): { fromDay: string; toDay: string; kinds: CalendarKind[] }[] { return [...new Set([item.day, ...(proposedDay && isCalendarDay(proposedDay) ? [proposedDay] : [])])].map(day => ({fromDay:day,toDay:addCalendarDays(day,1),kinds:[item.kind]})); }
export function calendarReviewedItem(item: CalendarItem, pages: CalendarPage[]): CalendarItem | null {
  const matches = pages.filter(page=>page.sources.some(source=>source.kind===item.kind&&source.status==="available")).sort((a,b)=>Date.parse(b.generatedAt)-Date.parse(a.generatedAt)).flatMap(page=>page.items.filter(value=>value.id===item.id));
  if(matches.length)return matches[0];
  if(pages.some(page=>!page.sources.some(source=>source.kind===item.kind&&source.status==="available"&&!source.truncated)))throw Error("The saved source could not be fully reviewed");
  return null;
}
