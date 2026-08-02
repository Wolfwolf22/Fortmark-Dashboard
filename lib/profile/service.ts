import "server-only";

/**
 * Server-only professional-profile service.
 *
 * Release 1 boundaries, all enforced here rather than in the UI:
 *
 * - Sync only ever runs for a caller who has ALREADY passed the existing
 *   allowlist check. Being signed in is not sufficient; a random Clerk user
 *   cannot create an active row for themselves.
 * - Role and status are server-resolved. They are not accepted from input.
 * - The raw Clerk id never leaves this module.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import {
  auditEvents,
  dashboardUsers,
  professionalProfiles,
  profileImages,
  type AuditEventType,
  type DashboardUser,
  type ProfessionalProfile,
  type ProfileImage,
} from "../db/schema.ts";
import { decideAccess } from "../auth/dashboard-access.ts";
import { profileDatabaseEnabled, type EnvLike } from "../flags.ts";
import { resolveDbRole } from "./roles.ts";
import {
  licenseDetailsChanged,
  normalizeProfileUpdate,
  profileCompletion,
  profileUpdateSchema,
  type NormalizedProfileUpdate,
} from "./normalize.ts";
import {
  LAST_STEP,
  droppedValueErrors,
  normalizeStep,
  stepByNumber,
  stepSchema,
  toValidationFailure,
  type ValidationFailure,
} from "./onboarding.ts";
import { z } from "zod";

/** Keys that must never appear in audit metadata, whatever the caller passes. */
const FORBIDDEN_META = /token|secret|cookie|authorization|password|clerk_?user_?id|session/i;

function scrubMetadata(meta: Record<string, unknown> | undefined) {
  if (!meta) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META.test(k)) continue;
    if (typeof v === "string" && /^user_[A-Za-z0-9]{8,}$/.test(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function writeAuditEvent(
  eventType: AuditEventType,
  opts: {
    actorUserId?: string | null;
    targetUserId?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditEvents).values({
      eventType,
      actorUserId: opts.actorUserId ?? null,
      targetUserId: opts.targetUserId ?? null,
      safeMetadata: scrubMetadata(opts.metadata),
    });
  } catch {
    // Auditing must never break the request that triggered it.
  }
}

export interface SyncedPrincipal {
  user: DashboardUser;
  profile: ProfessionalProfile;
  image: ProfileImage | null;
}

export interface ClerkIdentity {
  clerkUserId: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  /** Server-controlled role label (Clerk org role or publicMetadata). */
  roleLabel: string | null;
}

/**
 * Create-or-refresh the caller's own records.
 *
 * Returns null when the feature is off, the database is unconfigured or
 * unreachable, or the caller is not already allowlisted. Null is always safe:
 * Release 1 renders the dashboard from the existing allowlist path regardless.
 */
export async function syncCurrentUser(
  identity: ClerkIdentity,
  env: EnvLike = process.env
): Promise<SyncedPrincipal | null> {
  if (!profileDatabaseEnabled(env)) return null;

  // The gate that stops an arbitrary signed-in user from provisioning
  // themselves. Release 1 never widens access beyond the allowlist.
  if (!decideAccess(identity.clerkUserId, env).ok) return null;

  const db = getDb();
  if (!db) return null;

  try {
    const existing = await db
      .select()
      .from(dashboardUsers)
      .where(eq(dashboardUsers.clerkUserId, identity.clerkUserId))
      .limit(1);

    let user = existing[0];
    const role = resolveDbRole(identity.roleLabel);

    if (!user) {
      const inserted = await db
        .insert(dashboardUsers)
        .values({
          clerkUserId: identity.clerkUserId,
          primaryEmail: identity.email ?? "",
          // Allowlisted today ⇒ active. Later releases gate this on approval.
          status: "active",
          role,
          lastSeenAt: new Date(),
        })
        .returning();
      user = inserted[0];
      await writeAuditEvent("user_record_created", {
        targetUserId: user.id,
        metadata: { role, source: "clerk_sync" },
      });
      if (role === "admin") {
        await writeAuditEvent("bootstrap_admin_assigned", {
          targetUserId: user.id,
          metadata: { source: "clerk_role" },
        });
      }
    } else {
      const patch: Partial<typeof dashboardUsers.$inferInsert> = {
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      };
      // Refresh the verified email if Clerk's changed; it is Clerk-owned.
      if (identity.email && identity.email !== user.primaryEmail) {
        patch.primaryEmail = identity.email;
      }
      const updated = await db
        .update(dashboardUsers)
        .set(patch)
        .where(eq(dashboardUsers.id, user.id))
        .returning();
      user = updated[0] ?? user;
    }

    // Profile row — created empty on first sight.
    const profRows = await db
      .select()
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, user.id))
      .limit(1);
    let profile = profRows[0];
    if (!profile) {
      const [first, ...rest] = (identity.name ?? "").split(" ").filter(Boolean);
      const created = await db
        .insert(professionalProfiles)
        .values({
          userId: user.id,
          legalFirstName: first ?? null,
          legalLastName: rest.length ? rest.join(" ") : null,
          preferredDisplayName: identity.name ?? null,
        })
        .returning();
      profile = created[0];
      await writeAuditEvent("profile_created", { targetUserId: user.id });
    }

    // Image row — Release 1 records the Clerk reference only.
    const imgRows = await db
      .select()
      .from(profileImages)
      .where(eq(profileImages.userId, user.id))
      .limit(1);
    let image = imgRows[0] ?? null;
    if (!image && identity.imageUrl) {
      const created = await db
        .insert(profileImages)
        .values({
          userId: user.id,
          clerkImageUrl: identity.imageUrl,
          activeImageUrl: identity.imageUrl,
          processingStatus: "clerk_only",
        })
        .returning();
      image = created[0];
    } else if (image && identity.imageUrl && image.clerkImageUrl !== identity.imageUrl) {
      const updated = await db
        .update(profileImages)
        .set({ clerkImageUrl: identity.imageUrl, updatedAt: new Date() })
        .where(eq(profileImages.id, image.id))
        .returning();
      image = updated[0] ?? image;
    }

    await writeAuditEvent("user_synced_from_clerk", { targetUserId: user.id });
    return { user, profile, image };
  } catch {
    // A database problem degrades profile features only. Access is unaffected
    // while DATABASE_ACCESS_CONTROL_ENABLED is false.
    return null;
  }
}

/** The caller's own full profile, or null when unavailable. */
export async function getOwnProfile(
  clerkUserId: string,
  env: EnvLike = process.env
): Promise<SyncedPrincipal | null> {
  if (!profileDatabaseEnabled(env)) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const users = await db
      .select()
      .from(dashboardUsers)
      .where(eq(dashboardUsers.clerkUserId, clerkUserId))
      .limit(1);
    const user = users[0];
    if (!user) return null;
    const profile = (
      await db
        .select()
        .from(professionalProfiles)
        .where(eq(professionalProfiles.userId, user.id))
        .limit(1)
    )[0];
    if (!profile) return null;
    const image =
      (
        await db
          .select()
          .from(profileImages)
          .where(eq(profileImages.userId, user.id))
          .limit(1)
      )[0] ?? null;
    return { user, profile, image };
  } catch {
    return null;
  }
}

export type UpdateResult =
  | { ok: true; completion: number; licenseReset: boolean }
  | {
      ok: false;
      reason: "unavailable" | "no_record" | "invalid";
      /** Same contract the onboarding API returns, so one client shape serves both. */
      validation?: ValidationFailure;
    };

/**
 * Update the caller's own profile.
 *
 * Scoped by `clerkUserId` resolved from the session — never by an id from the
 * request body, so one user cannot address another's row. Role, status and the
 * verified email are not in the schema and cannot be written here.
 */
export async function updateOwnProfile(
  clerkUserId: string,
  raw: unknown,
  env: EnvLike = process.env
): Promise<UpdateResult> {
  if (!profileDatabaseEnabled(env)) return { ok: false, reason: "unavailable" };
  const db = getDb();
  if (!db) return { ok: false, reason: "unavailable" };

  const submitted = (raw ?? {}) as Record<string, unknown>;
  const editable = Object.keys(profileUpdateSchema.shape) as (keyof NormalizedProfileUpdate)[];

  let next: NormalizedProfileUpdate;
  try {
    next = normalizeProfileUpdate(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, reason: "invalid", validation: toValidationFailure(error, editable) };
    }
    return { ok: false, reason: "invalid" };
  }

  // Same reporting the wizard gets: a value that normalised away to null is
  // told to the user rather than silently dropped from a "saved" profile.
  const dropped = droppedValueErrors(submitted, next, editable);
  if (Object.keys(dropped).length > 0) {
    return {
      ok: false,
      reason: "invalid",
      validation: { error: "validation_failed", fieldErrors: dropped, formErrors: [] },
    };
  }

  try {
    const current = await getOwnProfile(clerkUserId, env);
    if (!current) return { ok: false, reason: "no_record" };

    const before: Partial<NormalizedProfileUpdate> = {
      licenseState: current.profile.licenseState,
      licenseType: current.profile.licenseType,
      licenseNumber: current.profile.licenseNumber,
      licenseExpiration: current.profile.licenseExpiration,
    };
    const licenseReset = licenseDetailsChanged(before, next);
    const completion = profileCompletion(next);

    await db
      .update(professionalProfiles)
      .set({ ...next, profileCompletionPercent: completion, updatedAt: new Date() })
      .where(eq(professionalProfiles.userId, current.user.id));

    await writeAuditEvent("profile_updated", {
      actorUserId: current.user.id,
      targetUserId: current.user.id,
      // Field names only — never the submitted values.
      metadata: { completion, licenseChanged: licenseReset },
    });

    return { ok: true, completion, licenseReset };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type StepSaveResult =
  | { ok: true; completion: number; onboardingStep: number }
  | {
      ok: false;
      reason: "unavailable" | "no_record" | "invalid" | "unknown_step";
      /** Present only for `invalid`. Keyed by UI field name, never by column. */
      validation?: ValidationFailure;
    };

/**
 * The fields completion is scored from, read off a stored row.
 *
 * A step save only carries its own fields, so scoring the submitted payload
 * alone would count everything else as empty and make the percentage fall
 * every time a user saved an early step. Completion is therefore always
 * computed from the stored row MERGED with the incoming step.
 */
function completionSourceFromRow(
  profile: SyncedPrincipal["profile"]
): Partial<NormalizedProfileUpdate> {
  return {
    preferredDisplayName: profile.preferredDisplayName,
    legalFirstName: profile.legalFirstName,
    legalLastName: profile.legalLastName,
    phoneE164: profile.phoneE164,
    brokerageOffice: profile.brokerageOffice,
    licenseState: profile.licenseState,
    licenseType: profile.licenseType,
    licenseNumber: profile.licenseNumber,
    licenseExpiration: profile.licenseExpiration,
    biography: profile.biography,
    languages: profile.languages ?? [],
    specialties: profile.specialties ?? [],
    professionalTitle: profile.professionalTitle,
    locationDisplay: profile.locationDisplay,
  };
}

/**
 * Save one onboarding step for the caller.
 *
 * Scoped by the session-resolved `clerkUserId`, exactly like every other write
 * here — no identifier from the request body is consulted, so no request shape
 * addresses another user's row.
 *
 * Idempotent by construction: the write sets this step's fields to normalised
 * values derived only from the payload, so repeating the same request produces
 * the same row. `onboarding_step` moves forward only — replaying an earlier
 * step cannot rewind a user who has since progressed, which is what makes a
 * retry after a flaky response safe.
 *
 * Completion is never written from the step alone; see
 * `completionSourceFromRow`.
 */
export async function saveOnboardingStep(
  clerkUserId: string,
  stepNumber: unknown,
  raw: unknown,
  env: EnvLike = process.env
): Promise<StepSaveResult> {
  if (!profileDatabaseEnabled(env)) return { ok: false, reason: "unavailable" };
  const db = getDb();
  if (!db) return { ok: false, reason: "unavailable" };

  const step = stepByNumber(stepNumber);
  if (!step) return { ok: false, reason: "unknown_step" };

  const submitted = (raw ?? {}) as Record<string, unknown>;

  let fields: Partial<NormalizedProfileUpdate>;
  try {
    fields = normalizeStep(step, raw);
  } catch (error) {
    // Schema violation — report it per field, using the step's own field list
    // so the response cannot confirm a field outside this step.
    if (error instanceof z.ZodError) {
      return { ok: false, reason: "invalid", validation: toValidationFailure(error, step.fields) };
    }
    return { ok: false, reason: "invalid" };
  }

  // Values that parsed but normalised away to null. The normalisers are
  // forgiving by design, so without this the user would see a "saved" step
  // with their input silently missing.
  const dropped = droppedValueErrors(submitted, fields, step.fields);
  if (Object.keys(dropped).length > 0) {
    return {
      ok: false,
      reason: "invalid",
      validation: { error: "validation_failed", fieldErrors: dropped, formErrors: [] },
    };
  }

  try {
    const current = await getOwnProfile(clerkUserId, env);
    if (!current) return { ok: false, reason: "no_record" };

    const merged = { ...completionSourceFromRow(current.profile), ...fields };
    const completion = profileCompletion(merged);
    // Forward-only. A replayed earlier step must not rewind the resume point.
    const onboardingStep = Math.max(current.profile.onboardingStep ?? 0, step.step);

    await db
      .update(professionalProfiles)
      .set({
        ...fields,
        profileCompletionPercent: completion,
        onboardingStep,
        updatedAt: new Date(),
      })
      .where(eq(professionalProfiles.userId, current.user.id));

    await writeAuditEvent("profile_updated", {
      actorUserId: current.user.id,
      targetUserId: current.user.id,
      // Step id and score only — never a submitted value.
      metadata: { onboardingStep: step.step, stepId: step.id, completion },
    });

    return { ok: true, completion, onboardingStep };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type CompleteResult =
  | { ok: true; completion: number; completedAt: string }
  | {
      ok: false;
      reason: "unavailable" | "no_record" | "invalid";
      validation?: ValidationFailure;
    };

/**
 * Finish onboarding.
 *
 * Runs the FULL update contract rather than a step schema, then stamps
 * `dashboard_users.onboarding_complete`. That timestamp is the only record
 * that onboarding finished — there is no status column mirroring it, so the
 * two can never disagree.
 *
 * `dashboard_users.status` is deliberately left alone. Nothing in this
 * application transitions it today, and it is the field that WOULD become
 * access-relevant if database-backed access control were ever enabled. Writing
 * it here would quietly make a profile action touch an authorization column,
 * which is exactly the coupling this release is built to avoid.
 */
export async function completeOnboarding(
  clerkUserId: string,
  raw: unknown,
  env: EnvLike = process.env
): Promise<CompleteResult> {
  if (!profileDatabaseEnabled(env)) return { ok: false, reason: "unavailable" };
  const db = getDb();
  if (!db) return { ok: false, reason: "unavailable" };

  let next: NormalizedProfileUpdate;
  try {
    next = normalizeProfileUpdate(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Full validation, so every editable field is in scope.
      const all = Object.keys(profileUpdateSchema.shape) as (keyof NormalizedProfileUpdate)[];
      return { ok: false, reason: "invalid", validation: toValidationFailure(error, all) };
    }
    return { ok: false, reason: "invalid" };
  }

  try {
    const current = await getOwnProfile(clerkUserId, env);
    if (!current) return { ok: false, reason: "no_record" };

    // Already finished. Return the EXISTING timestamp and write nothing —
    // that is what makes a duplicate completion idempotent, and it is also
    // what stops a retry from appending a second audit row.
    if (current.user.onboardingComplete) {
      return {
        ok: true,
        completion: current.profile.profileCompletionPercent ?? profileCompletion(
          completionSourceFromRow(current.profile)
        ),
        completedAt: new Date(current.user.onboardingComplete).toISOString(),
      };
    }

    const merged = { ...completionSourceFromRow(current.profile), ...next };
    const completion = profileCompletion(merged);
    const completedAt = new Date();

    // Both writes go out as ONE Neon HTTP batch, which the server applies in a
    // single transaction. `db.transaction()` is not available on this driver —
    // drizzle's neon-http adapter throws "No transactions support in neon-http
    // driver" — so a batch is the strongest atomicity the execution model
    // offers. It is enough for the invariant that matters: the completion
    // timestamp can never be stamped while the profile write is lost, or the
    // reverse.
    await db.batch([
      db
        .update(professionalProfiles)
        .set({
          ...next,
          profileCompletionPercent: completion,
          onboardingStep: LAST_STEP,
          updatedAt: completedAt,
        })
        .where(eq(professionalProfiles.userId, current.user.id)),
      db
        .update(dashboardUsers)
        .set({ onboardingComplete: completedAt, updatedAt: completedAt })
        .where(eq(dashboardUsers.id, current.user.id)),
    ]);

    // Written only after both rows landed, and only on the transition — so it
    // records the event once rather than once per retry. Outside the batch on
    // purpose: auditing must never be able to fail the request it describes.
    await writeAuditEvent("profile_updated", {
      actorUserId: current.user.id,
      targetUserId: current.user.id,
      // Category and score only. No field values, no email, no licence, no
      // NRDS, no raw Clerk identifier.
      metadata: { onboarding: "completed", completion },
    });

    return { ok: true, completion, completedAt: completedAt.toISOString() };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Counts only. Never identifiers, emails or configuration values. */
export async function profileDiagnostics(): Promise<
  { ok: true; activeUsers: number; admins: number; profiles: number } | { ok: false }
> {
  const db = getDb();
  if (!db) return { ok: false };
  try {
    const users = await db.select().from(dashboardUsers);
    const profiles = await db.select().from(professionalProfiles);
    return {
      ok: true,
      activeUsers: users.filter((u) => u.status === "active").length,
      admins: users.filter((u) => u.role === "admin").length,
      profiles: profiles.length,
    };
  } catch {
    return { ok: false };
  }
}
