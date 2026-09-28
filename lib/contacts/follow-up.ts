/**
 * The follow-up rule: what a stored follow-up means, and how it may change.
 *
 * One module, because "is this follow-up due?" was being answered in four
 * places (Home's SQL, the sample metrics, the Leads column, the drawer) and
 * three of them agreed by luck. Home, the Leads list and the contact drawer
 * all classify through `followUpStatus`, and Home's SQL bounds itself with
 * `followUpDueBy`, which is the same boundary written as an instant. No
 * component compares dates itself.
 *
 * A follow-up is a DAY someone chose ("call Jane Friday"), not an instant. It
 * is stored in `contacts.next_follow_up_at` at noon UTC on that day — the
 * convention the AI action already used — which is the same calendar day in
 * every US timezone, so the column can stay a timestamp with no migration.
 * "Today", "overdue" and "future" are then judged against the BUSINESS day
 * (`business-day.ts`), never the UTC day and never the reader's clock.
 *
 * It is also a reminder, not an interaction. Nothing here touches last
 * contact; `noRecentTouch` (the 14-day heuristic) reads only last contact and
 * is deliberately unaffected by what is scheduled.
 *
 * Pure and dependency-light, so tests can pin `now` on either side of a
 * midnight and of a daylight-saving change.
 */
import {
  businessDayKey,
  dayDiff,
  isCalendarDay,
  startOfNextBusinessDay,
} from "../metrics/business-day.ts";

export type FollowUpState = "none" | "overdue" | "due_today" | "future";

export interface FollowUpStatus {
  state: FollowUpState;
  /** `YYYY-MM-DD` in the business timezone; null when none is set. */
  day: string | null;
  /** Negative when overdue, 0 today, positive when ahead. Null when none. */
  daysAway: number | null;
}

/**
 * Classify a stored follow-up against the business day of `now`.
 *
 * The stored instant is reduced to its business day first, then compared as
 * two calendar days — so the answer is a count of days, never an artefact of
 * the hour it is asked.
 */
export function followUpStatus(nextFollowUpDate: string | Date | null | undefined, now = new Date()): FollowUpStatus {
  if (!nextFollowUpDate) return { state: "none", day: null, daysAway: null };
  const day = businessDayKey(new Date(nextFollowUpDate));
  const daysAway = dayDiff(day, businessDayKey(now));
  const state: FollowUpState = daysAway < 0 ? "overdue" : daysAway === 0 ? "due_today" : "future";
  return { state, day, daysAway };
}

/** Due today or overdue: what Home's Needs attention queue chases. */
export function isFollowUpDue(status: FollowUpStatus): boolean {
  return status.state === "overdue" || status.state === "due_today";
}

/**
 * The last instant that still counts as due.
 *
 * `next_follow_up_at <= followUpDueBy(now)` is `followUpStatus` said in SQL:
 * a follow-up is due exactly when its business day is today or earlier.
 */
export function followUpDueBy(now: Date): Date {
  return new Date(startOfNextBusinessDay(now).getTime() - 1);
}

/** The instant a picked day is stored at: noon UTC, the same day everywhere in the US. */
export function followUpInstant(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/** How far ahead a follow-up may be scheduled. Two years, as the AI action allows. */
export const MAX_FOLLOW_UP_DAYS = 730;

export type FollowUpDayRejection = "invalid" | "in_the_past" | "too_far_ahead";

/**
 * Whether a picked day may be scheduled.
 *
 * A past day is refused rather than silently moved: it would arrive already
 * overdue, which is never what "schedule a follow-up" meant.
 */
export function checkFollowUpDay(day: string, now: Date): { ok: true } | { ok: false; reason: FollowUpDayRejection } {
  if (!isCalendarDay(day)) return { ok: false, reason: "invalid" };
  const ahead = dayDiff(day, businessDayKey(now));
  if (ahead < 0) return { ok: false, reason: "in_the_past" };
  if (ahead > MAX_FOLLOW_UP_DAYS) return { ok: false, reason: "too_far_ahead" };
  return { ok: true };
}

/** What a change did. `kept` means nothing about the follow-up changed. */
export type FollowUpOutcome = "scheduled" | "rescheduled" | "completed" | "kept";

/**
 * Decide the follow-up that results from a request. The one place the
 * schedule / reschedule / complete / keep rule lives — the direct control and
 * "log a touch" both call it, so the two can never disagree.
 *
 *   - a day wins over completion (complete this one and schedule the next);
 *   - the same day as today's is "kept", not a rewrite and not a history line;
 *   - completing with nothing set is "kept": there was nothing to complete;
 *   - asking for nothing keeps what is there.
 */
export function decideFollowUp(
  current: Date | null,
  want: { day?: string | null; complete?: boolean }
): { value: Date | null; outcome: FollowUpOutcome } {
  if (want.day) {
    const currentDay = current ? businessDayKey(current) : null;
    if (currentDay === want.day) return { value: current, outcome: "kept" };
    return { value: new Date(followUpInstant(want.day)), outcome: current ? "rescheduled" : "scheduled" };
  }
  if (want.complete && current) return { value: null, outcome: "completed" };
  return { value: current, outcome: "kept" };
}

// --- The 14-day heuristic: a separate question ----------------------------------------

/** A lead untouched for longer than this is flagged — a heuristic, not a reminder. */
export const NO_TOUCH_AFTER_DAYS = 14;
export const NO_TOUCH_LABEL = `No touch in ${NO_TOUCH_AFTER_DAYS} days`;

/**
 * Time since the last real touch. Reads `lastContactDate` and nothing else:
 * scheduling a follow-up neither resets nor extends this clock.
 */
export function noRecentTouch(lastContactDate: string, now = new Date()): boolean {
  const days = (now.getTime() - new Date(lastContactDate).getTime()) / 86400000;
  return days > NO_TOUCH_AFTER_DAYS;
}

// --- Words ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 26, 2026" from a `YYYY-MM-DD` day, with no timezone arithmetic. */
export function formatFollowUpDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The words for a stored follow-up. `withDate` is for the drawer, where there
 * is room to say both "Due today" and which day that is.
 */
export function followUpLabel(status: FollowUpStatus, options: { withDate?: boolean } = {}): string {
  switch (status.state) {
    case "none":
      return "None set";
    case "overdue":
      return `Overdue · ${formatFollowUpDay(status.day!)}`;
    case "due_today":
      return options.withDate ? `Due today · ${formatFollowUpDay(status.day!)}` : "Due today";
    case "future":
      return formatFollowUpDay(status.day!);
  }
}
