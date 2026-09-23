import "server-only";
/**
 * Brokerage identity — the database side.
 *
 * FortMark-only. There is one central record per brokerage key, and nothing
 * from a request selects a brokerage: the input schema refuses a
 * `brokerageKey`, and every query here is `where brokerage_key =
 * actor.brokerageKey`.
 *
 * Which MLS office is FortMark's is SYSTEM configuration
 * (`FORTMARK_MLS_OFFICE_ID`), not something a user types. The sync reads that
 * office's Office record and writes the system-managed columns; operator-owned
 * fields are never touched by it.
 */
import { eq } from "drizzle-orm";
import { brokerageIdentities } from "../db/schema.ts";
import { getDb } from "../db/client.ts";
import { resolveActor, type ActorFailure } from "../auth/actor.ts";
import { FORTMARK_BROKERAGE_KEY } from "../db/schema.ts";
import { profileDatabaseEnabled, type EnvLike } from "../flags.ts";
import { writeAuditEvent } from "../profile/service.ts";
import { resolveBridgeConfig } from "../mls/config.ts";
import { getOfficeRecord } from "../mls/member.ts";
import { toE164 } from "../profile/normalize.ts";
import {
  BROKERAGE_FIELDS,
  MLS_OFFICE_ID,
  canEditBrokerage,
  changedFields,
  parseBrokerageInput,
  toBrokerageView,
  type BrokerageParse,
  type BrokerageValues,
  type BrokerageView,
} from "./identity.ts";

// --- System configuration ------------------------------------------------------

/**
 * FortMark's MLS office id (set per environment), from server configuration.
 * Null when unset or malformed — FortMark-specific views then say "not
 * configured"; they never fall back to another office.
 */
export function fortmarkOfficeConfig(env: EnvLike = process.env): string | null {
  const v = env.FORTMARK_MLS_OFFICE_ID?.trim().toUpperCase();
  return v && MLS_OFFICE_ID.test(v) ? v : null;
}

/** How long a synced Office record is trusted before a read refreshes it. */
export const OFFICE_SYNC_TTL_MS = 24 * 60 * 60 * 1000;

// --- Read ----------------------------------------------------------------------

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

/** Whether the central record needs its MLS section refreshed. */
export function officeSyncDue(
  identity: Pick<BrokerageView, "mlsOfficeId" | "mlsSyncedAt"> | null,
  configured: string | null,
  now = Date.now()
): boolean {
  if (!configured) return false;
  if (!identity) return true;
  if (identity.mlsOfficeId !== configured) return true;
  if (!identity.mlsSyncedAt) return true;
  return now - new Date(identity.mlsSyncedAt).getTime() > OFFICE_SYNC_TTL_MS;
}

// --- Operator save ---------------------------------------------------------------

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
  // saves cannot create two identities. Only operator-owned columns are in
  // `next`; the system-managed MLS columns are never written from here.
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

// --- System sync -------------------------------------------------------------------

export type OfficeSyncResult =
  | { status: "synced"; changed: string[] }
  | { status: "not_configured" }
  | { status: "mls_not_configured" }
  | { status: "office_not_found" }
  | { status: "unavailable" };

/**
 * Refresh the central record's MLS section from the configured office's
 * Office record. Creates the central record if it does not exist yet (name
 * from the Office record — never invented). Idempotent; safe to call
 * concurrently (single upsert on the unique brokerage key).
 */
export async function syncFortmarkOffice(
  opts: { env?: EnvLike; signal?: AbortSignal; actorUserId?: string | null } = {}
): Promise<OfficeSyncResult> {
  const env = opts.env ?? process.env;
  const officeId = fortmarkOfficeConfig(env);
  if (!officeId) return { status: "not_configured" };
  const config = resolveBridgeConfig(env);
  if (!config.ok) return { status: "mls_not_configured" };
  if (!profileDatabaseEnabled(env)) return { status: "unavailable" };
  const db = getDb();
  if (!db) return { status: "unavailable" };

  let office;
  try {
    office = await getOfficeRecord(config.config, officeId, opts.signal);
  } catch {
    return { status: "unavailable" };
  }
  if (!office) return { status: "office_not_found" };

  const now = new Date();
  const mls = {
    mlsOfficeId: office.officeMlsId,
    mlsOfficeKey: office.officeKey,
    mlsOfficeName: office.name,
    mlsOfficePhone: office.phone ? (toE164(office.phone) ?? office.phone) : null,
    mlsSyncedAt: now,
  };

  try {
    const before = (
      await db.select().from(brokerageIdentities).where(eq(brokerageIdentities.brokerageKey, FORTMARK_BROKERAGE_KEY)).limit(1)
    )[0];
    if (!before && !office.name) return { status: "office_not_found" };
    await db
      .insert(brokerageIdentities)
      .values({
        brokerageKey: FORTMARK_BROKERAGE_KEY,
        displayName: office.name as string,
        ...mls,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: brokerageIdentities.brokerageKey, set: { ...mls, updatedAt: now } });

    const changed = (["mlsOfficeId", "mlsOfficeKey", "mlsOfficeName", "mlsOfficePhone"] as const).filter(
      (f) => (before ? before[f] : null) !== mls[f]
    );
    if (!before) changed.unshift("displayName" as never);
    if (changed.length > 0) {
      await writeAuditEvent("brokerage_mls_synced", {
        actorUserId: opts.actorUserId ?? null,
        metadata: { brokerageKey: FORTMARK_BROKERAGE_KEY, changedFields: changed, created: !before },
      });
    }
    return { status: "synced", changed };
  } catch (error) {
    console.error(`[brokerage] office sync failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return { status: "unavailable" };
  }
}

// --- Office id for listing queries ----------------------------------------------------

/**
 * FortMark's MLS office id for the FortMark-scoped listing views. System
 * configuration first; otherwise the central record's synced value. `null`
 * means "not configured" — never another office. Does not call the MLS.
 */
export async function brokerageMlsOfficeId(
  clerkUserId: string,
  env: EnvLike = process.env
): Promise<{ ok: true; officeId: string | null } | { ok: false }> {
  const configured = fortmarkOfficeConfig(env);
  if (configured) return { ok: true, officeId: configured };
  try {
    const read = await readBrokerage(clerkUserId, env);
    if (!read.ok) return { ok: false };
    return { ok: true, officeId: read.identity?.mlsOfficeId ?? null };
  } catch {
    return { ok: false };
  }
}
