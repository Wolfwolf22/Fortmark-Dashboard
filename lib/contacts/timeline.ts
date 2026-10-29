/**
 * A contact's timeline, in the domain's own words.
 *
 * The drawer shows what happened with a person — a call, a stage change, a
 * follow-up set, a reassignment — not database rows. Activities are the record
 * of interactions and stage moves; the follow-up events come from the audit
 * trail because a reminder is deliberately NOT an activity (it is not a touch,
 * and writing one would put a phantom interaction in the history). Only the
 * business fact leaves this function: a headline, an optional line of detail, a
 * time, and — when known — who did it. No audit id, no metadata blob, no event
 * type.
 *
 * Pure: the caller fetches, this translates. Isomorphic, so it is testable
 * without a database.
 */
import { CONTACT_STAGE_LABELS, isContactStage } from "./stages.ts";
import { formatFollowUpDay } from "./follow-up.ts";
import { compareHistory } from "./history.ts";
import { formatNextActionDueAt, NEXT_ACTION_KIND_LABELS, NEXT_ACTION_KINDS, type NextActionKind } from "./next-action.ts";

export type TimelineType =
  | "call"
  | "email"
  | "text"
  | "meeting"
  | "showing"
  | "note"
  | "task"
  | "stage"
  | "follow_up_scheduled"
  | "follow_up_completed"
  | "assignment"
  | "need"
  | "transaction"
  | "contacted"
  | "created";

export interface TimelineItem {
  id: string;
  type: TimelineType;
  /** "Called client", "Stage changed to Qualified". */
  title: string;
  /** What the person wrote, when they wrote something. */
  detail?: string;
  at: string; // ISO
  by?: string;
}

export interface ActivityInput {
  id: string;
  kind: string;
  summary: string;
  occurredAt: Date;
  actorUserId: string | null;
  safeMetadata: Record<string, unknown> | null;
}

export interface FollowUpEventInput {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  safeMetadata: Record<string, unknown> | null;
}

/**
 * A business event recorded only in the audit trail: a note added or deleted, a
 * client need added or changed, a transaction linked. Only the event type and
 * its stated status word leave here — a note's text and a need's values are
 * not in the audit row to begin with, so they cannot reach a timeline.
 */
export interface DomainEventInput extends FollowUpEventInput {
  eventType: string;
}

const NEED_STATUS_TITLES: Record<string, string> = {
  active: "Client need reactivated",
  paused: "Client need paused",
  fulfilled: "Client need fulfilled",
  archived: "Client need archived",
};

function domainEventTitle(eventType: string, meta: Record<string, unknown>): { type: TimelineType; title: string } | null {
  switch (eventType) {
    case "contact_note_created":
      return { type: "note", title: "Added note" };
    case "contact_note_deleted":
      return { type: "note", title: "Deleted note" };
    case "contact_need_created":
      return { type: "need", title: "Client need added" };
    case "contact_need_updated":
      return { type: "need", title: "Client need updated" };
    case "contact_need_status_changed":
      return { type: "need", title: (typeof meta.to === "string" && NEED_STATUS_TITLES[meta.to]) || "Client need updated" };
    case "contact_transaction_linked":
      return { type: "transaction", title: "Transaction linked" };
    default:
      return null;
  }
}

/** Words a "Follow-up …" headline uses for each outcome. `kept` never reaches the timeline. */
function followUpTitle(outcome: unknown, day: unknown): { type: TimelineType; title: string } | null {
  const date = typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatFollowUpDay(day) : null;
  switch (outcome) {
    case "scheduled":
      return { type: "follow_up_scheduled", title: date ? `Follow-up scheduled for ${date}` : "Follow-up scheduled" };
    case "rescheduled":
      return { type: "follow_up_scheduled", title: date ? `Follow-up moved to ${date}` : "Follow-up rescheduled" };
    case "completed":
      return { type: "follow_up_completed", title: "Follow-up completed" };
    default:
      return null;
  }
}

const TOUCH_TITLES: Record<string, { type: TimelineType; title: string }> = {
  call: { type: "call", title: "Called client" },
  email: { type: "email", title: "Emailed client" },
  sms: { type: "text", title: "Texted client" },
  meeting: { type: "meeting", title: "Met with client" },
  showing: { type: "showing", title: "Showing" },
  note: { type: "note", title: "Internal note recorded" },
  task: { type: "task", title: "Task" },
};

// Within one instant a follow-up set during a touch is the newer fact.
const RANK_TOUCH = 0;
const RANK_FOLLOW_UP = 1;

type Ranked = TimelineItem & { rank: number };

export function toTimeline(input: {
  activities: readonly ActivityInput[];
  followUpEvents: readonly FollowUpEventInput[];
  domainEvents?: readonly DomainEventInput[];
  names: ReadonlyMap<string, string>;
  limit?: number;
}): TimelineItem[] {
  const items: Ranked[] = [];
  const nameOf = (id: string | null | undefined) => (id ? input.names.get(id) : undefined);

  for (const a of input.activities) {
    const meta = a.safeMetadata ?? {};
    const by = nameOf(a.actorUserId);
    const at = a.occurredAt.toISOString();

    const actionTitles: Record<string, string> = {
      next_action_created: "Next action scheduled", next_action_edited: "Next action updated",
      next_action_rescheduled: "Next action rescheduled", next_action_completed: "Next action completed",
      next_action_cancelled: "Next action cancelled",
    };
    if (a.kind === "task" && typeof meta.event === "string" && actionTitles[meta.event]) {
      const kind = typeof meta.kind === "string" && (NEXT_ACTION_KINDS as readonly string[]).includes(meta.kind) ? NEXT_ACTION_KIND_LABELS[meta.kind as NextActionKind] : "Task";
      const purpose = typeof meta.purpose === "string" ? meta.purpose : "";
      const due = typeof meta.dueAt === "string" && Number.isFinite(Date.parse(meta.dueAt)) ? formatNextActionDueAt(meta.dueAt) : "";
      const assignee = nameOf(typeof meta.assigneeId === "string" ? meta.assigneeId : null);
      const outcome = typeof meta.outcome === "string" ? `Outcome: ${meta.outcome}` : typeof meta.reason === "string" ? `Reason: ${meta.reason}` : "";
      const detail = [purpose ? `${kind}: ${purpose}` : kind, due, assignee ? `Assigned to ${assignee}` : "", outcome].filter(Boolean).join("\n");
      items.push({ id: a.id, type: "task", title: actionTitles[meta.event], detail, at, by, rank: RANK_TOUCH });
      continue;
    }

    if (a.kind === "status_change") {
      const to = meta.to;
      const title = isContactStage(to) ? `Stage changed to ${CONTACT_STAGE_LABELS[to]}` : "Stage changed";
      items.push({ id: a.id, type: "stage", title, at, by, rank: RANK_TOUCH });
      continue;
    }

    if (a.kind === "system") {
      if (meta.event === "reassigned") {
        const to = nameOf(typeof meta.toAgentUserId === "string" ? meta.toAgentUserId : null);
        items.push({ id: a.id, type: "assignment", title: to ? `Assigned to ${to}` : "Reassigned", at, by, rank: RANK_TOUCH });
      } else {
        items.push({ id: a.id, type: "created", title: "Contact added", at, by, rank: RANK_TOUCH });
      }
      continue;
    }

    const marked = meta.event === "contact_marked" || (a.kind === "note" && a.summary === "Marked contacted");
    const words = marked ? { type: "contacted" as const, title: "Marked contacted" } : TOUCH_TITLES[a.kind];
    if (!words) continue;
    items.push({
      id: a.id,
      type: words.type,
      title: words.title,
      // The generic quick-log line adds nothing over the headline.
      detail: a.summary && a.summary !== "Marked contacted" ? a.summary : undefined,
      at,
      by,
      rank: RANK_TOUCH,
    });

    // A touch that also set, moved or completed the reminder says so, as its own line.
    const follow = followUpTitle(meta.followUp, meta.followUpDay);
    if (follow) items.push({ id: `${a.id}:follow-up`, ...follow, at, by, rank: RANK_FOLLOW_UP });
  }

  for (const e of input.followUpEvents) {
    const meta = e.safeMetadata ?? {};
    const follow = followUpTitle(meta.followUp, meta.day);
    if (!follow) continue;
    items.push({ id: e.id, ...follow, at: e.createdAt.toISOString(), by: nameOf(e.actorUserId), rank: RANK_FOLLOW_UP });
  }

  for (const e of input.domainEvents ?? []) {
    const words = domainEventTitle(e.eventType, e.safeMetadata ?? {});
    if (!words) continue;
    items.push({ id: e.id, ...words, at: e.createdAt.toISOString(), by: nameOf(e.actorUserId), rank: RANK_FOLLOW_UP });
  }

  items.sort((x, y) => compareHistory(x, y));
  return items.slice(0, input.limit ?? 100).map((entry) => {
    const { rank, ...rest } = entry;
    void rank;
    // No `undefined` keys: the shape that leaves here is exactly what it says.
    return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as unknown as TimelineItem;
  });
}
