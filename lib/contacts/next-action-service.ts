import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { auditEvents, contactActivities, contacts, dashboardUsers, type ContactRow } from "../db/schema.ts";
import { loadContact } from "./access.ts";
import { agentNames, getContact, type Ctx, type ServiceResult } from "./service.ts";
import { visibleTo } from "./visibility.ts";
import { contactRevision, nextContactUpdatedAt, revisionMatches } from "./reliability.ts";
import { OPEN_PIPELINE_STAGES } from "./stages.ts";
import { checkNextActionDueAt, nextActionDayMirror, nextActionInputSchema, nextActionSetEvent, type NextAction, type NextActionEvent, type NextActionKind } from "./next-action.ts";

/** Assignment never grants access: only the owner or an existing admin reader. */
function eligibleAssignee(id: string) {
  return sql`exists (select 1 from ${dashboardUsers} where ${dashboardUsers.id} = ${id}::uuid
    and ${dashboardUsers.status} = 'active' and ${dashboardUsers.role} <> 'member'
    and (${dashboardUsers.id} = ${contacts.assignedAgentUserId} or ${dashboardUsers.role} = 'admin') for share)`;
}
export async function listNextActionAssignees(ctx: Ctx, id: string): Promise<ServiceResult<{ id: string; name: string }[]>> {
  const access = await loadContact(ctx, id);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const users = await ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(and(
    eq(dashboardUsers.status, "active"), sql`${dashboardUsers.role} <> 'member'`,
    or(eq(dashboardUsers.id, access.row.assignedAgentUserId), eq(dashboardUsers.role, "admin"))));
  const names = await agentNames(ctx.db, users.map(user => user.id));
  if (ctx.viewerName && users.some(user => user.id === ctx.actor.userId) && !names.has(ctx.actor.userId)) {
    const own = (await ctx.viewerName().catch(() => null))?.trim(); if (own) names.set(ctx.actor.userId, own);
  }
  return { ok: true, value: users.map(user => ({ id: user.id, name: names.get(user.id) ?? "Unnamed agent" })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}
function actionFromRow(row: ContactRow): NextAction | null {
  return row.nextActionId ? { id: row.nextActionId, kind: row.nextActionKind as NextActionKind, purpose: row.nextActionPurpose!, dueAt: row.nextActionDueAt!.toISOString(), assigneeId: row.nextActionAssignedUserId! } : null;
}
/** Account eligibility can change without changing the contact's public token. */
async function failedCasReason(ctx: Ctx, id: string, expectedUpdatedAt: string, expectedId: string | null, assigneeId?: string): Promise<"conflict" | "invalid_assignee"> {
  if (!assigneeId) return "conflict";
  const [latest] = await ctx.db.select().from(contacts).where(and(eq(contacts.id, id), visibleTo(ctx.actor))).limit(1);
  if (!latest || !revisionMatches(latest.updatedAt, expectedUpdatedAt) || latest.nextActionId !== expectedId) return "conflict";
  const [eligible] = await ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(and(
    eq(dashboardUsers.id, assigneeId), eq(dashboardUsers.status, "active"), sql`${dashboardUsers.role} <> 'member'`,
    or(eq(dashboardUsers.id, latest.assignedAgentUserId), eq(dashboardUsers.role, "admin")))).limit(1);
  return eligible ? "conflict" : "invalid_assignee";
}
type HistoryEvent = { event: NextActionEvent; action: NextAction; outcome?: string; reason?: string };
const SUMMARIES: Record<NextActionEvent, string> = { next_action_created: "Next action scheduled", next_action_edited: "Next action updated", next_action_rescheduled: "Next action rescheduled", next_action_completed: "Next action completed", next_action_cancelled: "Next action cancelled" };

/** Compare-and-swap state, authorized history and content-free audit commit once. */
export async function mutateNextAction(ctx: Ctx, id: string, input: unknown, now = new Date()): Promise<ServiceResult<import("../data/types.ts").Lead>> {
  const access = await loadContact(ctx, id);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const parsed = nextActionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_action" };
  const d = parsed.data, row = access.row, current = actionFromRow(row);
  const expectedId = d.action === "set" ? d.expectedActionId : d.actionId;
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt) || (current?.id ?? null) !== expectedId) return { ok: false, reason: "conflict" };
  const next = d.action === "cancel" ? undefined : d.next;
  if (next && !(OPEN_PIPELINE_STAGES as readonly string[]).includes(row.stage)) return { ok: false, reason: "invalid_transition" };
  if (next) {
    if (!checkNextActionDueAt(next.dueAt, now, d.action === "set" ? current?.dueAt : undefined).ok) return { ok: false, reason: "invalid_date" };
    const candidates = await listNextActionAssignees(ctx, id);
    if (!candidates.ok) return candidates;
    if (!candidates.value.some(candidate => candidate.id === next.assigneeId)) return { ok: false, reason: "invalid_assignee" };
  }
  let pending: NextAction | null = null;
  const history: HistoryEvent[] = [];
  if (d.action === "set") {
    pending = { ...d.next, id: current?.id ?? randomUUID() };
    const event = nextActionSetEvent(current, d.next);
    if (event) history.push({ event, action: pending });
  } else {
    // actionId is a required UUID; the comparison above already refuses absent/replaced actions.
    if (!current) return { ok: false, reason: "conflict" };
    if (d.action === "cancel") history.push({ event: "next_action_cancelled", action: current, reason: d.reason });
    else {
      history.push({ event: "next_action_completed", action: current, outcome: d.outcome });
      if (d.next) { pending = { ...d.next, id: randomUUID() }; history.push({ event: "next_action_created", action: pending }); }
    }
  }
  const where = and(eq(contacts.id, id), visibleTo(ctx.actor), contactRevision(d.expectedUpdatedAt),
    sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`,
    expectedId ? eq(contacts.nextActionId, expectedId) : isNull(contacts.nextActionId),
    next ? eligibleAssignee(next.assigneeId) : undefined,
    next ? inArray(contacts.stage, [...OPEN_PIPELINE_STAGES]) : undefined);
  if (!history.length) {
    const [unchanged] = await ctx.db.select({ id: contacts.id }).from(contacts).where(where).limit(1);
    if (!unchanged) return { ok: false, reason: await failedCasReason(ctx, id, d.expectedUpdatedAt, expectedId, next?.assigneeId) };
  } else {
    const update = ctx.db.update(contacts).set({ nextActionId: pending?.id ?? null, nextActionKind: pending?.kind ?? null,
      nextActionPurpose: pending?.purpose ?? null, nextActionDueAt: pending ? new Date(pending.dueAt) : null,
      nextActionAssignedUserId: pending?.assigneeId ?? null, nextFollowUpAt: pending ? new Date(nextActionDayMirror(pending.dueAt)) : null,
      updatedByUserId: ctx.actor.userId, updatedAt: nextContactUpdatedAt(now) }).where(where).returning({ id: contacts.id });
    const activityValues = sql.join(history.map(item => sql`(${SUMMARIES[item.event]}::text, ${JSON.stringify({ event: item.event, actionId: item.action.id, kind: item.action.kind, purpose: item.action.purpose, dueAt: item.action.dueAt, assigneeId: item.action.assigneeId, ...(item.outcome ? { outcome: item.outcome } : {}), ...(item.reason ? { reason: item.reason } : {}) })}::jsonb)`), sql`, `);
    const auditValues = sql.join(history.map(item => sql`(${JSON.stringify({ contactId: id, actionId: item.action.id, event: item.event, kind: item.action.kind, fields: ["nextAction", "nextFollowUpAt"] })}::jsonb)`), sql`, `);
    try {
      const result = await ctx.db.execute<{ id: string }>(sql`with changed as (${update.getSQL()}), activity as (
        insert into ${contactActivities} (contact_id,actor_user_id,kind,summary,occurred_at,safe_metadata)
        select changed.id, ${ctx.actor.userId}::uuid, 'task', event.summary, ${now.toISOString()}::timestamptz, event.metadata
        from changed cross join (values ${activityValues}) as event(summary,metadata) returning id
      ), audited as (
        insert into ${auditEvents} (event_type,actor_user_id,target_user_id,safe_metadata)
        select 'contact_updated', ${ctx.actor.userId}::uuid, null, event.metadata
        from changed cross join (values ${auditValues}) as event(metadata) returning id
      ) select id from changed`);
      if (!result.rows.length) return { ok: false, reason: await failedCasReason(ctx, id, d.expectedUpdatedAt, expectedId, next?.assigneeId) };
    } catch { return { ok: false, reason: "unavailable" }; }
  }
  const updated = await getContact(ctx, id);
  return updated ? { ok: true, value: updated } : { ok: false, reason: "unavailable" };
}
