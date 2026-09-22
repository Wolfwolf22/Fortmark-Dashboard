import "server-only";

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
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import {
  auditEvents,
  professionalProfiles,
  transactionDeadlines,
  transactionEvents,
  transactionParties,
  transactions,
  type TransactionRow,
} from "../db/schema.ts";
import { transactionsDatabaseEnabled, type EnvLike } from "../flags.ts";
import type { DateRange, Transaction, TransactionFilters, TransactionStage } from "../data/types.ts";
import { canOwnRecords, isPrivileged, resolveActor as resolveBrokerageActor, type Actor } from "../auth/actor.ts";
import {
  canCreateFor,
  canSee,
  canWrite,
  toTransaction,
  type CreateTransactionInput,
} from "./domain.ts";
import { canTransition, isTerminalStage } from "./stages.ts";

/** Keys that must never appear in event metadata. Same rule as audit. */
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

async function bundle(db: Db, rows: TransactionRow[], now: Date): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const agentIds = Array.from(new Set(rows.map((r) => r.agentUserId)));
  const [parties, deadlines, agents] = await Promise.all([
    db.select().from(transactionParties).where(inArray(transactionParties.transactionId, ids)),
    db.select().from(transactionDeadlines).where(inArray(transactionDeadlines.transactionId, ids)),
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
  const clauses = [visibleTo(ctx.actor)];
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
  return bundle(ctx.db, rows, now);
}

export async function getTransaction(
  ctx: { actor: Actor; db: Db },
  id: string,
  now: Date = new Date()
): Promise<Transaction | null> {
  const rows = await ctx.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), visibleTo(ctx.actor)))
    .limit(1);
  const row = rows[0];
  if (!row || !canSee(ctx.actor, row)) return null;
  return (await bundle(ctx.db, [row], now))[0] ?? null;
}

async function recordEvent(
  db: Db,
  transactionId: string,
  actorUserId: string,
  eventType: "transaction_created" | "transaction_updated" | "transaction_stage_changed",
  metadata?: Record<string, unknown>
): Promise<void> {
  const safe = scrub(metadata);
  try {
    await db.insert(transactionEvents).values({ transactionId, actorUserId, eventType, safeMetadata: safe });
    await db.insert(auditEvents).values({
      eventType,
      actorUserId,
      targetUserId: null,
      safeMetadata: safe ? { transactionId, ...safe } : { transactionId },
    });
  } catch {
    // History must never break the write it describes.
  }
}

export async function createTransaction(
  ctx: { actor: Actor; db: Db },
  input: CreateTransactionInput,
  now: Date = new Date()
): Promise<ServiceResult<Transaction>> {
  // Ownership: the actor, unless a privileged actor names someone else.
  const agentUserId =
    input.agentUserId && isPrivileged(ctx.actor) ? input.agentUserId : ctx.actor.userId;
  if (!canCreateFor(ctx.actor, agentUserId)) return { ok: false, reason: "forbidden" };
  // A named owner is a request-supplied id: it must be someone who can own work.
  if (agentUserId !== ctx.actor.userId && !(await canOwnRecords(ctx.db, agentUserId))) {
    return { ok: false, reason: "invalid_assignee" };
  }

  const inserted = await ctx.db
    .insert(transactions)
    .values({
      brokerageKey: ctx.actor.brokerageKey,
      agentUserId,
      createdByUserId: ctx.actor.userId,
      updatedByUserId: ctx.actor.userId,
      transactionType: input.transactionType,
      side: input.side,
      stage: input.contractExecutionDate ? "under_contract" : "opportunity",
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      city: input.city,
      state: input.state?.toUpperCase() ?? "FL",
      postalCode: input.postalCode ?? null,
      listingKey: input.listingKey ?? null,
      mlsNumber: input.mlsNumber ?? null,
      contractPriceCents: input.contractPriceCents ?? null,
      listPriceCents: input.listPriceCents ?? null,
      commissionRateBps: input.commissionRateBps ?? null,
      commissionFlatCents: input.commissionFlatCents ?? null,
      agentSplitBps: input.agentSplitBps ?? null,
      contractExecutionDate: input.contractExecutionDate ?? null,
      closingDate: input.closingDate ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  const row = inserted[0];
  if (!row) return { ok: false, reason: "unavailable" };

  if (input.parties?.length) {
    await ctx.db.insert(transactionParties).values(
      input.parties.map((p) => ({
        transactionId: row.id,
        role: p.role,
        displayName: p.displayName,
        company: p.company ?? null,
        email: p.email ?? null,
        phoneE164: p.phone ?? null,
        isPrimary: p.isPrimary ?? false,
      }))
    );
  }
  const deadlines = [...(input.deadlines ?? [])];
  // A scheduled closing is a deadline too, so it shows up in "coming up".
  if (input.closingDate && !deadlines.some((d) => d.kind === "closing")) {
    deadlines.push({ kind: "closing", label: "Closing", dueDate: input.closingDate });
  }
  if (deadlines.length) {
    await ctx.db.insert(transactionDeadlines).values(
      deadlines.map((d, i) => ({
        transactionId: row.id,
        kind: d.kind,
        label: d.label,
        dueDate: d.dueDate,
        note: d.note ?? null,
        sortOrder: i,
      }))
    );
  }
  await recordEvent(ctx.db, row.id, ctx.actor.userId, "transaction_created", {
    stage: row.stage,
    side: row.side,
    transactionType: row.transactionType,
  });
  const created = await getTransaction(ctx, row.id, now);
  return created ? { ok: true, value: created } : { ok: false, reason: "unavailable" };
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
  options: { mechanism?: StageChangeMechanism; metadata?: Record<string, unknown>; now?: Date } = {}
): Promise<ServiceResult<StageChangePlan>> {
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
  const from = row.stage as TransactionStage;
  if (!canTransition(from, to)) return { ok: false, reason: "invalid_transition" };

  const today = toDateOnly(now);
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
        ctx.db
          .update(transactions)
          .set({
            stage: to,
            updatedByUserId: ctx.actor.userId,
            updatedAt: now,
            closedDate: to === "closed" ? today : row.closedDate,
            cancelledDate: isTerminalStage(to) && to !== "closed" ? today : row.cancelledDate,
          })
          .where(eq(transactions.id, row.id)),
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
  now: Date = new Date()
): Promise<ServiceResult<Transaction>> {
  const planned = await planStageChange(ctx, id, to, { mechanism: "manual", now });
  if (!planned.ok) return planned;

  try {
    await commitStageChange(ctx.db, planned.value.writes);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const updated = await getTransaction(ctx, planned.value.row.id, now);
  return updated ? { ok: true, value: updated } : { ok: false, reason: "unavailable" };
}
