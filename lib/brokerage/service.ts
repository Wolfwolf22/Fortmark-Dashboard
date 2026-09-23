import "server-only";
/**
 * Brokerage identity — the database side.
 *
 * The tenant is always the caller's own brokerage, resolved from their
 * session row (`resolveActor`). Nothing from the request selects a brokerage:
 * the input schema refuses a `brokerageKey` outright, and every query here is
 * `where brokerage_key = actor.brokerageKey`.
 */
import { eq } from "drizzle-orm";
import { brokerageIdentities } from "../db/schema.ts";
import { resolveActor, type ActorFailure } from "../auth/actor.ts";
import { profileDatabaseEnabled, type EnvLike } from "../flags.ts";
import { writeAuditEvent } from "../profile/service.ts";
import {
  BROKERAGE_FIELDS,
  canEditBrokerage,
  changedFields,
  parseBrokerageInput,
  toBrokerageView,
  type BrokerageParse,
  type BrokerageValues,
  type BrokerageView,
} from "./identity.ts";

export type ReadResult =
  | { ok: true; identity: BrokerageView | null; canEdit: boolean; brokerageKey: string }
  | { ok: false; reason: ActorFailure };

export type WriteResult =
  | { ok: true; identity: BrokerageView; created: boolean }
  | { ok: false; reason: ActorFailure | "forbidden" }
  | { ok: false; reason: "invalid"; fieldErrors: Extract<BrokerageParse, { ok: false }>["fieldErrors"] };

function valuesOf(row: typeof brokerageIdentities.$inferSelect): BrokerageValues {
  return Object.fromEntries(BROKERAGE_FIELDS.map((f) => [f, row[f] ?? null])) as unknown as BrokerageValues;
}

export async function readBrokerage(clerkUserId: string, env: EnvLike = process.env): Promise<ReadResult> {
  const resolved = await resolveActor(clerkUserId, profileDatabaseEnabled(env));
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved;
  const rows = await db
    .select()
    .from(brokerageIdentities)
    .where(eq(brokerageIdentities.brokerageKey, actor.brokerageKey))
    .limit(1);
  const row = rows[0];
  return {
    ok: true,
    identity: row ? toBrokerageView(row) : null,
    canEdit: canEditBrokerage(actor.role),
    brokerageKey: actor.brokerageKey,
  };
}

export async function saveBrokerage(
  clerkUserId: string,
  raw: unknown,
  env: EnvLike = process.env
): Promise<WriteResult> {
  const resolved = await resolveActor(clerkUserId, profileDatabaseEnabled(env));
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved;
  // Authorisation before validation: a caller who may not edit learns nothing
  // about which of their values would have been accepted.
  if (!canEditBrokerage(actor.role)) return { ok: false, reason: "forbidden" };

  const parsed = parseBrokerageInput(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid", fieldErrors: parsed.fieldErrors };
  const next = parsed.value;

  const existing = (
    await db.select().from(brokerageIdentities).where(eq(brokerageIdentities.brokerageKey, actor.brokerageKey)).limit(1)
  )[0];
  const now = new Date();

  // One statement, keyed on the unique brokerage_key: two concurrent first
  // saves cannot create two identities.
  const saved = (
    await db
      .insert(brokerageIdentities)
      .values({
        brokerageKey: actor.brokerageKey,
        ...next,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: brokerageIdentities.brokerageKey,
        set: { ...next, updatedByUserId: actor.userId, updatedAt: now },
      })
      .returning()
  )[0];

  const changed = changedFields(existing ? valuesOf(existing) : null, next);
  await writeAuditEvent(existing ? "brokerage_identity_updated" : "brokerage_identity_created", {
    actorUserId: actor.userId,
    metadata: { brokerageKey: actor.brokerageKey, changedFields: changed },
  });

  return { ok: true, identity: toBrokerageView(saved), created: !existing };
}

/**
 * FortMark's MLS office id for the caller's brokerage, for the listings
 * routes. `null` means "not configured" — the FortMark-specific views say so
 * and never fall back to another office. `unavailable` means it could not be
 * determined (no dashboard identity yet, or the database is off), which the
 * same views also report rather than guess.
 */
export async function brokerageMlsOfficeId(
  clerkUserId: string,
  env: EnvLike = process.env
): Promise<{ ok: true; officeId: string | null } | { ok: false }> {
  try {
    const read = await readBrokerage(clerkUserId, env);
    if (!read.ok) return { ok: false };
    return { ok: true, officeId: read.identity?.mlsOfficeId ?? null };
  } catch {
    return { ok: false };
  }
}
