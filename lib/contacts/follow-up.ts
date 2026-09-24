/**
 * How a stored follow-up reads on the Leads screens.
 *
 * "Due" uses Home's rule exactly (`contactAttention`: `next_follow_up_at` on
 * or before the end of today, UTC), so a lead the list calls due is the lead
 * the Needs attention queue lists — the two can no longer disagree.
 *
 * The 14-day heuristic is separate and named for what it measures: time
 * since the last touch. It is not a reminder anyone set.
 *
 * Pure and dependency-free, so tests can pin `now`.
 */
import { dayKey, daysUntil } from "../metrics/window.ts";

export type FollowUpState = "none" | "overdue" | "due" | "scheduled";

export interface FollowUpStatus {
  state: FollowUpState;
  /** `YYYY-MM-DD`, the stored calendar day; null when none is set. */
  day: string | null;
  /** Negative when overdue, 0 today, positive when ahead. */
  daysAway: number | null;
}

export function followUpStatus(nextFollowUpDate: string | null | undefined, now = new Date()): FollowUpStatus {
  if (!nextFollowUpDate) return { state: "none", day: null, daysAway: null };
  const day = dayKey(new Date(nextFollowUpDate));
  const daysAway = daysUntil(day, now);
  const state: FollowUpState = daysAway < 0 ? "overdue" : daysAway === 0 ? "due" : "scheduled";
  return { state, day, daysAway };
}

/** Whether Home's Needs attention queue counts it (open pipeline aside). */
export function isFollowUpDue(status: FollowUpStatus): boolean {
  return status.state === "overdue" || status.state === "due";
}

/** A lead untouched for longer than this is flagged — a heuristic, not a reminder. */
export const NO_TOUCH_AFTER_DAYS = 14;
export const NO_TOUCH_LABEL = `No touch in ${NO_TOUCH_AFTER_DAYS} days`;

export function noRecentTouch(lastContactDate: string, now = new Date()): boolean {
  const days = (now.getTime() - new Date(lastContactDate).getTime()) / 86400000;
  return days > NO_TOUCH_AFTER_DAYS;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 26, 2026" from a `YYYY-MM-DD` day, with no timezone arithmetic. */
export function formatFollowUpDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The words the list and the drawer show for a stored follow-up. */
export function followUpLabel(status: FollowUpStatus): string {
  switch (status.state) {
    case "none":
      return "None set";
    case "overdue":
      return `Overdue · ${formatFollowUpDay(status.day!)}`;
    case "due":
      return "Due today";
    case "scheduled":
      return formatFollowUpDay(status.day!);
  }
}
