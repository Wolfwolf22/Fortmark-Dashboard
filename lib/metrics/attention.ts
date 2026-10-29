/** Shared queue ordering and wording for timed actions and calendar deadlines. */
import type { AttentionItem } from "./types.ts";
import type { NextAction } from "../contacts/next-action.ts";
import { NEXT_ACTION_KIND_LABELS, nextActionStatus } from "../contacts/next-action.ts";

export function attentionIsOverdue(item: Pick<AttentionItem, "daysAway" | "overdue">): boolean {
  return item.overdue ?? item.daysAway < 0;
}

export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  return Number(attentionIsOverdue(b)) - Number(attentionIsOverdue(a))
    || a.daysAway - b.daysAway
    || (a.dueAt ?? `${a.dueDate}T23:59:59.999Z`).localeCompare(b.dueAt ?? `${b.dueDate}T23:59:59.999Z`)
    || a.subject.localeCompare(b.subject)
    || a.id.localeCompare(b.id);
}

export function nextActionAttentionFields(action: NextAction, now: Date): Pick<AttentionItem, "label" | "actionKind" | "purpose" | "assigneeName" | "dueAt" | "overdue"> {
  return {
    label: NEXT_ACTION_KIND_LABELS[action.kind], actionKind: action.kind,
    purpose: action.purpose, dueAt: action.dueAt,
    assigneeName: action.assigneeName ?? "Unnamed team member",
    overdue: nextActionStatus(action, now).state === "overdue",
  };
}

export function attentionHint(item: Pick<AttentionItem, "daysAway" | "overdue">): string {
  if (attentionIsOverdue(item) && item.daysAway === 0) return "overdue today";
  if (item.daysAway < 0) return item.daysAway === -1 ? "1 day overdue" : `${Math.abs(item.daysAway)} days overdue`;
  if (item.daysAway === 0) return "due today";
  return item.daysAway === 1 ? "due tomorrow" : `due in ${item.daysAway}d`;
}
