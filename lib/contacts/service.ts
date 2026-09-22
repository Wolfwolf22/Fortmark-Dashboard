import "server-only";

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
import { canOwnRecords, isPrivileged, resolveActor as resolveBrokerageActor, type Actor } from "../auth/actor.ts";
import {
  canCreateFor,
  canSee,
  canWrite,
  toLead,
  type ActivityInput,
  type CreateContactInput,
} from "./domain.ts";
import { canTransition } from "./stages.ts";

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
  | "invalid_assignee";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; reason: ServiceFailure };

export type Ctx = { actor: Actor; db: Db };

export async function resolveActor(
  clerkUserId: string,
  env: EnvLike = process.env
): Promise<ServiceResult<Ctx>> {
  const result = await resolveBrokerageActor(clerkUserId, contactsDatabaseEnabled(env));
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, value: { actor: result.actor, db: result.db } };
}

/** The visibility predicate, as SQL. Mirrors `canSee` for a query.
 *  Exported so aggregates (lib/contacts/metrics.ts) count exactly the rows
 *  this actor may list — a total is a disclosure like any other. */
export function visibleTo(actor: Actor) {
  const tenant = eq(contacts.brokerageKey, actor.brokerageKey);
  return isPrivileged(actor) ? tenant : and(tenant, eq(contacts.assignedAgentUserId, actor.userId));
}

async function agentNames(db: Db, userIds: string[]): Promise<Map<string, string>> {
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
async function bundle(db: Db, rows: ContactRow[]): Promise<Lead[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [opps, names] = await Promise.all([
    db.select().from(contactOpportunities).where(inArray(contactOpportunities.contactId, ids)),
    agentNames(db, Array.from(new Set(rows.map((r) => r.assignedAgentUserId)))),
  ]);
  return rows.map((row) =>
    toLead({
      row,
      opportunities: opps.filter((o) => o.contactId === row.id),
      agentName: names.get(row.assignedAgentUserId),
    })
  );
}

export const MAX_LIST_ROWS = 500;

export interface ContactFilters {
  stage?: LeadStage[];
  source?: string[];
  agentId?: string;
  query?: string;
}

export async function listContacts(ctx: Ctx, filters: ContactFilters = {}): Promise<Lead[]> {
  const clauses = [visibleTo(ctx.actor)];
  if (filters.stage?.length) clauses.push(inArray(contacts.stage, filters.stage));
  if (filters.source?.length) clauses.push(inArray(contacts.source, filters.source as ContactRow["source"][]));
  if (filters.agentId && isPrivileged(ctx.actor)) clauses.push(eq(contacts.assignedAgentUserId, filters.agentId));
  if (filters.query) {
    const q = `%${filters.query.trim().toLowerCase().replace(/[%_]/g, "")}%`;
    clauses.push(
      or(
        sql`lower(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')) like ${q}`,
        sql`lower(coalesce(${contacts.preferredName}, '')) like ${q}`,
        sql`lower(coalesce(${contacts.email}, '')) like ${q}`,
        sql`exists (select 1 from ${contactOpportunities} o where o.contact_id = ${contacts.id} and lower(coalesce(o.area, '')) like ${q})`
      )!
    );
  }
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(...clauses))
    .orderBy(sql`${contacts.lastContactAt} desc nulls last`, desc(contacts.createdAt))
    .limit(MAX_LIST_ROWS);
  return bundle(ctx.db, rows);
}

export async function getContact(ctx: Ctx, id: string): Promise<Lead | null> {
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return null;
  return (await bundle(ctx.db, [row]))[0] ?? null;
}

/** The activity history of one contact, newest first. Scoped like a read. */
export async function listActivities(ctx: Ctx, id: string, limit = 50): Promise<ContactActivityRow[] | null> {
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
  const agentUserId =
    input.assignedAgentUserId && isPrivileged(ctx.actor) ? input.assignedAgentUserId : ctx.actor.userId;
  if (!canCreateFor(ctx.actor, agentUserId)) return { ok: false, reason: "forbidden" };
  // A named owner is a request-supplied id: it must be someone who can own work.
  if (agentUserId !== ctx.actor.userId && !(await canOwnRecords(ctx.db, agentUserId))) {
    return { ok: false, reason: "invalid_assignee" };
  }

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
      phoneE164: input.phone ?? null,
      company: input.company ?? null,
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
  options: { mechanism?: StageChangeMechanism; metadata?: Record<string, unknown>; now?: Date } = {}
): Promise<ServiceResult<StageChangePlan>> {
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
  const extra = mechanism === "manual" ? {} : { mechanism, ...(options.metadata ?? {}) };

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
export async function changeStage(ctx: Ctx, id: string, to: LeadStage, now = new Date()): Promise<ServiceResult<Lead>> {
  const planned = await planStageChange(ctx, id, to, { mechanism: "manual", now });
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
  const rows = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  await ctx.db.insert(contactActivities).values({
    contactId: row.id,
    opportunityId: input.opportunityId ?? null,
    actorUserId: ctx.actor.userId,
    kind: input.kind,
    summary: input.summary,
    occurredAt,
  });
  await ctx.db
    .update(contacts)
    .set({
      // The most recent touch wins; a backdated note does not move it backwards.
      lastContactAt: row.lastContactAt && row.lastContactAt > occurredAt ? row.lastContactAt : occurredAt,
      nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : row.nextFollowUpAt,
      updatedByUserId: ctx.actor.userId,
      updatedAt: now,
    })
    .where(eq(contacts.id, row.id));
  await recordAudit(ctx.db, ctx.actor.userId, "contact_updated", row.id, { activity: input.kind });
  const updated = await getContact(ctx, row.id);
  return updated ? { ok: true, value: updated } : { ok: false, reason: "unavailable" };
}

/** Agents a privileged caller may filter by: every active user with a name. */
export async function listAgents(ctx: Ctx): Promise<{ id: string; name: string }[]> {
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
