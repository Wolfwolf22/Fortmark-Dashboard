import "server-only";

/**
 * Contact aggregates.
 *
 * Same discipline as the transaction aggregates: the visibility predicate and
 * the stage sets are imported, never restated, so a count can never include a
 * row the caller could not have opened and "active client" can never mean two
 * things on two screens.
 *
 * Follow-up duty is a stored intention — `next_follow_up_at` — not a guess
 * derived from silence. "Nobody has called this person in a fortnight" is a
 * different, defensible metric, and when the brokerage decides it wants that
 * rule it gets its own name rather than being smuggled in here.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { contactActivities, contacts } from "../db/schema.ts";
import type { Actor } from "../auth/actor.ts";
import { visibleTo } from "./service.ts";
import { displayName } from "./domain.ts";
import {
  ACTIVE_CLIENT_STAGES,
  ALL_CONTACT_STAGES,
  LIFECYCLE_STAGES,
  OPEN_PIPELINE_STAGES,
  type ContactStage,
} from "./stages.ts";
import type { ActivityItem, AttentionItem, ContactMetrics } from "../metrics/types.ts";
import type { LeadSource } from "../data/types.ts";
import { dayKey, daysUntil, monthWindow, toInt } from "../metrics/window.ts";

export interface Ctx {
  actor: Actor;
  db: Db;
}

const ACTIVE_CLIENTS = ACTIVE_CLIENT_STAGES as readonly ContactStage[] as ContactStage[];
const OPEN_PIPELINE = OPEN_PIPELINE_STAGES as readonly ContactStage[] as ContactStage[];

/** The instant the current calendar month began, UTC. */
function monthStartInstant(now: Date): Date {
  return new Date(`${monthWindow(now).start}T00:00:00.000Z`);
}

/** The last instant of today, UTC — a follow-up due today is due, not late. */
function endOfToday(now: Date): Date {
  return new Date(`${dayKey(now)}T23:59:59.999Z`);
}

/**
 * The stage predicates use `${inArray(...)}` rather than `= any(${...})` for
 * the reason documented in `lib/transactions/metrics.ts`: `stage` is a
 * Postgres enum, an interpolated array binds as `text[]`, and the comparison
 * is rejected outright — taking the whole aggregate down with it.
 */
export async function contactMetrics(ctx: Ctx, now: Date): Promise<ContactMetrics> {
  const monthStart = monthStartInstant(now);
  const dueBy = endOfToday(now);

  const [agg, byStage, bySource] = await Promise.all([
    ctx.db
      .select({
        activeClients: sql<number>`count(*) filter (where ${inArray(contacts.stage, ACTIVE_CLIENTS as ContactStage[])})`,
        newThisMonth: sql<number>`count(*) filter (where ${contacts.createdAt} >= ${monthStart})`,
        followUpsDue: sql<number>`count(*) filter (where ${contacts.nextFollowUpAt} is not null and ${contacts.nextFollowUpAt} <= ${dueBy} and ${inArray(contacts.stage, OPEN_PIPELINE as ContactStage[])})`,
      })
      .from(contacts)
      .where(visibleTo(ctx.actor)),
    ctx.db
      .select({ stage: contacts.stage, n: sql<number>`count(*)` })
      .from(contacts)
      .where(visibleTo(ctx.actor))
      .groupBy(contacts.stage),
    ctx.db
      .select({ source: contacts.source, n: sql<number>`count(*)` })
      .from(contacts)
      .where(and(visibleTo(ctx.actor), sql`${contacts.createdAt} >= ${monthStart}`))
      .groupBy(contacts.source),
  ]);

  const counts = new Map(byStage.map((row) => [row.stage as ContactStage, toInt(row.n)]));
  return {
    activeClients: toInt(agg[0]?.activeClients),
    newLeadsThisMonth: toInt(agg[0]?.newThisMonth),
    followUpsDue: toInt(agg[0]?.followUpsDue),
    // Every lifecycle stage, including the empty ones: the shape of the
    // pipeline is the point, and a missing column reads as a missing stage.
    lifecycle: LIFECYCLE_STAGES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
    newLeadsBySource: bySource
      .map((row) => ({ source: row.source as LeadSource, count: toInt(row.n) }))
      .sort((a, b) => b.count - a.count),
  };
}

/** `/leads?open=<id>` — the deep link the leads table already uses. */
function contactHref(id: string): string {
  return `/leads?open=${encodeURIComponent(id)}`;
}

/**
 * Follow-ups that are due.
 *
 * A stored `next_follow_up_at` at or before the end of today, on a contact
 * still in the open pipeline. Nothing is inferred: a contact with no
 * follow-up date owes nothing, and a lost or archived person is not chased.
 */
export async function contactAttention(ctx: Ctx, now: Date): Promise<AttentionItem[]> {
  const dueBy = endOfToday(now);
  const rows = await ctx.db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      preferredName: contacts.preferredName,
      nextFollowUpAt: contacts.nextFollowUpAt,
    })
    .from(contacts)
    .where(
      and(
        visibleTo(ctx.actor),
        inArray(contacts.stage, OPEN_PIPELINE),
        sql`${contacts.nextFollowUpAt} is not null and ${contacts.nextFollowUpAt} <= ${dueBy}`
      )
    )
    .orderBy(contacts.nextFollowUpAt)
    .limit(50);

  return rows.map((row) => {
    const day = dayKey(row.nextFollowUpAt as Date);
    return {
      id: `follow-up:${row.id}`,
      kind: "follow_up_due" as const,
      label: "Follow up",
      subject: displayName(row),
      dueDate: day,
      daysAway: daysUntil(day, now),
      href: contactHref(row.id),
    };
  });
}

/** How a stored activity reads on the screen. The summary is the person's own
 *  words for a logged touch, and a phrase we control for a system event. */
function describeActivity(
  kind: string,
  summary: string,
  name: string
): { kind: ActivityItem["kind"]; summary: string } {
  if (kind === "system") return { kind: "contact_created", summary: `${name} added` };
  if (kind === "status_change") return { kind: "contact_stage_changed", summary };
  return { kind: "contact_touch", summary };
}

export async function contactActivity(ctx: Ctx, limit: number): Promise<ActivityItem[]> {
  const rows = await ctx.db
    .select({
      id: contactActivities.id,
      kind: contactActivities.kind,
      summary: contactActivities.summary,
      occurredAt: contactActivities.occurredAt,
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      preferredName: contacts.preferredName,
    })
    .from(contactActivities)
    .innerJoin(contacts, eq(contactActivities.contactId, contacts.id))
    .where(visibleTo(ctx.actor))
    .orderBy(desc(contactActivities.occurredAt))
    .limit(limit);

  return rows.map((row) => {
    const name = displayName(row);
    const described = describeActivity(row.kind, row.summary, name);
    return {
      id: `contact:${row.id}`,
      kind: described.kind,
      summary: described.summary,
      subject: name,
      at: row.occurredAt.toISOString(),
      href: contactHref(row.contactId),
    };
  });
}

export { ALL_CONTACT_STAGES };
