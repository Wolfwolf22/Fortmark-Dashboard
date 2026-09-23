import "server-only";
/**
 * Agent MLS identity — the server side.
 *
 * Flow: professional licence (profile) → Member roster lookup → FortMark
 * office check → stored stable identifiers (`mls_member_links`). Later
 * requests (My Listings, Home) read the stored MemberKey; the MLS roster is
 * asked again only when the licence changes or someone asks for a refresh.
 *
 * Boundaries:
 *   - Access to FortMark is Clerk + allowlist. Nothing here grants or removes
 *     access; an MLS outage only switches MLS-linked features off.
 *   - Never creates dashboard users from the roster.
 *   - Nothing from the Member record reaches the browser except the state
 *     and, for broker/admin views, the MLS member id.
 */
import { and, eq, ne } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { brokerageIdentities, mlsMemberLinks, professionalProfiles, FORTMARK_BROKERAGE_KEY } from "../db/schema.ts";
import { resolveActor } from "../auth/actor.ts";
import { profileDatabaseEnabled, type EnvLike } from "../flags.ts";
import { writeAuditEvent } from "../profile/service.ts";
import { resolveBridgeConfig } from "../mls/config.ts";
import { findMembersByLicense } from "../mls/member.ts";
import { fortmarkOfficeConfig, officeSyncDue, syncFortmarkOffice } from "../brokerage/service.ts";
import {
  RESOLVABLE_LICENSE_STATES,
  classifyMembers,
  licenseCandidates,
  linkMatchesLicense,
  normalizeLicense,
  type MlsIdentityState,
  type MlsIdentityView,
  type MlsLinkStatus,
} from "./rules.ts";

type LinkRow = typeof mlsMemberLinks.$inferSelect;
interface LicenceFields {
  licenseNumber: string | null;
  licenseState: string | null;
}

/** The resolver's deadline. One roster request; a slow MLS must not stall a save. */
const RESOLVE_TIMEOUT_MS = 6_000;

async function profileLicence(db: Db, userId: string): Promise<LicenceFields> {
  const row = (
    await db
      .select({ licenseNumber: professionalProfiles.licenseNumber, licenseState: professionalProfiles.licenseState })
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, userId))
      .limit(1)
  )[0];
  return { licenseNumber: row?.licenseNumber ?? null, licenseState: row?.licenseState ?? null };
}

async function linkRow(db: Db, userId: string): Promise<LinkRow | null> {
  return (await db.select().from(mlsMemberLinks).where(eq(mlsMemberLinks.userId, userId)).limit(1))[0] ?? null;
}

async function fortmarkOfficeName(db: Db): Promise<string | null> {
  const row = (
    await db
      .select({ displayName: brokerageIdentities.displayName, mlsOfficeName: brokerageIdentities.mlsOfficeName })
      .from(brokerageIdentities)
      .where(eq(brokerageIdentities.brokerageKey, FORTMARK_BROKERAGE_KEY))
      .limit(1)
  )[0];
  return row?.displayName ?? row?.mlsOfficeName ?? null;
}

/** The state a stored link represents for the profile's CURRENT licence. */
export function stateFor(link: LinkRow | null, licence: LicenceFields): MlsIdentityState {
  if (!normalizeLicense(licence.licenseNumber)) return "no_license";
  if (!link) return "stale";
  if (!linkMatchesLicense(link, licence)) return "stale";
  return link.status as MlsLinkStatus;
}

export function toIdentityView(
  link: LinkRow | null,
  licence: LicenceFields,
  officeName: string | null,
  includeMemberId: boolean
): MlsIdentityView {
  const state = stateFor(link, licence);
  const linked = state === "linked";
  return {
    state,
    linked,
    officeName: linked ? officeName : null,
    checkedAt: link?.checkedAt ? new Date(link.checkedAt).toISOString() : null,
    ...(includeMemberId ? { memberMlsId: link?.memberMlsId ?? null } : {}),
  };
}

// --- Resolve -------------------------------------------------------------------------

export interface ResolveOutcome {
  state: MlsIdentityState;
}

/**
 * Resolve `userId`'s MLS identity from the licence currently on their
 * profile and store the result. Never throws: an MLS failure is stored as
 * `unavailable` (and any previous member is dropped — a link must describe
 * the current licence or nothing).
 */
export async function resolveMlsIdentity(
  userId: string,
  opts: { env?: EnvLike; signal?: AbortSignal; actorUserId?: string | null } = {}
): Promise<ResolveOutcome> {
  const env = opts.env ?? process.env;
  if (!profileDatabaseEnabled(env)) return { state: "unavailable" };
  const db = getDb();
  if (!db) return { state: "unavailable" };

  const licence = await profileLicence(db, userId);
  const number = normalizeLicense(licence.licenseNumber);
  const state = licence.licenseState?.trim().toUpperCase() || null;

  if (!number) {
    // No licence, no link: a previous member must not outlive the licence.
    await db.delete(mlsMemberLinks).where(eq(mlsMemberLinks.userId, userId));
    return { state: "no_license" };
  }

  let status: MlsLinkStatus;
  let member: { memberKey: string | null; memberMlsId: string | null; officeMlsId: string | null } = {
    memberKey: null,
    memberMlsId: null,
    officeMlsId: null,
  };
  let candidateCount = 0;

  const config = resolveBridgeConfig(env);
  if (state && !RESOLVABLE_LICENSE_STATES.includes(state)) {
    // This MLS is Florida's; another state's licence cannot be in its roster.
    status = "not_found";
  } else if (!config.ok) {
    status = "unavailable";
  } else {
    const signal = opts.signal ?? AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
    try {
      const members = await findMembersByLicense(config.config, licenseCandidates(number), signal);
      const r = classifyMembers(members, fortmarkOfficeConfig(env));
      status = r.status;
      candidateCount = r.candidateCount;
      if (r.status === "linked" || r.status === "office_mismatch") {
        member = { memberKey: r.memberKey, memberMlsId: r.memberMlsId, officeMlsId: r.officeMlsId };
      }
    } catch (error) {
      console.error(`[mls-identity] roster lookup failed${error instanceof Error ? `: ${error.name}` : ""}`);
      status = "unavailable";
    }
  }

  // One MLS member, one FortMark account. A second account claiming the same
  // member is held for a broker rather than shown someone else's listings.
  if (status === "linked" && member.memberKey) {
    const other = (
      await db
        .select({ userId: mlsMemberLinks.userId })
        .from(mlsMemberLinks)
        .where(and(eq(mlsMemberLinks.memberKey, member.memberKey), eq(mlsMemberLinks.status, "linked"), ne(mlsMemberLinks.userId, userId)))
        .limit(1)
    )[0];
    if (other) status = "conflict";
  }

  const now = new Date();
  const keep = status === "linked" || status === "office_mismatch" || status === "conflict";
  const values = {
    status,
    licenseNumber: number,
    licenseState: state,
    memberKey: keep ? member.memberKey : null,
    memberMlsId: keep ? member.memberMlsId : null,
    officeMlsId: keep ? member.officeMlsId : null,
    candidateCount,
    checkedAt: now,
    linkedAt: status === "linked" ? now : null,
    updatedAt: now,
  };
  await db
    .insert(mlsMemberLinks)
    .values({ userId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: mlsMemberLinks.userId, set: values });

  // Status and counts only — never the licence or a roster field.
  await writeAuditEvent("mls_identity_resolved", {
    actorUserId: opts.actorUserId ?? userId,
    targetUserId: userId,
    metadata: { status, candidateCount },
  });

  // A FortMark member was just confirmed: make sure the central record's MLS
  // section exists and is current.
  if (status === "linked") {
    const brokerage = (
      await db
        .select({ mlsOfficeId: brokerageIdentities.mlsOfficeId, mlsSyncedAt: brokerageIdentities.mlsSyncedAt })
        .from(brokerageIdentities)
        .where(eq(brokerageIdentities.brokerageKey, FORTMARK_BROKERAGE_KEY))
        .limit(1)
    )[0];
    const view = brokerage
      ? { mlsOfficeId: brokerage.mlsOfficeId, mlsSyncedAt: brokerage.mlsSyncedAt?.toISOString() ?? null }
      : null;
    if (officeSyncDue(view, fortmarkOfficeConfig(env))) await syncFortmarkOffice({ env });
  }

  return { state: status };
}

/**
 * Re-resolve after a profile save, but only when the licence actually
 * changed (or was never resolved). Never throws; a failure leaves the saved
 * profile intact and the link `unavailable`.
 */
export async function resolveIfLicenceChanged(userId: string, env: EnvLike = process.env): Promise<MlsIdentityState | null> {
  try {
    if (!profileDatabaseEnabled(env)) return null;
    const db = getDb();
    if (!db) return null;
    const [licence, link] = await Promise.all([profileLicence(db, userId), linkRow(db, userId)]);
    const current = stateFor(link, licence);
    if (current !== "stale" && !(current === "no_license" && link)) return null;
    return (await resolveMlsIdentity(userId, { env })).state;
  } catch (error) {
    console.error(`[mls-identity] resolve after save failed${error instanceof Error ? `: ${error.name}` : ""}`);
    return "unavailable";
  }
}

// --- Read --------------------------------------------------------------------------------

export type IdentityRead =
  | { ok: true; view: MlsIdentityView }
  | { ok: false; reason: "disabled" | "no_identity" | "unavailable" };

/** The caller's own MLS identity, as the browser may see it. */
export async function readOwnMlsIdentity(clerkUserId: string, env: EnvLike = process.env): Promise<IdentityRead> {
  const resolved = await resolveActor(clerkUserId, profileDatabaseEnabled(env));
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved;
  const [licence, link, officeName] = await Promise.all([
    profileLicence(db, actor.userId),
    linkRow(db, actor.userId),
    fortmarkOfficeName(db),
  ]);
  const privileged = actor.role === "admin" || actor.role === "broker";
  return { ok: true, view: toIdentityView(link, licence, officeName, privileged) };
}

/**
 * The stable identifiers My Listings uses, or why there are none. Only a
 * `linked` row whose licence still matches the profile qualifies.
 */
export type ListingIdentity =
  | { ok: true; memberKey: string; memberMlsId: string | null }
  | { ok: false; state: MlsIdentityState | "unavailable" };

export async function listingIdentityFor(userId: string, db: Db): Promise<ListingIdentity> {
  try {
    const [licence, link] = await Promise.all([profileLicence(db, userId), linkRow(db, userId)]);
    const state = stateFor(link, licence);
    if (state !== "linked" || !link?.memberKey) return { ok: false, state };
    return { ok: true, memberKey: link.memberKey, memberMlsId: link.memberMlsId };
  } catch {
    return { ok: false, state: "unavailable" };
  }
}

/** Every user's link, keyed by user id, for the broker/admin Team view. */
export async function linksByUser(db: Db): Promise<Map<string, LinkRow>> {
  const rows = await db.select().from(mlsMemberLinks);
  return new Map(rows.map((r) => [r.userId, r]));
}
