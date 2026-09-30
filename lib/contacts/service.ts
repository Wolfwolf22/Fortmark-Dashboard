import "server-only";
import { isRecordId } from "../db/ids.ts";

/**
 * Server-only contacts service.
 *
 * Scoped exactly as transactions are: by the caller's brokerage and, for
 * non-privileged roles, by the caller's own agent id — resolved from the
 * verified session through lib/auth/actor.ts, never from a request. A
 * contact that exists but is out of scope is answered like one that does
 * not.
 *
 * "Last contacted" is derived from activities: logging a touch stamps
 * `last_contact_at` on the contact so lists need no join, and the activity
 * row remains the record of what the touch was.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  auditEvents,
  contactActivities,
  contactOpportunities,
  contacts,
  dashboardUsers,
  professionalProfiles,
  type ContactActivityRow,
  type ContactRow,
} from "../db/schema.ts";
import { contactsDatabaseEnabled, type EnvLike } from "../flags.ts";
import type { Lead, LeadStage } from "../data/types.ts";
import { isBrokerageAdmin, resolveActor as resolveBrokerageActor, type Actor } from "../auth/actor.ts";
import {
  canCreateFor,
  canSee,
  canWrite,
  planContactEdit,
  resolveFollowUp,
  toLead,
  type ActivityInput,
  type CreateContactInput,
  type EditContactInput,
  type FollowUpChangeInput,
} from "./domain.ts";
import { canTransition, requiresEngagementNotice } from "./stages.ts";
import { visibleTo } from "./visibility.ts";
import { contactOrder, contactWhere, filterPredicates } from "./list-sql.ts";
import { DEFAULT_PAGE_SIZE, isPaged, MAX_PAGE_SIZE, type ContactQuery } from "./filters.ts";
import type { LeadPage, LeadSnapshot } from "./windows.ts";
import { toTimeline, type TimelineItem } from "./timeline.ts";
import { TIMELINE_DOMAIN_EVENTS } from "./events.ts";
import { toInt } from "../metrics/window.ts";
import { checkFollowUpDay, decideFollowUp, type FollowUpOutcome } from "./follow-up.ts";
import { businessDayKey } from "../metrics/business-day.ts";
import { toE164 } from "../profile/normalize.ts";

const FORBIDDEN_META = /token|secret|cookie|authorization|password|clerk_?user_?id|session/i;

function scrub(meta: Record<string, unknown> | undefined) {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META.test(k)) continue;
    if (typeof v === "string" && /^user_[A-Za-z0-9]{8,}$/.test(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type ServiceFailure =
  | "disabled"
  | "unavailable"
  | "no_identity"
  | "not_found"
  | "forbidden"
  | "invalid_transition"
  | "invalid_assignee"
  | "invalid_date"
  | "invalid_name"
  | "invalid_phone"
  | "invalid_note"
  | "invalid_need";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; reason: ServiceFailure };

export type Ctx = {
  actor: Actor;
  db: Db;
  /**
   * The signed-in person's own name from the identity provider, resolved only
   * if asked. It is the last resort for "Assigned agent" on a contact the
   * caller owns whose profile has no name — never an email, never an id.
   */
  viewerName?: () => Promise<string | null>;
};

export async function resolveActor(
  clerkUserId: string,
  env: EnvLike = process.env
): Promise<ServiceResult<Ctx>> {
  const result = await resolveBrokerageActor(clerkUserId, contactsDatabaseEnabled(env));
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, value: { actor: result.actor, db: result.db } };
}

export { visibleTo } from "./visibility.ts";

export async function agentNames(db: Db, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const rows = await db
    .select({
      userId: professionalProfiles.userId,
      display: professionalProfiles.preferredDisplayName,
      first: professionalProfiles.legalFirstName,
      last: professionalProfiles.legalLastName,
    })
    .from(professionalProfiles)
    .where(inArray(professionalProfiles.userId, userIds));
  for (const a of rows) {
    const name = a.display?.trim() || [a.first, a.last].filter(Boolean).join(" ").trim();
    if (name) names.set(a.userId, name);
  }
  return names;
}

/** Rows → screen, with opportunities and agent names fetched per page. */
async function bundle(ctx: Pick<Ctx, "db" | "actor" | "viewerName">, rows: ContactRow[]): Promise<Lead[]> {
  if (rows.length === 0) return [];
  const { db } = ctx;
  const ids = rows.map((r) => r.id);
  const [opps, names] = await Promise.all([
    db.select().from(contactOpportunities).where(inArray(contactOpportunities.contactId, ids)),
    agentNames(db, Array.from(new Set(rows.map((r) => r.assignedAgentUserId)))),
  ]);
  // Profile name first (above). A contact the caller owns whose profile has
  // no name falls back to the caller's own name; anyone else's stays unnamed
  // and the screen says so. Neither path ever produces an id or an email.
  if (ctx.viewerName && !names.has(ctx.actor.userId) && rows.some((r) => r.assignedAgentUserId === ctx.actor.userId)) {
    const own = (await ctx.viewerName().catch(() => null))?.trim();
    if (own) names.set(ctx.actor.userId, own);
  }
  return rows.map((row) =>
    toLead({
      row,
      opportunities: opps.filter((o) => o.contactId === row.id),
      agentName: names.get(row.assignedAgentUserId),
      viewerId: ctx.actor.userId,
    })
  );
}

export const MAX_LIST_ROWS = 500;

/** Kept as a name: the AI tools and older callers pass the same shape. */
export type ContactFilters = ContactQuery;

/**
 * The contacts this caller may see, filtered, sorted and — when asked — paged in
 * SQL. `total` is the number of matches, not the number of rows returned, so a
 * page can say how many there are.
 *
 * Without `page`/`pageSize` it answers as it always has: every match, up to
 * `MAX_LIST_ROWS`.
 */
export async function listContactsPage(ctx: Ctx, query: ContactQuery = {}, now = new Date()): Promise<LeadPage> {
  const where = contactWhere(ctx.actor, query, now);
  const paged = isPaged(query);
  const pageSize = paged ? Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) : MAX_LIST_ROWS;
  const page = paged ? (query.page ?? 1) : 1;

  const [rows, counted] = await Promise.all([
    ctx.db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(...contactOrder(query.sort, query.dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    ctx.db.select({ n: sql<number>`count(*)` }).from(contacts).where(where),
  ]);
  return { items: await bundle(ctx, rows), total: toInt(counted[0]?.n), page, pageSize };
}

export async function listContacts(ctx: Ctx, query: ContactQuery = {}, now = new Date()): Promise<Lead[]> {
  return (await listContactsPage(ctx, query, now)).items;
}

/**
 * The counts behind the Leads snapshot cards: one aggregate over exactly the
 * contacts this caller may list, each figure computed from the same predicates
 * the table applies when a card is opened. Nothing here is estimated; a figure
 * that cannot be computed truthfully is simply not in the result.
 */
export async function contactSnapshot(ctx: Ctx, now = new Date()): Promise<LeadSnapshot> {
  const count = (q: ContactQuery) => {
    const preds = filterPredicates(ctx.actor, q, now);
    return preds.length ? sql<number>`count(*) filter (where ${and(...preds)})` : sql<number>`count(*)`;
  };
  const scope = visibleTo(ctx.actor);
  const [agg, byStage] = await Promise.all([
    ctx.db
      .select({
        total: count({}),
        active: count({ active: true }),
        newThisWeek: count({ created: "7d" }),
        dueToday: count({ active: true, followUp: "due_today" }),
        overdue: count({ active: true, followUp: "overdue" }),
        noTouch14: count({ active: true, lastTouch: "14d" }),
      })
      .from(contacts)
      .where(scope),
    ctx.db.select({ stage: contacts.stage, n: sql<number>`count(*)` }).from(contacts).where(scope).groupBy(contacts.stage),
  ]);
  const row = agg[0];
  const stages: Record<string, number> = {};
  for (const r of byStage) stages[r.stage] = toInt(r.n);
  return {
    total: toInt(row?.total),
    active: toInt(row?.active),
    newThisWeek: toInt(row?.newThisWeek),
    dueToday: toInt(row?.dueToday),
    overdue: toInt(row?.overdue),
    noTouch14: toInt(row?.noTouch14),
    byStage: stages,
  };
}

export async function getContact(ctx: Ctx, id: string): Promise<Lead | null> {
  if (!isRecordId(id)) return null;
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return null;
  return (await bundle(ctx, [row]))[0] ?? null;
}

/** The activity history of one contact, newest first. Scoped like a read. */
export async function listActivities(ctx: Ctx, id: string, limit = 50): Promise<ContactActivityRow[] | null> {
  if (!isRecordId(id)) return null;
  const contact = await getContact(ctx, id);
  if (!contact) return null;
  return ctx.db
    .select()
    .from(contactActivities)
    .where(eq(contactActivities.contactId, id))
    .orderBy(desc(contactActivities.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

async function recordAudit(
  db: Db,
  actorUserId: string,
  eventType: "contact_created" | "contact_updated" | "contact_stage_changed",
  contactId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const safe = scrub(metadata);
  try {
    await db.insert(auditEvents).values({
      eventType,
      actorUserId,
      targetUserId: null,
      safeMetadata: safe ? { contactId, ...safe } : { contactId },
    });
  } catch {
    // Auditing must never break the write it describes.
  }
}

export async function createContact(ctx: Ctx, input: CreateContactInput): Promise<ServiceResult<Lead>> {
  // A contact belongs to the person who creates it. There is no request shape
  // that names another owner, so nothing here can hand a contact to someone else.
  const agentUserId = ctx.actor.userId;
  if (!canCreateFor(ctx.actor, agentUserId)) return { ok: false, reason: "forbidden" };

  const inserted = await ctx.db
    .insert(contacts)
    .values({
      brokerageKey: ctx.actor.brokerageKey,
      assignedAgentUserId: agentUserId,
      createdByUserId: ctx.actor.userId,
      updatedByUserId: ctx.actor.userId,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      preferredName: input.preferredName ?? null,
      email: input.email?.toLowerCase() ?? null,
      // Stored E.164 so a typed number matches by its digits; one that cannot be
      // read confidently is kept as typed rather than dropped.
      phoneE164: input.phone ? (toE164(input.phone) ?? input.phone) : null,
      company: input.company ?? null,
      birthdayMonth: input.birthday?.month ?? null,
      birthdayDay: input.birthday?.day ?? null,
      source: input.source ?? "other",
      tags: input.tags ?? [],
      notes: input.notes ?? null,
    })
    .returning();
  const row = inserted[0];
  if (!row) return { ok: false, reason: "unavailable" };

  if (input.opportunities?.length) {
    await ctx.db.insert(contactOpportunities).values(
      input.opportunities.map((o) => ({
        contactId: row.id,
        kind: o.kind,
        area: o.area ?? null,
        budgetMinCents: o.budgetMinCents ?? null,
        budgetMaxCents: o.budgetMaxCents ?? null,
        timeframe: o.timeframe ?? null,
        notes: o.notes ?? null,
      }))
    );
  }
  try {
    await ctx.db.insert(contactActivities).values({
      contactId: row.id,
      actorUserId: ctx.actor.userId,
      kind: "system",
      summary: "Contact created",
      safeMetadata: { source: row.source },
    });
  } catch {
    // History must never break the write it describes.
  }
  await recordAudit(ctx.db, ctx.actor.userId, "contact_created", row.id, { source: row.source });
  const created = await getContact(ctx, row.id);
  return created ? { ok: true, value: created } : { ok: false, reason: "unavailable" };
}

/**
 * How a stage change came to be made. The human is the actor either way.
 *
 * `manual` is someone using the Leads screen. `ai_assisted` is someone
 * pressing Confirm on a change an assistant prepared — the same person, the
 * same authority, reached through a different door. The distinction is
 * recorded so the history can answer "how did this happen", never so the two
 * paths can behave differently.
 */
export type StageChangeMechanism = "manual" | "ai_assisted";

/**
 * A validated, authorized stage change that has NOT been written yet.
 *
 * `writes` is the complete set of statements the transition requires, ready to
 * be handed to `db.batch`. Returning them rather than performing them is what
 * lets the AI-confirmed path append its own statement — marking the prepared
 * action executed — and commit all four together, without duplicating a line
 * of this module's authorization or validation.
 */
export interface StageChangePlan {
  row: ContactRow;
  from: LeadStage;
  to: LeadStage;
  writes: BatchWrite[];
}

/** One statement in a batch. Drizzle's builders are thenable, not promises. */
type BatchWrite = Parameters<Db["batch"]>[0][number];

/**
 * Authorize and validate a stage change, and build its writes.
 *
 * Everything that decides whether the change may happen lives here and only
 * here: visibility, write permission, the lifecycle graph, and the same-stage
 * rule. Both callers — the Leads screen and AI-confirmed execution — go
 * through this function, so there is exactly one answer to "may this person
 * move this contact to that stage", and one definition of what a stage change
 * writes.
 */
export async function planStageChange(
  ctx: Ctx,
  id: string,
  to: LeadStage,
  options: { mechanism?: StageChangeMechanism; metadata?: Record<string, unknown>; now?: Date; engagementAcknowledged?: boolean } = {}
): Promise<ServiceResult<StageChangePlan>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const now = options.now ?? new Date();
  const mechanism = options.mechanism ?? "manual";

  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };
  const from = row.stage as LeadStage;
  // `canTransition` refuses same-stage, so a no-op arrives here as an invalid
  // transition rather than as a silent success that writes history.
  if (!canTransition(from, to)) return { ok: false, reason: "invalid_transition" };

  // The mechanism is additive metadata. A manual change records exactly what
  // it always recorded, so existing history stays comparable.
  // Entering a formally-engaged stage records whether the notice was
  // acknowledged — never that an engagement was verified, because none is.
  const gate = requiresEngagementNotice(from, to) ? { engagementAcknowledged: options.engagementAcknowledged === true } : {};
  const extra = { ...(mechanism === "manual" ? {} : { mechanism, ...(options.metadata ?? {}) }), ...gate };

  return {
    ok: true,
    value: {
      row,
      from,
      to,
      writes: [
        ctx.db
          .update(contacts)
          .set({ stage: to, updatedByUserId: ctx.actor.userId, updatedAt: now })
          .where(eq(contacts.id, row.id)),
        // The business event, in the domain's own words. An AI-assisted change
        // is the same CRM event as any other — only the metadata differs.
        ctx.db.insert(contactActivities).values({
          contactId: row.id,
          actorUserId: ctx.actor.userId,
          kind: "status_change",
          summary: `Stage changed from ${from} to ${to}`,
          occurredAt: now,
          safeMetadata: { from, to, ...extra },
        }),
        ctx.db.insert(auditEvents).values({
          eventType: "contact_stage_changed",
          actorUserId: ctx.actor.userId,
          targetUserId: null,
          safeMetadata: scrub({ contactId: row.id, from, to, ...extra }) ?? { contactId: row.id },
        }),
      ],
    },
  };
}

/**
 * Change a contact's stage. The manual path, used by the Leads screen.
 *
 * The three writes commit as one Neon transaction. Previously they were
 * sequential awaits whose activity insert was wrapped in a `catch` that
 * swallowed — so a failure could leave the stage changed with no history and
 * nobody told, on the one field an audit trail exists for. If the history
 * cannot be recorded, the transition does not happen.
 */
export async function changeStage(
  ctx: Ctx,
  id: string,
  to: LeadStage,
  now = new Date(),
  options: { engagementAcknowledged?: boolean } = {}
): Promise<ServiceResult<Lead>> {
  const planned = await planStageChange(ctx, id, to, { mechanism: "manual", now, engagementAcknowledged: options.engagementAcknowledged });
  if (!planned.ok) return planned;

  try {
    await commitStageChange(ctx.db, planned.value.writes);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const updated = await getContact(ctx, planned.value.row.id);
  return updated ? { ok: true, value: updated } : { ok: false, reason: "unavailable" };
}

/**
 * Commit a stage change's writes as one transaction.
 *
 * `db.batch` maps onto the Neon HTTP client's `transaction(...)`, which is a
 * real server-side PostgreSQL transaction: every statement commits or none
 * does. Never call the writes individually.
 */
export async function commitStageChange(db: Db, writes: BatchWrite[]): Promise<void> {
  // drizzle types `batch` as a non-empty tuple; a plan always has three or
  // more writes, and the cast says so rather than widening the signature.
  await db.batch(writes as unknown as Parameters<Db["batch"]>[0]);
}

/** Log a touch. Stamps last-contacted and, when given, the next follow-up. */
export async function logActivity(ctx: Ctx, id: string, input: ActivityInput, now = new Date()): Promise<ServiceResult<Lead>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };

  // A new date is judged the same way as on the direct control: a real day,
  // not in the past. Checked after authorization, before anything is written.
  if (input.nextFollowUpAt) {
    const checked = checkFollowUpDay(businessDayKey(new Date(input.nextFollowUpAt)), now);
    if (!checked.ok) return { ok: false, reason: "invalid_date" };
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  // Kept unless the caller sets a new date or explicitly completes it.
  const followUp = resolveFollowUp(row.nextFollowUpAt ?? null, input);
  await ctx.db.insert(contactActivities).values({
    contactId: row.id,
    opportunityId: input.opportunityId ?? null,
    actorUserId: ctx.actor.userId,
    kind: input.kind,
    summary: input.summary,
    occurredAt,
    // A touch that also moved the reminder says so on its own line of the timeline.
    safeMetadata:
      followUp.change === "kept"
        ? null
        : {
            followUp: followUp.change,
            ...(followUp.value ? { followUpDay: businessDayKey(followUp.value) } : {}),
          },
  });
  await ctx.db
    .update(contacts)
    .set({
      // The most recent touch wins; a backdated note does not move it backwards.
      lastContactAt: row.lastContactAt && row.lastContactAt > occurredAt ? row.lastContactAt : occurredAt,
      nextFollowUpAt: followUp.value,
      updatedByUserId: ctx.actor.userId,
      updatedAt: now,
    })
    .where(eq(contacts.id, row.id));
  await recordAudit(ctx.db, ctx.actor.userId, "contact_updated", row.id, {
    activity: input.kind,
    followUp: followUp.change,
  });
  const updated = await getContact(ctx, row.id);
  return updated ? { ok: true, value: updated } : { ok: false, reason: "unavailable" };
}

/**
 * Set, reschedule or complete a contact's follow-up WITHOUT logging a touch.
 *
 * A reminder is not an interaction. "Call Jane Friday" decided today means
 * nobody has spoken to Jane today, so this writes exactly one column —
 * `next_follow_up_at` — and never `last_contact_at`, and it records no
 * call/email/meeting/note activity: the Leads timeline and the 14-day
 * "no touch" heuristic stay true. What it does leave is an audit event, which
 * is history about the system, not about the client: who changed which field,
 * and how — never the date itself, the contact's name, or any contact detail.
 *
 * The update and its audit row commit as one transaction (`db.batch` is a
 * real Neon transaction, as in `changeStage`), so there is no state in which
 * the follow-up changed and the audit is missing, or the reverse. A request
 * that changes nothing writes nothing.
 *
 * Authorization is the stage change's, in the same order: outside the caller's
 * scope is `not_found` (no existence leak), visible but not writable is
 * `forbidden`, and both are decided before any date is judged or any row written.
 */
export async function changeFollowUp(
  ctx: Ctx,
  id: string,
  change: FollowUpChangeInput,
  now = new Date()
): Promise<ServiceResult<{ lead: Lead; outcome: FollowUpOutcome }>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };

  if (change.action === "schedule" && !checkFollowUpDay(change.day, now).ok) {
    return { ok: false, reason: "invalid_date" };
  }
  const current = row.nextFollowUpAt ?? null;
  const decided = decideFollowUp(current, change.action === "schedule" ? { day: change.day } : { complete: true });

  if (decided.outcome !== "kept") {
    try {
      await ctx.db.batch([
        ctx.db
          .update(contacts)
          .set({ nextFollowUpAt: decided.value, updatedByUserId: ctx.actor.userId, updatedAt: now })
          .where(eq(contacts.id, row.id)),
        ctx.db.insert(auditEvents).values({
          eventType: "contact_updated",
          actorUserId: ctx.actor.userId,
          targetUserId: null,
          safeMetadata: scrub({
            contactId: row.id,
            field: "nextFollowUpAt",
            followUp: decided.outcome,
            mechanism: "direct",
            // The reminder's day is workflow data, not contact data; it is what
            // lets the timeline say "scheduled for Oct 3".
            ...(change.action === "schedule" ? { day: change.day } : {}),
          }) ?? { contactId: row.id },
        }),
      ] as unknown as Parameters<Db["batch"]>[0]);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  const updated = await getContact(ctx, row.id);
  return updated ? { ok: true, value: { lead: updated, outcome: decided.outcome } } : { ok: false, reason: "unavailable" };
}

/**
 * The owners an admin may filter the brokerage's contacts by: every active user
 * with a name. Read-only — there is no reassignment — and nobody but an admin
 * is offered the roster.
 */
export async function listAgents(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  if (!isBrokerageAdmin(ctx.actor)) return [];
  const users = await ctx.db
    .select({ id: dashboardUsers.id, role: dashboardUsers.role })
    .from(dashboardUsers)
    .where(eq(dashboardUsers.status, "active"));
  const ids = users.map((u) => u.id);
  const names = await agentNames(ctx.db, ids);
  return users
    .filter((u) => u.role !== "member")
    .map((u) => ({ id: u.id, name: names.get(u.id) ?? "Unnamed agent" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Edit, timeline ------------------------------------------------------------

/**
 * Change how a contact is named and reached, where they came from, or the notes.
 *
 * Authorization is the stage change's, in the same order: outside the caller's
 * scope is `not_found`, visible but not writable is `forbidden`, and both are
 * decided before the body's content is judged. What may change is
 * `planContactEdit`'s call, and only real changes are written: the update and
 * its audit row commit as one transaction, and a request that changes nothing
 * writes nothing. The audit names the fields that changed — never their values.
 * It also never touches last contact, the follow-up, the stage or the owner.
 */
export async function editContact(
  ctx: Ctx,
  id: string,
  patch: EditContactInput,
  now = new Date()
): Promise<ServiceResult<{ lead: Lead; changed: string[] }>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };

  const plan = planContactEdit(row, patch);
  if (!plan.ok) return { ok: false, reason: plan.field === "phone" ? "invalid_phone" : "invalid_name" };

  if (plan.changed.length > 0) {
    try {
      await ctx.db.batch([
        ctx.db
          .update(contacts)
          .set({ ...plan.set, updatedByUserId: ctx.actor.userId, updatedAt: now })
          .where(eq(contacts.id, row.id)),
        ctx.db.insert(auditEvents).values({
          eventType: "contact_updated",
          actorUserId: ctx.actor.userId,
          targetUserId: null,
          // Field names, and for a birthday only whether it was set, changed or cleared.
          safeMetadata:
            scrub({ contactId: row.id, mechanism: "edit", fields: plan.changed, ...(plan.birthday ? { birthday: plan.birthday } : {}) }) ??
            { contactId: row.id },
        }),
      ] as unknown as Parameters<Db["batch"]>[0]);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  const updated = await getContact(ctx, row.id);
  return updated ? { ok: true, value: { lead: updated, changed: plan.changed } } : { ok: false, reason: "unavailable" };
}

/**
 * A contact's timeline, scoped like a read of the contact itself: outside the
 * caller's scope is `not_found`. Interactions and stage moves come from the
 * activity history; follow-up events come from the audit trail, which is the
 * only place a reminder change is recorded (see `timeline.ts`). Names are
 * resolved in one batch — profile name, else nothing — never an id or an email.
 */
export async function getTimeline(ctx: Ctx, id: string, limit = 100): Promise<ServiceResult<TimelineItem[]>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const rows = await ctx.db
    .select({ id: contacts.id, brokerageKey: contacts.brokerageKey, assignedAgentUserId: contacts.assignedAgentUserId })
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };

  const capped = Math.min(Math.max(limit, 1), 200);
  const [activities, followUps, domainEvents] = await Promise.all([
    ctx.db
      .select({
        id: contactActivities.id,
        kind: contactActivities.kind,
        summary: contactActivities.summary,
        occurredAt: contactActivities.occurredAt,
        actorUserId: contactActivities.actorUserId,
        safeMetadata: contactActivities.safeMetadata,
      })
      .from(contactActivities)
      .where(eq(contactActivities.contactId, id))
      .orderBy(desc(contactActivities.occurredAt))
      .limit(capped),
    ctx.db
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        actorUserId: auditEvents.actorUserId,
        safeMetadata: auditEvents.safeMetadata,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.eventType, "contact_updated"),
          sql`${auditEvents.safeMetadata}->>'contactId' = ${id}`,
          sql`${auditEvents.safeMetadata}->>'field' = 'nextFollowUpAt'`
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(capped),
    ctx.db
      .select({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
        createdAt: auditEvents.createdAt,
        actorUserId: auditEvents.actorUserId,
        safeMetadata: auditEvents.safeMetadata,
      })
      .from(auditEvents)
      .where(
        and(
          inArray(auditEvents.eventType, [...TIMELINE_DOMAIN_EVENTS]),
          sql`${auditEvents.safeMetadata}->>'contactId' = ${id}`
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(capped),
  ]);

  const userIds = new Set<string>();
  for (const a of activities) {
    if (a.actorUserId) userIds.add(a.actorUserId);
    const to = a.safeMetadata?.toAgentUserId;
    if (typeof to === "string") userIds.add(to);
  }
  for (const e of followUps) if (e.actorUserId) userIds.add(e.actorUserId);
  for (const e of domainEvents) if (e.actorUserId) userIds.add(e.actorUserId);
  const names = await agentNames(ctx.db, Array.from(userIds));

  return { ok: true, value: toTimeline({ activities, followUpEvents: followUps, domainEvents, names, limit: capped }) };
}
