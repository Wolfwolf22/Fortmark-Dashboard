/** One pending contact action. Pure contracts shared by server, UI and preview. */
import { z } from "zod";
import { BUSINESS_TIME_ZONE, businessDayKey, dayDiff, isCalendarDay } from "../metrics/business-day.ts";

export const NEXT_ACTION_KINDS = ["call", "email", "text", "meeting", "custom"] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];
export const NEXT_ACTION_KIND_LABELS: Record<NextActionKind, string> = { call: "Call", email: "Email", text: "Text", meeting: "Meeting", custom: "Custom" };
export interface NextAction { id: string; kind: NextActionKind; purpose: string; dueAt: string; assigneeId: string; assigneeName?: string }
export interface NextActionDraft { kind: NextActionKind; purpose: string; dueAt: string; assigneeId: string }
const text = (limit: number) => z.string().trim().min(1).max(limit).refine(value => !value.includes("\0"), "Unsupported character");
const dueAtValue = z.string().datetime({ offset: true });
export const nextActionDraftSchema = z.object({ kind: z.enum(NEXT_ACTION_KINDS), purpose: text(240), dueAt: dueAtValue, assigneeId: z.string().uuid() }).strict();
const revision = z.string().datetime({ offset: true });
export const nextActionMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), expectedUpdatedAt: revision, expectedActionId: z.string().uuid().nullable(), next: nextActionDraftSchema }).strict(),
  z.object({ action: z.literal("complete"), expectedUpdatedAt: revision, actionId: z.string().uuid(), outcome: text(1000), next: nextActionDraftSchema.optional() }).strict(),
  z.object({ action: z.literal("cancel"), expectedUpdatedAt: revision, actionId: z.string().uuid(), reason: text(500) }).strict(),
]);
export type NextActionMutation = z.infer<typeof nextActionMutationSchema>;
export type NextActionInput = NextActionMutation;
export const nextActionInputSchema = nextActionMutationSchema;

export function nextActionDayMirror(dueAt: string): string { return `${businessDayKey(new Date(dueAt))}T12:00:00.000Z`; }
/** New or changed times must be future and within 730 business-calendar days. */
export function checkNextActionDueAt(dueAt: string, now = new Date(), currentDueAt?: string | null): { ok: true } | { ok: false; reason: "invalid" | "in_the_past" | "too_far_ahead" } {
  const instant = Date.parse(dueAt);
  if (!dueAtValue.safeParse(dueAt).success || !Number.isFinite(instant)) return { ok: false, reason: "invalid" };
  if (instant < now.getTime()) return currentDueAt && Date.parse(currentDueAt) === instant ? { ok: true } : { ok: false, reason: "in_the_past" };
  if (dayDiff(businessDayKey(new Date(instant)), businessDayKey(now)) > 730) return { ok: false, reason: "too_far_ahead" };
  return { ok: true };
}
export function nextActionLocalParts(dueAt: string): { day: string; time: string } {
  const at = new Date(dueAt);
  return { day: businessDayKey(at), time: new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(at) };
}
export function formatNextActionDueAt(dueAt: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(dueAt));
}
export interface NextActionStatus { state: "none" | "overdue" | "due_today" | "future"; day: string | null; daysAway: number | null }
export function nextActionStatus(action: Pick<NextAction, "dueAt"> | null | undefined, now = new Date()): NextActionStatus {
  if (!action || !Number.isFinite(Date.parse(action.dueAt))) return { state: "none", day: null, daysAway: null };
  const at = new Date(action.dueAt), day = businessDayKey(at), daysAway = dayDiff(day, businessDayKey(now));
  return { state: at < now ? "overdue" : daysAway === 0 ? "due_today" : "future", day, daysAway };
}

/** Reject spring-forward gaps; a repeated fall-back time uses its EARLIER instant. */
export function businessLocalToUtc(day: string, time: string): { ok: true; dueAt: string; ambiguous: boolean } | { ok: false; reason: "invalid" | "nonexistent_time" } {
  if (!isCalendarDay(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, reason: "invalid" };
  const naive = Date.parse(`${day}T${time}:00.000Z`);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const instant = naive + delta * 3_600_000;
    const local = nextActionLocalParts(new Date(instant).toISOString());
    offsets.add(Date.parse(`${local.day}T${local.time}:00.000Z`) - instant);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(instant => {
    const local = nextActionLocalParts(new Date(instant).toISOString());
    return local.day === day && local.time === time;
  }).sort((a, b) => a - b);
  return candidates.length ? { ok: true, dueAt: new Date(candidates[0]).toISOString(), ambiguous: candidates.length > 1 } : { ok: false, reason: "nonexistent_time" };
}

export type NextActionEvent = "next_action_created" | "next_action_edited" | "next_action_rescheduled" | "next_action_completed" | "next_action_cancelled";
export function nextActionSetEvent(current: NextAction | null | undefined, next: NextActionDraft): NextActionEvent | null {
  if (!current) return "next_action_created";
  if (Date.parse(current.dueAt) !== Date.parse(next.dueAt)) return "next_action_rescheduled";
  return current.kind !== next.kind || current.purpose !== next.purpose || current.assigneeId !== next.assigneeId ? "next_action_edited" : null;
}
