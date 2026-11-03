import "server-only";
import { isRecordId } from "../db/ids.ts";

/**
 * Server-only transactions service.
 *
 * Every read and write is scoped by the caller's brokerage and, for
 * non-privileged roles, by the caller's own agent id — resolved from the
 * database row the verified Clerk session maps to, never from a request.
 * There is no request shape that addresses another agent's deal: an id that
 * exists but is out of scope is answered exactly like one that does not.
 *
 * Reads fetch a page of deals, then their parties and deadlines in two
 * further queries keyed by the page's ids — three round trips for a screen,
 * never one per row.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import {
  auditEvents,
  contacts, dashboardUsers, transactionWriteRequests, transactionChecklistItems, transactionChecklistAttachments,
  professionalProfiles,
  transactionDeadlines,
  transactionEvents,
  transactionParties,
  transactions,
  type TransactionRow,
} from "../db/schema.ts";
import { transactionsDatabaseEnabled, type EnvLike } from "../flags.ts";
import type { DateRange, Transaction, TransactionFilters, TransactionStage } from "../data/types.ts";
import { canOwnRecords, isBrokerageAdmin, isPrivileged, resolveActor as resolveBrokerageActor, type Actor } from "../auth/actor.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { visibleTo as visibleContacts } from "../contacts/visibility.ts";
import { calendarDayKey } from "./calendar-days.ts";
import { createTransactionSchema } from "./validation.ts";
import { loadContact } from "../contacts/access.ts";
import { displayName as contactDisplayName } from "../contacts/domain.ts";
import { ELIGIBLE_STAGE } from "../contacts/eligible.ts";
import {
  canCreateFor,
  canSee,
  canWrite,
  initialDeadlines,
  toTransaction,
  type CreateTransactionInput,
} from "./domain.ts";
import { canTransition, isTerminalStage, isStage } from "./stages.ts";
import { checklistRequiredStages, checklistBlockers, checklistMissingStages } from "./checklist-domain.ts";
import { createGeneralContractorTransaction } from "./gc-service.ts";

/** Keys that must never appear in event metadata. Same rule as audit. */
const FORBIDDEN_META = /token|secret|cookie|authorization|password|clerk_?user_?id|session/i;

function scrub(meta: Record<string, unknown> | undefined) {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META.test(k)) continue;
    if (typeof v === "string" && /^user_[A-Za-z0-9]{8,}$/.test(v)) continue;
    if ((k === "from" || k === "to") && typeof v === "string" || k === "mechanism" && v === "ai_assisted" || /Id$/.test(k) && typeof v === "string" && isRecordId(v)) out[k] = v;
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
  | "invalid_contact"
  | "conflict" | "request_conflict" | "invalid_transaction" | "closing_deadline_conflict" | "invalid_deadline_transition" | "checklist_incomplete" | "checklist_not_ready" | "invalid_checklist_transition"
  | "invalid_attachment" | "file_too_large" | "attachment_required" | "attachment_requires_reopen" | "attachment_not_configured" | "attachment_unavailable" | "attachment_limit" | "vendor_unavailable" | "invalid_vendor_details" | "vendor_detail_not_current"
  | "invalid_property" | "property_changed" | "property_linked" | "property_import_unavailable" | "property_not_found" | "property_ambiguous" | "property_not_configured" | "property_unavailable" | "invalid_tour_link" | "tour_link_contact_conflict" | "gc_not_configured";

/** The role a contact takes on the deal, by which side FortMark represents. */
const CLIENT_PARTY_ROLE: Record<TransactionSideKey, "seller" | "buyer" | "landlord" | "tenant"> = {
  listing: "seller",
  buyer: "buyer",
  dual: "buyer",
  landlord: "landlord",
  tenant: "tenant",
};
type TransactionSideKey = "listing" | "buyer" | "dual" | "landlord" | "tenant";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; reason: ServiceFailure };

/** The caller as an actor for this domain. See lib/auth/actor.ts. */
export async function resolveActor(
  clerkUserId: string,
  env: EnvLike = process.env
): Promise<ServiceResult<{ actor: Actor; db: Db }>> {
  const result = await resolveBrokerageActor(clerkUserId, transactionsDatabaseEnabled(env));
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, value: { actor: result.actor, db: result.db } };
}

/** The visibility predicate, as SQL. Mirrors `canSee` for a query.
 *  Exported so aggregates (lib/transactions/metrics.ts) count exactly the
 *  rows this actor may list — a total is a disclosure like any other. */
export function visibleTo(actor: Actor) {
  const tenant = eq(transactions.brokerageKey, actor.brokerageKey);
  return isPrivileged(actor) ? tenant : and(tenant, eq(transactions.agentUserId, actor.userId));
}
/** A resolved request actor can become stale while dependent reads are awaiting. */
export function transactionActorGuard(actor: Actor) {
  return sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${actor.userId}::uuid and ${dashboardUsers.role}=${actor.role} and ${dashboardUsers.status}='active')`;
}

async function stillReadable(ctx: { actor: Actor; db: Db }, rows: TransactionRow[]): Promise<Set<string>> {
  if (!rows.length) return new Set();
  const current = await ctx.db.select({ id: transactions.id, updatedAt: transactions.updatedAt }).from(transactions).where(and(inArray(transactions.id, rows.map(row => row.id)), visibleTo(ctx.actor), transactionActorGuard(ctx.actor)));
  const revisions = new Map(rows.map(row => [row.id, row.updatedAt.getTime()]));
  return new Set(current.filter(row => revisions.get(row.id) === row.updatedAt.getTime()).map(row => row.id));
}

async function bundle(db: Db, rows: TransactionRow[], now: Date): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const agentIds = Array.from(new Set(rows.map((r) => r.agentUserId)));
  const [parties, deadlines, agents] = await Promise.all([
    db.select().from(transactionParties).where(inArray(transactionParties.transactionId, ids)),
    db.select().from(transactionDeadlines).where(and(inArray(transactionDeadlines.transactionId, ids), isNull(transactionDeadlines.removedAt))),
    db
      .select({
        userId: professionalProfiles.userId,
        display: professionalProfiles.preferredDisplayName,
        first: professionalProfiles.legalFirstName,
        last: professionalProfiles.legalLastName,
      })
      .from(professionalProfiles)
      .where(inArray(professionalProfiles.userId, agentIds)),
  ]);
  const names = new Map<string, string>();
  for (const a of agents) {
    const name = a.display?.trim() || [a.first, a.last].filter(Boolean).join(" ").trim();
    if (name) names.set(a.userId, name);
  }
  return rows.map((row) =>
    toTransaction(
      {
        row,
        parties: parties.filter((p) => p.transactionId === row.id),
        deadlines: deadlines.filter((d) => d.transactionId === row.id),
        agentName: names.get(row.agentUserId),
      },
      now
    )
  );
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Cap on rows returned to a screen. The UI pages within it. */
export const MAX_LIST_ROWS = 200;

export async function listTransactions(
  ctx: { actor: Actor; db: Db },
  filters: TransactionFilters = {},
  range?: DateRange,
  now: Date = new Date()
): Promise<Transaction[]> {
  const clauses = [visibleTo(ctx.actor), transactionActorGuard(ctx.actor)];
  if (filters.stage?.length) clauses.push(inArray(transactions.stage, filters.stage));
  if (filters.side?.length) clauses.push(inArray(transactions.side, filters.side));
  if (filters.agentId && isPrivileged(ctx.actor)) clauses.push(eq(transactions.agentUserId, filters.agentId));
  if (range) {
    const from = toDateOnly(range.from);
    const to = toDateOnly(range.to);
    // In the period when it went under contract or is due to close in it.
    clauses.push(
      or(
        and(sql`${transactions.contractExecutionDate} >= ${from}`, sql`${transactions.contractExecutionDate} <= ${to}`),
        and(sql`${transactions.closingDate} >= ${from}`, sql`${transactions.closingDate} <= ${to}`)
      )!
    );
  }
  if (filters.query) {
    const q = `%${filters.query.trim().toLowerCase().replace(/[%_]/g, "")}%`;
    clauses.push(
      or(
        sql`lower(${transactions.addressLine1}) like ${q}`,
        sql`lower(${transactions.city}) like ${q}`,
        sql`lower(${transactions.mlsNumber}) like ${q}`,
        sql`exists (select 1 from ${transactionParties} p where p.transaction_id = ${transactions.id} and lower(p.display_name) like ${q})`
      )!
    );
  }
  const rows = await ctx.db
    .select()
    .from(transactions)
    .where(and(...clauses))
    .orderBy(sql`${transactions.closingDate} asc nulls last`, desc(transactions.createdAt))
    .limit(MAX_LIST_ROWS);
  const values = await bundle(ctx.db, rows, now), readable = await stillReadable(ctx, rows);
  return values.filter(value => readable.has(value.id));
}

export async function getTransaction(
  ctx: { actor: Actor; db: Db },
  id: string,
  now: Date = new Date()
): Promise<Transaction | null> {
  if (!isRecordId(id)) return null;
  const rows = await ctx.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), visibleTo(ctx.actor), transactionActorGuard(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return null;
  const values = await bundle(ctx.db, [row], now);
  return (await stillReadable(ctx, [row])).has(id) ? values[0] ?? null : null;
}

export type TransactionContext = { actor: Actor; db: Db };
type TransactionWrite = Parameters<Db["batch"]>[0][number];
export function transactionRevisionGuard(ctx: TransactionContext, row: TransactionRow, expected: string) {
  return and(eq(transactions.id, row.id), sql`${transactions.side}<>'gc'`, sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`, visibleTo(ctx.actor), eq(transactions.agentUserId, row.agentUserId), eq(transactions.brokerageKey, row.brokerageKey), eq(transactions.stage, row.stage), sql`date_trunc('milliseconds',${transactions.updatedAt})=${expected}::timestamptz`);
}
export function transactionWriteLocks(ctx: TransactionContext, id?: string): TransactionWrite[] {
  const locks: TransactionWrite[] = [ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(eq(dashboardUsers.id, ctx.actor.userId)).for("no key update")];
  if (id) locks.push(ctx.db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, id), visibleTo(ctx.actor))).for("update"));
  return locks;
}
export function nextTransactionRevision(row: TransactionRow, now: Date) { return new Date(Math.max(row.updatedAt.getTime() + 1, now.getTime())); }
export async function transactionWriteReplay(ctx: TransactionContext, requestId: string, hash: string, action: string, now = new Date()): Promise<ServiceResult<Transaction> | null> {
  const [receipt] = await ctx.db.select().from(transactionWriteRequests).where(and(eq(transactionWriteRequests.actorUserId, ctx.actor.userId), eq(transactionWriteRequests.requestId, requestId))).limit(1);
  if (!receipt) return null;
  const transaction = await getTransaction(ctx, receipt.transactionId, now); if (!transaction) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, { brokerageKey: ctx.actor.brokerageKey, agentUserId: transaction.agentId })) return { ok: false, reason: "forbidden" };
  return receipt.payloadHash === hash && receipt.action === action ? { ok: true, value: transaction } : { ok: false, reason: "request_conflict" };
}
export function isTransactionGuardConflict(error: unknown): boolean {
  let cause = error;
  for (let i = 0; cause && typeof cause === "object" && i < 8; i++) { const value = cause as { code?: string; table?: string; column?: string; cause?: unknown }; if (value.code === "40P01" || value.code === "23502" && value.table === "transaction_write_requests" && value.column === "payload_hash") return true; cause = value.cause; }
  return false;
}

/** A snapshot must exist for each crossed stage; absence is never permission to advance. */
export async function transactionChecklistGate(ctx: TransactionContext, id: string, from: TransactionStage, to: TransactionStage): Promise<ServiceResult<true>> {
  const stages = checklistRequiredStages(from, to); if (!stages.length) return { ok: true, value: true };
  // Keep the correlated outer identifiers qualified: select-field rendering otherwise strips them.
  const items = await ctx.db.select({ stage: transactionChecklistItems.stage, required: transactionChecklistItems.required, completedAt: transactionChecklistItems.completedAt, attachmentRequired: transactionChecklistItems.attachmentRequired,
    attachmentCount: sql<number>`(select count(*)::int from ${transactionChecklistAttachments} a where a.transaction_id=transaction_checklist_items.transaction_id and a.checklist_item_id=transaction_checklist_items.id and a.removed_at is null)`,
  }).from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, id));
  const checked = items.map(item => ({ ...item, stage: item.stage as (typeof stages)[number] }));
  if (checklistMissingStages(checked, from, to).length) return { ok: false, reason: "checklist_not_ready" };
  return checklistBlockers(checked, from, to).length ? { ok: false, reason: "checklist_incomplete" } : { ok: true, value: true };
}
function checklistGateSql(id: string, from: TransactionStage, to: TransactionStage) {
  const stages = checklistRequiredStages(from, to); if (!stages.length) return sql`true`;
  return sql`not exists(select 1 from ${transactionChecklistItems} where ${transactionChecklistItems.transactionId}=${id}::uuid and ${inArray(transactionChecklistItems.stage, [...stages])} and ${transactionChecklistItems.required}=true and (${transactionChecklistItems.completedAt} is null or (${transactionChecklistItems.attachmentRequired}=true and not exists(select 1 from ${transactionChecklistAttachments} a where a.transaction_id=transaction_checklist_items.transaction_id and a.checklist_item_id=transaction_checklist_items.id and a.removed_at is null))))
    and ${sql.join(stages.map(stage => sql`exists(select 1 from ${transactionChecklistItems} where ${transactionChecklistItems.transactionId}=${id}::uuid and ${transactionChecklistItems.stage}=${stage})`), sql` and `)}`;
}

/** The parent, client link, deadlines, receipt and required history share one commit. */
export async function createTransaction(ctx: TransactionContext, input: CreateTransactionInput, now = new Date()): Promise<ServiceResult<Transaction>> {
  const parsed = createTransactionSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  input = parsed.data;
  if (input.side === "gc") return createGeneralContractorTransaction(ctx, input, now);
  const requestId = input.requestId ?? randomUUID(), hash = createPayloadHash({ ...input }), replay = () => transactionWriteReplay(ctx, requestId, hash, "create", now);
  const previous = await replay(); if (previous) return previous;
  let contact: Awaited<ReturnType<typeof loadContact>> & { ok: true } | undefined;
  if (input.contactId) { const access = await loadContact(ctx, input.contactId); if (!access.ok || access.row.stage !== ELIGIBLE_STAGE) return await replay() ?? { ok: false, reason: "invalid_contact" }; contact = access; }
  const agentUserId = input.agentUserId && isPrivileged(ctx.actor) ? input.agentUserId : contact && isBrokerageAdmin(ctx.actor) ? contact.row.assignedAgentUserId : ctx.actor.userId;
  if (!canCreateFor(ctx.actor, agentUserId)) return { ok: false, reason: "forbidden" };
  if (contact && agentUserId !== contact.row.assignedAgentUserId && !isBrokerageAdmin(ctx.actor)) return { ok: false, reason: "invalid_contact" };
  if (agentUserId !== ctx.actor.userId && !(await canOwnRecords(ctx.db, agentUserId))) return { ok: false, reason: "invalid_assignee" };
  const id = randomUUID(), stage = input.contractExecutionDate ? "under_contract" : "opportunity", deadlines = initialDeadlines(input);
  // A closing date and its entered Closing milestone cannot disagree from the first save.
  if (deadlines.filter(d => d.kind === "closing").length > 1 || input.closingDate && deadlines.some(d => d.kind === "closing" && d.dueDate !== input.closingDate)) return { ok: false, reason: "closing_deadline_conflict" };
  const selectedClosing = input.closingDate ?? deadlines.find(d => d.kind === "closing")?.dueDate ?? null;
  const guard = sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${agentUserId}::uuid and ${dashboardUsers.status}='active' and ${dashboardUsers.role}<>'member') ${contact ? sql`and exists(select 1 from ${contacts} where ${contacts.id}=${contact.row.id}::uuid and ${visibleContacts(ctx.actor)} and ${contacts.stage}=${ELIGIBLE_STAGE} and ${contacts.assignedAgentUserId}=${contact.row.assignedAgentUserId}::uuid and date_trunc('milliseconds',${contacts.updatedAt})=${contact.row.updatedAt.toISOString()}::timestamptz)` : sql``}`;
  const clientRole = CLIENT_PARTY_ROLE[input.side], parties = [
    ...(contact ? [{ role: clientRole, displayName: contactDisplayName(contact.row), company: null, email: contact.row.email, phone: contact.row.phoneE164, isPrimary: true, contactId: contact.row.id }] : []),
    ...(input.parties ?? []).filter(p => !contact || p.role !== clientRole).map(p => ({ ...p, company: p.company ?? null, email: p.email ?? null, phone: p.phone ?? null, isPrimary: p.isPrimary ?? false, contactId: null })),
  ];
  const writes: TransactionWrite[] = transactionWriteLocks(ctx);
  if (contact) writes.push(ctx.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contact.row.id), visibleContacts(ctx.actor))).orderBy(contacts.id).for("update"));
  writes.push(ctx.db.insert(transactions).values({ id, brokerageKey: ctx.actor.brokerageKey, agentUserId: sql`case when ${guard} then ${agentUserId}::uuid else null end`, createdByUserId: ctx.actor.userId, updatedByUserId: ctx.actor.userId,
    transactionType: input.transactionType, side: input.side, stage, addressLine1: input.addressLine1, addressLine2: input.addressLine2 ?? null, city: input.city, state: input.state?.toUpperCase() ?? "FL", postalCode: input.postalCode ?? null,
    listingKey: input.listingKey ?? null, mlsNumber: input.mlsNumber ?? null, contractPriceCents: input.contractPriceCents ?? null, listPriceCents: input.listPriceCents ?? null, commissionRateBps: input.commissionRateBps ?? null, commissionFlatCents: input.commissionFlatCents ?? null, agentSplitBps: input.agentSplitBps ?? null,
    contractExecutionDate: input.contractExecutionDate ?? null, closingDate: selectedClosing, notes: input.notes ?? null, createdAt: now, updatedAt: now }));
  writes.push(ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId, transactionId: id, action: "create", payloadHash: hash, result: { transactionId: id, updatedAt: now.toISOString() }, createdAt: now }));
  if (parties.length) writes.push(ctx.db.insert(transactionParties).values(parties.map(p => ({ transactionId: id, role: p.role, displayName: p.displayName, company: p.company, email: p.email, phoneE164: p.phone, isPrimary: p.isPrimary, contactId: p.contactId, createdAt: now }))));
  if (deadlines.length) writes.push(ctx.db.insert(transactionDeadlines).values(deadlines.map((d, sortOrder) => ({ transactionId: id, kind: d.kind, label: d.label, dueDate: d.dueDate, note: d.note ?? null, sortOrder, createdAt: now, updatedAt: now }))));
  const safe = { stage, side: input.side, transactionType: input.transactionType };
  writes.push(ctx.db.insert(transactionEvents).values({ transactionId: id, actorUserId: ctx.actor.userId, eventType: "transaction_created", safeMetadata: safe, createdAt: now }), ctx.db.insert(auditEvents).values({ eventType: "transaction_created", actorUserId: ctx.actor.userId, safeMetadata: { transactionId: id, ...safe }, createdAt: now }));
  if (contact) writes.push(ctx.db.insert(auditEvents).values({ eventType: "contact_transaction_linked", actorUserId: ctx.actor.userId, safeMetadata: { contactId: contact.row.id, transactionId: id, mechanism: "create" }, createdAt: now }));
  try { await ctx.db.batch(writes as unknown as Parameters<Db["batch"]>[0]); }
  catch { const recovered = await replay(); if (recovered) return recovered; if (contact) { const latest = await loadContact(ctx, contact.row.id); if (!latest.ok || latest.row.stage !== ELIGIBLE_STAGE || !revisionMatches(latest.row.updatedAt, contact.row.updatedAt.toISOString())) return { ok: false, reason: "invalid_contact" }; } return { ok: false, reason: "unavailable" }; }
  return await replay() ?? { ok: false, reason: "unavailable" };
}

/**
 * How a stage change came to be made. The human is the actor either way.
 *
 * Only `manual` exists today — no AI capability proposes transaction stage
 * changes, and none is authorized. The parameter is here because the plan is
 * built to be reused: when one is eventually authorized, it appends its own
 * statement to these writes rather than growing a second writer.
 */
export type StageChangeMechanism = "manual" | "ai_assisted";

/** One statement in a batch. Drizzle's builders are thenable, not promises. */
type BatchWrite = Parameters<Db["batch"]>[0][number];

/**
 * A validated, authorized stage change that has NOT been written yet.
 *
 * `writes` is every statement the transition requires, ready for `db.batch`.
 * Returning them rather than performing them is what keeps one definition of
 * what a stage change means: a second caller adds a statement to this list
 * instead of reimplementing the authorization, the lifecycle rule and the
 * date handling around its own copy.
 */
export interface StageChangePlan {
  row: TransactionRow;
  from: TransactionStage;
  to: TransactionStage;
  writes: BatchWrite[];
}

/**
 * Authorize and validate a transaction stage change, and build its writes.
 *
 * Everything that decides whether the change may happen is here and only
 * here: visibility, write permission, and the lifecycle graph — which refuses
 * a same-stage move, so a no-op cannot write history claiming a change.
 *
 * The date handling is the existing behaviour, unchanged and deliberately so:
 * closing stamps `closed_date`, any other terminal stage stamps
 * `cancelled_date`, and neither is ever cleared — a date already recorded
 * survives a later move.
 */
export async function planStageChange(
  ctx: { actor: Actor; db: Db },
  id: string,
  to: TransactionStage,
  options: { mechanism?: StageChangeMechanism; metadata?: Record<string, unknown>; now?: Date; requestId?: string; expectedUpdatedAt?: string } = {}
): Promise<ServiceResult<StageChangePlan>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const now = options.now ?? new Date();
  const mechanism = options.mechanism ?? "manual";

  const rows = await ctx.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };
  if (row.side === "gc") return { ok: false, reason: "gc_not_configured" };
  const from = row.stage as TransactionStage;
  if (!isStage(to)) return { ok: false, reason: "invalid_transition" };
  if (!canTransition(from, to)) return { ok: false, reason: "invalid_transition" };

  const expected = options.expectedUpdatedAt ?? row.updatedAt.toISOString();
  if (!revisionMatches(row.updatedAt, expected)) return { ok: false, reason: "conflict" };
  const checklist = await transactionChecklistGate(ctx, id, from, to); if (!checklist.ok) return checklist;
  const requestId = options.requestId ?? randomUUID(), next = nextTransactionRevision(row, now);
  const hash = createPayloadHash({ id, stage: to, expectedUpdatedAt: options.expectedUpdatedAt });
  const guard = transactionRevisionGuard(ctx, row, expected);
  const today = calendarDayKey(now);
  // A manual change records exactly what it always recorded, so existing
  // history stays comparable.
  const extra = mechanism === "manual" ? {} : { mechanism, ...(options.metadata ?? {}) };
  const safe = scrub({ from, to, ...extra });

  return {
    ok: true,
    value: {
      row,
      from,
      to,
      writes: [
        ...transactionWriteLocks(ctx, id),
        ctx.db.select({ id: transactionChecklistItems.id }).from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, id)).orderBy(transactionChecklistItems.id).for("update"),
        ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(eq(transactionChecklistAttachments.transactionId, id)).orderBy(transactionChecklistAttachments.id).for("update"),
        ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId, transactionId: id, action: "stage", payloadHash: sql`case when exists(select 1 from ${transactions} where ${guard}) and ${checklistGateSql(id, from, to)} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString() }, createdAt: now }),
        ctx.db
          .update(transactions)
          .set({
            stage: to,
            updatedByUserId: ctx.actor.userId,
            updatedAt: next,
            closedDate: to === "closed" ? today : row.closedDate,
            cancelledDate: isTerminalStage(to) && to !== "closed" ? today : row.cancelledDate,
          })
          .where(guard),
        ctx.db.insert(transactionEvents).values({
          transactionId: row.id,
          actorUserId: ctx.actor.userId,
          eventType: "transaction_stage_changed",
          safeMetadata: safe,
        }),
        ctx.db.insert(auditEvents).values({
          eventType: "transaction_stage_changed",
          actorUserId: ctx.actor.userId,
          targetUserId: null,
          safeMetadata: safe ? { transactionId: row.id, ...safe } : { transactionId: row.id },
        }),
      ],
    },
  };
}

/**
 * Commit a stage change's writes as one transaction.
 *
 * `db.batch` maps onto the Neon HTTP client's `transaction(...)`, a real
 * server-side PostgreSQL transaction: every statement commits or none does.
 * Never issue these individually.
 */
export async function commitStageChange(db: Db, writes: BatchWrite[]): Promise<void> {
  await db.batch(writes as unknown as Parameters<Db["batch"]>[0]);
}

/**
 * Move a deal to another stage. The manual path, used by the pipeline UI.
 *
 * The three writes commit together. Previously the update ran alone and both
 * history writes sat inside one `try` that swallowed — so a failed event
 * insert took the audit insert down with it and reported success anyway,
 * leaving a deal whose stage had moved with nothing recording that it had.
 * On a record carrying money and deadlines, that is the write least able to
 * afford a silent gap. If the history cannot be recorded, the move does not
 * happen.
 */
export async function changeStage(
  ctx: { actor: Actor; db: Db },
  id: string,
  to: TransactionStage,
  now: Date = new Date(),
  options: { requestId?: string; expectedUpdatedAt?: string } = {}
): Promise<ServiceResult<Transaction>> {
  const hash = createPayloadHash({ id, stage: to, expectedUpdatedAt: options.expectedUpdatedAt });
  const replay = () => options.requestId ? transactionWriteReplay(ctx, options.requestId, hash, "stage", now) : Promise.resolve(null);
  const previous = await replay(); if (previous) return previous;
  const planned = await planStageChange(ctx, id, to, { mechanism: "manual", now, ...options });
  if (!planned.ok) return planned;

  try {
    await commitStageChange(ctx.db, planned.value.writes);
  } catch (error) {
    const recovered = await replay(); if (recovered) return recovered;
    const current = await getTransaction(ctx, id, now); if (!current) return { ok: false, reason: "not_found" };
    if (isTransactionGuardConflict(error) && current.stage === planned.value.from) { const gate = await transactionChecklistGate(ctx, id, current.stage, to); if (!gate.ok) return gate; }
    return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" };
  }

  const updated = await getTransaction(ctx, planned.value.row.id, now);
  return updated ? { ok: true, value: updated } : { ok: false, reason: "unavailable" };
}
