import "server-only";

/**
 * Prepared actions: propose, confirm, execute.
 *
 * The whole safety argument of F2 lives in this file, and it rests on one
 * structural fact: **preparing writes only to `ai_prepared_actions`, and
 * executing is not reachable from a model.** `prepare` is called by a tool;
 * `execute` is called by a route the model has never been told exists and has
 * no way to name.
 *
 * Between the two, time passes. So execution does not trust a single thing
 * preparation concluded: it re-resolves the actor, re-reads the target under
 * the same visibility predicate, re-checks the domain rule, and re-computes
 * the dependency fingerprint. The only thing it takes from the row is the
 * instruction.
 *
 * Everything that decides what happens — actor, brokerage, target, payload —
 * is a column here. The browser sends an id and nothing else, so there is no
 * field in the request a caller could tamper with.
 */
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveActor, type Actor } from "../../auth/actor.ts";
import type { Db } from "../../db/client.ts";
import { aiPreparedActions, auditEvents, contactActivities, contacts } from "../../db/schema.ts";
import { aiActionsEnabled, contactsDatabaseEnabled, type EnvLike } from "../../flags.ts";
import { commitStageChange, planStageChange } from "../../contacts/service.ts";
import type { LeadStage } from "../../data/types.ts";
import {
  isAiProposableStage,
  stageChange,
  stageFingerprint,
  stageIsAiManageable,
  stageSummary,
  stageWarnings,
  STAGE_ACTION_TYPE,
} from "./stage.ts";
import { scrubMetadata } from "../../audit/metadata.ts";
import { visibleTo } from "../../contacts/service.ts";
import { ACTION_TTL_MS, type PreparedAction } from "./contract.ts";
import {
  checkFollowUpDay,
  contactDisplayName,
  followUpChange,
  followUpFingerprint,
  followUpInstant,
  followUpWarnings,
  formatFollowUpDay,
  FOLLOWUP_ACTION_TYPE,
} from "./followup.ts";

export interface ActionContext {
  clerkUserId: string;
  env: EnvLike;
  now: Date;
}

type Ctx = { actor: Actor; db: Db };

export type PrepareFailureReason =
  | "not_configured"
  | "not_permitted"
  | "not_found"
  | "invalid_date"
  | "date_in_past"
  | "date_too_far"
  // Stage-specific. `invalid_transition` means the DOMAIN refuses the move;
  // `archived_not_supported` means the domain would allow it but this phase
  // does not expose it to a model. Collapsing the two would tell a user their
  // lifecycle forbids something the Leads screen does every day.
  | "invalid_transition"
  | "already_in_stage"
  | "archived_not_supported"
  | "unavailable";

export type PrepareResult =
  | { ok: true; action: PreparedAction }
  | { ok: false; reason: PrepareFailureReason };

export type ExecuteFailureReason =
  | "not_configured"
  | "not_permitted"
  | "not_found"
  | "expired"
  | "stale"
  | "already_cancelled"
  | "in_progress"
  | "unavailable";

export type ExecuteResult =
  | { ok: true; action: PreparedAction; alreadyExecuted: boolean }
  | { ok: false; reason: ExecuteFailureReason };

/** Resolve the caller, or say why not. Actions need contacts to be live. */
async function contactsCtx(ctx: ActionContext): Promise<{ ok: true; ctx: Ctx } | { ok: false; reason: "not_configured" | "not_permitted" | "unavailable" }> {
  if (!aiActionsEnabled(ctx.env)) return { ok: false, reason: "not_configured" };
  const resolved = await resolveActor(ctx.clerkUserId, contactsDatabaseEnabled(ctx.env));
  if (resolved.ok) return { ok: true, ctx: { actor: resolved.actor, db: resolved.db } };
  if (resolved.reason === "disabled") return { ok: false, reason: "not_configured" };
  if (resolved.reason === "no_identity") return { ok: false, reason: "not_permitted" };
  return { ok: false, reason: "unavailable" };
}

/** The row, as the browser may see it. No payload, no actor, no brokerage. */
function toPreparedAction(row: typeof aiPreparedActions.$inferSelect): PreparedAction {
  const preview = row.preview as {
    entity: PreparedAction["entity"];
    summary: string;
    changes: PreparedAction["changes"];
    warnings: string[];
  };
  return {
    actionId: row.id,
    type: row.actionType as PreparedAction["type"],
    // A follow-up moves one date. A stage change moves a headline metric.
    risk: row.actionType === STAGE_ACTION_TYPE ? "moderate" : "low",
    entity: preview.entity,
    summary: preview.summary,
    changes: preview.changes,
    warnings: preview.warnings ?? [],
    status: row.status,
    preparedAt: row.preparedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    confirmationRequired: true,
  };
}

// --- Prepare -----------------------------------------------------------------

/**
 * Propose a follow-up date for one contact.
 *
 * Nothing about the contact changes. The only write is the proposal row, and
 * no proposal row is written on any failure path — a rejected preparation
 * leaves the database exactly as it found it.
 */
export async function prepareFollowup(
  ctx: ActionContext,
  input: { contactId: string; day: string }
): Promise<PrepareResult> {
  const resolved = await contactsCtx(ctx);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved.ctx;

  // Validate the date BEFORE touching the contact: an invalid request should
  // not even reveal whether the id exists.
  const day = checkFollowUpDay(input.day, ctx.now);
  if (!day.ok) {
    return {
      ok: false,
      reason:
        day.reason === "in_the_past"
          ? "date_in_past"
          : day.reason === "too_far_ahead"
            ? "date_too_far"
            : "invalid_date",
    };
  }

  let row;
  try {
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), visibleTo(actor)))
      .limit(1);
    row = rows[0];
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  // Out of scope and non-existent are the same answer, deliberately: the
  // absence of an error must never confirm that a record exists.
  if (!row) return { ok: false, reason: "not_found" };

  const change = followUpChange(row, day.day);
  const entity = { type: "contact" as const, id: row.id, displayName: contactDisplayName(row) };
  const preview = {
    entity,
    summary: `Schedule a follow-up with ${entity.displayName} for ${formatFollowUpDay(day.day)}`,
    changes: [change],
    warnings: followUpWarnings(row),
  };

  const id = randomUUID();
  const expiresAt = new Date(ctx.now.getTime() + ACTION_TTL_MS);
  try {
    await db.insert(aiPreparedActions).values({
      id,
      brokerageKey: actor.brokerageKey,
      actorUserId: actor.userId,
      actionType: FOLLOWUP_ACTION_TYPE,
      targetType: "contact",
      targetId: row.id,
      payload: { followUpAt: followUpInstant(day.day), day: day.day },
      preview,
      expectedFingerprint: followUpFingerprint(row),
      status: "prepared",
      preparedAt: ctx.now,
      expiresAt,
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    action: {
      actionId: id,
      type: FOLLOWUP_ACTION_TYPE,
      risk: "low",
      entity,
      summary: preview.summary,
      changes: preview.changes,
      warnings: preview.warnings,
      status: "prepared",
      preparedAt: ctx.now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      confirmationRequired: true,
    },
  };
}

/**
 * Propose moving a contact to another lifecycle stage.
 *
 * The model supplies a contact and a destination. Everything else — who is
 * acting, what stage the contact is in now, whether the move is permitted —
 * is read from the database here. `fromStage` is never an input, so a model
 * cannot propose a transition premised on a stage the contact left.
 *
 * Validity is `planStageChange`'s answer, not this module's: it applies the
 * same visibility, write permission and lifecycle graph the Leads screen
 * applies. Nothing is written by preparing.
 */
export async function prepareStageChange(
  ctx: ActionContext,
  input: { contactId: string; toStage: string }
): Promise<PrepareResult> {
  const resolved = await contactsCtx(ctx);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved.ctx;

  // Phase scope, checked before the record is touched: an unsupported
  // destination must not reveal whether the contact exists.
  if (!isAiProposableStage(input.toStage)) {
    return { ok: false, reason: "archived_not_supported" };
  }

  let row;
  try {
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), visibleTo(actor)))
      .limit(1);
    row = rows[0];
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!row) return { ok: false, reason: "not_found" };

  // Defence in depth: the same scope rule applied to where the contact IS.
  // A model that guesses a live id still cannot move an archived contact.
  if (!stageIsAiManageable(row.stage)) {
    return { ok: false, reason: "archived_not_supported" };
  }
  // A no-op is not a change, and a confirmation card for one would be noise.
  if (row.stage === input.toStage) return { ok: false, reason: "already_in_stage" };

  // The domain decides. This is the same call the Leads screen makes, and its
  // writes are discarded here — preparing must not mutate anything.
  const planned = await planStageChange(
    { actor, db },
    row.id,
    input.toStage as LeadStage,
    { mechanism: "ai_assisted", now: ctx.now }
  );
  if (!planned.ok) {
    if (planned.reason === "not_found" || planned.reason === "forbidden") {
      return { ok: false, reason: "not_found" };
    }
    if (planned.reason === "invalid_transition") {
      return { ok: false, reason: "invalid_transition" };
    }
    return { ok: false, reason: "unavailable" };
  }

  const entity = { type: "contact" as const, id: row.id, displayName: contactDisplayName(row) };
  const preview = {
    entity,
    summary: stageSummary(entity.displayName, row.stage, input.toStage),
    changes: [stageChange(row.stage, input.toStage)],
    warnings: stageWarnings(row, input.toStage),
  };

  const id = randomUUID();
  const expiresAt = new Date(ctx.now.getTime() + ACTION_TTL_MS);
  try {
    await db.insert(aiPreparedActions).values({
      id,
      brokerageKey: actor.brokerageKey,
      actorUserId: actor.userId,
      actionType: STAGE_ACTION_TYPE,
      targetType: "contact",
      targetId: row.id,
      payload: { toStage: input.toStage, fromStage: row.stage },
      preview,
      expectedFingerprint: stageFingerprint(row),
      status: "prepared",
      preparedAt: ctx.now,
      expiresAt,
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    action: {
      actionId: id,
      type: STAGE_ACTION_TYPE,
      risk: "moderate",
      entity,
      summary: preview.summary,
      changes: preview.changes,
      warnings: preview.warnings,
      status: "prepared",
      preparedAt: ctx.now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      confirmationRequired: true,
    },
  };
}

// --- Read --------------------------------------------------------------------

/** One action, for the card. Scoped to its own actor and brokerage. */
export async function getPreparedAction(
  ctx: ActionContext,
  actionId: string
): Promise<{ ok: true; action: PreparedAction } | { ok: false; reason: "not_configured" | "not_permitted" | "not_found" | "unavailable" }> {
  const resolved = await contactsCtx(ctx);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved.ctx;
  try {
    const rows = await db
      .select()
      .from(aiPreparedActions)
      .where(
        and(
          eq(aiPreparedActions.id, actionId),
          eq(aiPreparedActions.actorUserId, actor.userId),
          eq(aiPreparedActions.brokerageKey, actor.brokerageKey)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, action: expireIfLapsed(toPreparedAction(row), ctx.now) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Actions still awaiting this caller. What the thread renders as cards. */
export async function listPendingActions(
  ctx: ActionContext
): Promise<{ ok: true; actions: PreparedAction[] } | { ok: false; reason: "not_configured" | "not_permitted" | "unavailable" }> {
  const resolved = await contactsCtx(ctx);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved.ctx;
  try {
    const rows = await db
      .select()
      .from(aiPreparedActions)
      .where(
        and(
          eq(aiPreparedActions.actorUserId, actor.userId),
          eq(aiPreparedActions.brokerageKey, actor.brokerageKey),
          eq(aiPreparedActions.status, "prepared"),
          sql`${aiPreparedActions.expiresAt} > ${ctx.now}`
        )
      )
      .orderBy(aiPreparedActions.preparedAt);
    return { ok: true, actions: rows.map(toPreparedAction) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** A lapsed row still reads `prepared`; the clock is what expires it. */
function expireIfLapsed(action: PreparedAction, now: Date): PreparedAction {
  if (action.status !== "prepared") return action;
  return new Date(action.expiresAt).getTime() <= now.getTime()
    ? { ...action, status: "expired" }
    : action;
}

// --- Cancel ------------------------------------------------------------------

/**
 * Decline a proposal.
 *
 * Persisted rather than dismissed in the browser: "the assistant suggested
 * this and a person said no" is part of the record, and a client-only dismiss
 * would leave the row confirmable by anyone who kept the id.
 */
export async function cancelPreparedAction(
  ctx: ActionContext,
  actionId: string
): Promise<{ ok: true } | { ok: false; reason: "not_configured" | "not_permitted" | "not_found" | "unavailable" }> {
  const resolved = await contactsCtx(ctx);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved.ctx;
  try {
    const rows = await db
      .update(aiPreparedActions)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(aiPreparedActions.id, actionId),
          eq(aiPreparedActions.actorUserId, actor.userId),
          eq(aiPreparedActions.brokerageKey, actor.brokerageKey),
          eq(aiPreparedActions.status, "prepared")
        )
      )
      .returning({ id: aiPreparedActions.id });
    return rows[0] ? { ok: true } : { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// --- Execute -----------------------------------------------------------------

/**
 * Commit a proposal a human confirmed.
 *
 * Reachable only from `POST /api/ai/actions/:id/execute`. No tool names it, no
 * provider is told it exists, and no amount of instruction-following produces
 * a call to it.
 *
 * The claim below is both the mutex and the idempotency key. A conditional
 * update from `prepared` to `executing` can succeed exactly once, so two
 * confirmations racing each other produce one execution and one answer about
 * it — decided by the database, not by a disabled button.
 */
export async function executePreparedAction(
  ctx: ActionContext,
  actionId: string
): Promise<ExecuteResult> {
  const resolved = await contactsCtx(ctx);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved.ctx;

  let claimed;
  try {
    const rows = await db
      .update(aiPreparedActions)
      .set({ status: "executing" })
      .where(
        and(
          eq(aiPreparedActions.id, actionId),
          eq(aiPreparedActions.actorUserId, actor.userId),
          eq(aiPreparedActions.brokerageKey, actor.brokerageKey),
          eq(aiPreparedActions.status, "prepared"),
          sql`${aiPreparedActions.expiresAt} > ${ctx.now}`
        )
      )
      .returning();
    claimed = rows[0];
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (!claimed) return await explainUnclaimable(ctx, { actor, db }, actionId);

  // Between preparation and this moment the record may have moved. Nothing
  // below trusts what preparation concluded.
  let contact;
  try {
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, claimed.targetId), visibleTo(actor)))
      .limit(1);
    contact = rows[0];
  } catch {
    await release(db, actionId, "failed", "unavailable");
    return { ok: false, reason: "unavailable" };
  }

  // Authorization is re-established, not inherited: a role or an assignment
  // can have changed since the card was rendered.
  if (!contact) {
    await release(db, actionId, "failed", "not_found");
    return { ok: false, reason: "not_found" };
  }

  // Each action type depends on different fields, so each recomputes its own
  // fingerprint. A follow-up is invalidated by the follow-up moving; a stage
  // change by the stage moving.
  const fingerprint =
    claimed.actionType === STAGE_ACTION_TYPE
      ? stageFingerprint(contact)
      : followUpFingerprint(contact);
  if (fingerprint !== claimed.expectedFingerprint) {
    await release(db, actionId, "stale", "stale");
    return { ok: false, reason: "stale" };
  }

  if (claimed.actionType === STAGE_ACTION_TYPE) {
    return await executeStageChange(ctx, { actor, db }, claimed, contact);
  }

  const payload = claimed.payload as { followUpAt: string; day: string };
  const followUpAt = new Date(payload.followUpAt);

  // One atomic unit: the mutation, the CRM activity a person would expect to
  // see, the audit record naming the human who confirmed it, and the action's
  // own transition. `db.batch` sends these as one Neon HTTP transaction, so
  // either all four land or none do — no contact left changed without its
  // history, and no action marked executed without its mutation.
  try {
    await db.batch([
      db
        .update(contacts)
        .set({ nextFollowUpAt: followUpAt, updatedByUserId: actor.userId, updatedAt: ctx.now })
        .where(eq(contacts.id, contact.id)),
      db.insert(contactActivities).values({
        contactId: contact.id,
        actorUserId: actor.userId,
        kind: "task",
        summary: `Follow-up scheduled for ${formatFollowUpDay(payload.day)}`,
        occurredAt: ctx.now,
        safeMetadata: { mechanism: "ai_assisted", preparedActionId: actionId },
      }),
      db.insert(auditEvents).values({
        actorUserId: actor.userId,
        targetUserId: null,
        eventType: "contact_updated",
        // The human is the actor. The model prepared; it did not decide.
        //
        // What changed, not what it changed to: the audit row names the field
        // and the action, and the follow-up date itself lives on the contact
        // and its activity, where it belongs.
        safeMetadata: scrubMetadata({
          mechanism: "ai_assisted",
          preparedActionId: actionId,
          actionType: FOLLOWUP_ACTION_TYPE,
          targetType: "contact",
          targetId: contact.id,
          field: "nextFollowUpAt",
        }),
      }),
      db
        .update(aiPreparedActions)
        .set({ status: "executed", executedAt: ctx.now })
        .where(eq(aiPreparedActions.id, actionId)),
    ]);
  } catch {
    // The transaction rolled back: the contact is untouched, no activity was
    // written, and the action must not read as done.
    await release(db, actionId, "failed", "unavailable");
    return { ok: false, reason: "unavailable" };
  }

  // Reported from the row we already hold, not from a fresh read: the commit
  // has happened, and a read that failed here would otherwise report failure
  // for a mutation that is durably in the database.
  return {
    ok: true,
    action: toPreparedAction({ ...claimed, status: "executed", executedAt: ctx.now }),
    alreadyExecuted: false,
  };
}

/**
 * Commit a confirmed stage change.
 *
 * The transition is re-planned from scratch rather than replayed from the
 * prepared row: `planStageChange` re-checks visibility, write permission and
 * the lifecycle graph against the record as it stands now, and returns the
 * writes. This module adds one statement — the action's own transition — and
 * commits all four together.
 *
 * That is what keeps the two paths identical. The stage update, the CRM
 * activity and the audit event are built by the domain service, so an
 * AI-confirmed change and a Leads-screen change cannot drift apart; only the
 * metadata differs, and only to record how the change was reached.
 */
async function executeStageChange(
  ctx: ActionContext,
  { actor, db }: Ctx,
  claimed: typeof aiPreparedActions.$inferSelect,
  contact: typeof contacts.$inferSelect
): Promise<ExecuteResult> {
  const payload = claimed.payload as { toStage: string; fromStage: string };

  // The phase scope is re-checked at execution too: an action prepared before
  // the scope existed, or a contact archived in the meantime, must not commit.
  if (!isAiProposableStage(payload.toStage) || !stageIsAiManageable(contact.stage)) {
    await release(db, claimed.id, "failed", "archived_not_supported");
    return { ok: false, reason: "not_permitted" };
  }

  const planned = await planStageChange({ actor, db }, contact.id, payload.toStage as LeadStage, {
    mechanism: "ai_assisted",
    metadata: { preparedActionId: claimed.id },
    now: ctx.now,
  });
  if (!planned.ok) {
    // The domain refuses it now even though it allowed it at preparation —
    // the record moved underneath, which is staleness by another name.
    const stale = planned.reason === "invalid_transition";
    await release(db, claimed.id, stale ? "stale" : "failed", planned.reason);
    return { ok: false, reason: stale ? "stale" : "not_found" };
  }

  try {
    await commitStageChange(db, [
      ...planned.value.writes,
      db
        .update(aiPreparedActions)
        .set({ status: "executed", executedAt: ctx.now })
        .where(eq(aiPreparedActions.id, claimed.id)),
    ]);
  } catch {
    // Rolled back: the stage is unchanged, no activity, no audit, and the
    // action must not read as done.
    await release(db, claimed.id, "failed", "unavailable");
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    action: toPreparedAction({ ...claimed, status: "executed", executedAt: ctx.now }),
    alreadyExecuted: false,
  };
}

/** Why a claim failed — the idempotent and terminal answers. */
async function explainUnclaimable(
  ctx: ActionContext,
  { actor, db }: Ctx,
  actionId: string
): Promise<ExecuteResult> {
  let row;
  try {
    const rows = await db
      .select()
      .from(aiPreparedActions)
      .where(
        and(
          eq(aiPreparedActions.id, actionId),
          eq(aiPreparedActions.actorUserId, actor.userId),
          eq(aiPreparedActions.brokerageKey, actor.brokerageKey)
        )
      )
      .limit(1);
    row = rows[0];
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  // Another actor's action, another brokerage's, or none at all — one answer.
  if (!row) return { ok: false, reason: "not_found" };

  switch (row.status) {
    case "executed":
      // The prior result, indistinguishable from the first. A browser retrying
      // after a timeout must not be able to schedule twice.
      return { ok: true, action: toPreparedAction(row), alreadyExecuted: true };
    case "executing":
      return { ok: false, reason: "in_progress" };
    case "cancelled":
      return { ok: false, reason: "already_cancelled" };
    case "stale":
      return { ok: false, reason: "stale" };
    case "prepared":
      // It exists and is prepared, so the claim failed on the clock.
      return { ok: false, reason: "expired" };
    default:
      return { ok: false, reason: "expired" };
  }
}

/** Put a claimed action into a terminal state when execution cannot proceed. */
async function release(
  db: Db,
  actionId: string,
  status: "failed" | "stale" | "expired",
  reason: string
): Promise<void> {
  try {
    await db
      .update(aiPreparedActions)
      .set({ status, failureReason: reason })
      .where(eq(aiPreparedActions.id, actionId));
  } catch {
    // Nothing further to do: the mutation did not happen, which is the
    // property that matters. A row stuck in `executing` expires on its own.
  }
}
