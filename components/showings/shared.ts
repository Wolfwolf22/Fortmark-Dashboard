import { businessDayKey, businessDayStart, isCalendarDay } from "@/lib/metrics/business-day";
import { businessLocalToUtc, nextActionLocalParts } from "@/lib/contacts/next-action";
import { checkShowingSchedule } from "@/lib/showings/domain";

export interface ShowingScheduleDraft { day: string; time: string; duration: string; meetingDetails: string; notes: string }
export function addShowingDays(day: string, amount: number): string { return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10); }
export function defaultShowingSchedule(now = new Date()): ShowingScheduleDraft {
  const at = new Date(Math.ceil((now.getTime() + 3_600_000) / 900_000) * 900_000), local = nextActionLocalParts(at.toISOString());
  return { ...local, duration: "60", meetingDetails: "", notes: "" };
}
export function showingScheduleDraft(showing: { startsAt: string; endsAt: string; meetingDetails: string; notes: string }): ShowingScheduleDraft {
  return { ...nextActionLocalParts(showing.startsAt), duration: String(Math.round((Date.parse(showing.endsAt) - Date.parse(showing.startsAt)) / 60_000)), meetingDetails: showing.meetingDetails, notes: showing.notes };
}
export function showingScheduleValue(draft: ShowingScheduleDraft, originalStartsAt?: string): { ok: true; value: { startsAt: string; endsAt: string; meetingDetails: string; notes: string }; ambiguous: boolean; preservedExistingTime: boolean } | { ok: false; message: string; field: "day" | "duration" | "meetingDetails" | "notes" } {
  const converted = businessLocalToUtc(draft.day, draft.time);
  if (!converted.ok) return { ok: false, field: "day", message: converted.reason === "nonexistent_time" ? "This local time does not exist because the clocks move forward. Choose another time." : "Choose a valid date and time in New York time." };
  const duration = Number(draft.duration);
  if (!/^\d+$/.test(draft.duration) || duration < 15 || duration > 240) return { ok: false, field: "duration", message: "Choose a duration from 15 to 240 minutes." };
  if (draft.meetingDetails.length > 1000 || draft.meetingDetails.includes("\0")) return { ok: false, field: "meetingDetails", message: "Use no more than 1,000 characters of plain text for meeting details." };
  if (draft.notes.length > 2000 || draft.notes.includes("\0")) return { ok: false, field: "notes", message: "Use no more than 2,000 characters of plain text for private notes." };
  const original = originalStartsAt ? nextActionLocalParts(originalStartsAt) : null;
  const preservedExistingTime = Boolean(original && original.day === draft.day && original.time === draft.time);
  const startsAt = preservedExistingTime ? originalStartsAt! : converted.dueAt;
  return { ok: true, value: { startsAt, endsAt: new Date(Date.parse(startsAt) + duration * 60_000).toISOString(), meetingDetails: draft.meetingDetails, notes: draft.notes }, ambiguous: converted.ambiguous, preservedExistingTime };
}
export interface ShowingWriteAttempt<T> { key: string; input: T & { requestId: string } }
export function showingWriteAttempt<T extends object>(previous: ShowingWriteAttempt<T> | null, payload: T, makeId: () => string = () => crypto.randomUUID()): ShowingWriteAttempt<T> { const key = JSON.stringify(payload); return previous?.key === key ? previous : { key, input: { ...payload, requestId: makeId() } }; }
/** A sent, identical request may already have committed before its time passed. */
export function canSubmitShowingSchedule<T extends object>(schedule: { startsAt: string; endsAt: string }, payload: T, sent: ShowingWriteAttempt<T> | null, now = new Date(), unchanged?: { startsAt: string; endsAt: string }): boolean { return sent?.key === JSON.stringify(payload) || checkShowingSchedule(schedule, now, unchanged); }
export type AgendaView = "day" | "week" | "upcoming";
export function showingAgendaRange(view: AgendaView, day: string, now = new Date()): { from: string; to: string } {
  const safeDay = isCalendarDay(day) ? day : businessDayKey(now);
  return { from: businessDayStart(safeDay).toISOString(), to: businessDayStart(addShowingDays(safeDay, view === "day" ? 1 : view === "week" ? 7 : 30)).toISOString() };
}
export function showingsHref({ showingId, contactId }: { showingId?: string | null; contactId?: string | null } = {}): string { const params = new URLSearchParams(); if (contactId) params.set("contact", contactId); if (showingId) params.set("showing", showingId); return `/showings${params.size ? `?${params}` : ""}`; }
export function formatShowingTime(value: string): string { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value)); }
export function showingFailure(error: unknown, operation: "read" | "create" | "update" = "read"): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : null, code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "sample_read_only") return "Showings need the contact database connection. Sample contact mode does not store private showing plans.";
  if (code === "time_conflict") return "You already have a showing during this time. Choose another start time or duration.";
  if (status === 401) return "Sign in again to use your showing agenda. Your draft is kept.";
  if (status === 403) return "You do not have permission to change this showing. Your draft is kept.";
  if (status === 404) return "This showing, contact or saved property is no longer available. Your draft is kept; refresh before continuing.";
  if (status === 409) return code === "request_conflict" ? "This request could not be retried with changed details. Your draft is kept. Review the current showing before continuing." : "This showing or saved review changed. Your draft is kept. Review the current version before continuing.";
  if (status === 400) return "Check the contact, dates and text limits before saving. Your draft is kept.";
  return operation === "read" ? "The showing agenda could not be refreshed. Loaded information is kept. Try again." : "The save did not return a result. Your draft is kept. Retrying the same details uses the same request to avoid saving twice.";
}
