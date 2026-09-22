import "server-only";
/**
 * The real brokerage roster: `dashboard_users` with their professional
 * profile and image. Read-only — there is no role-change or invitation path
 * in the dashboard, and this module does not pretend there is.
 *
 * Authorization reuses the brokerage actor: the caller is resolved from their
 * own session row (never a client-supplied id), and `rosterFor` applies the
 * privileged / colleague split. The brokerage is single-tenant today, so every
 * dashboard user belongs to it; if that changes, the tenant boundary belongs
 * here, next to the query.
 */
import { eq } from "drizzle-orm";
import { dashboardUsers, professionalProfiles, profileImages } from "../db/schema.ts";
import { isPrivileged, resolveActor, type ActorFailure, type DbRole } from "../auth/actor.ts";
import { profileDatabaseEnabled, type EnvLike } from "../flags.ts";
import { rosterFor, type AccountStatus, type RosterEntry } from "./roster.ts";

export type TeamResult =
  | { ok: true; items: RosterEntry[]; viewerPrivileged: boolean }
  | { ok: false; reason: ActorFailure };

export async function listTeam(clerkUserId: string, env: EnvLike = process.env): Promise<TeamResult> {
  const resolved = await resolveActor(clerkUserId, profileDatabaseEnabled(env));
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { actor, db } = resolved;
  const privileged = isPrivileged(actor);

  const rows = await db
    .select({
      userId: dashboardUsers.id,
      role: dashboardUsers.role,
      status: dashboardUsers.status,
      accountEmail: dashboardUsers.primaryEmail,
      createdAt: dashboardUsers.createdAt,
      preferredDisplayName: professionalProfiles.preferredDisplayName,
      legalFirstName: professionalProfiles.legalFirstName,
      legalLastName: professionalProfiles.legalLastName,
      professionalTitle: professionalProfiles.professionalTitle,
      licenseState: professionalProfiles.licenseState,
      licenseType: professionalProfiles.licenseType,
      licenseNumber: professionalProfiles.licenseNumber,
      businessEmail: professionalProfiles.businessEmail,
      profileId: professionalProfiles.id,
      processingStatus: profileImages.processingStatus,
      processedImageUrl: profileImages.processedImageUrl,
      activeImageUrl: profileImages.activeImageUrl,
      clerkImageUrl: profileImages.clerkImageUrl,
      imageId: profileImages.id,
    })
    .from(dashboardUsers)
    .leftJoin(professionalProfiles, eq(professionalProfiles.userId, dashboardUsers.id))
    .leftJoin(profileImages, eq(profileImages.userId, dashboardUsers.id));

  const items = rosterFor(
    rows.map((r) => ({
      userId: r.userId,
      role: r.role as DbRole,
      status: r.status as AccountStatus,
      accountEmail: r.accountEmail,
      createdAt: r.createdAt,
      profile: r.profileId
        ? {
            preferredDisplayName: r.preferredDisplayName,
            legalFirstName: r.legalFirstName,
            legalLastName: r.legalLastName,
            professionalTitle: r.professionalTitle,
            licenseState: r.licenseState,
            licenseType: r.licenseType,
            licenseNumber: r.licenseNumber,
            businessEmail: r.businessEmail,
          }
        : null,
      image: r.imageId
        ? {
            processingStatus: r.processingStatus,
            processedImageUrl: r.processedImageUrl,
            activeImageUrl: r.activeImageUrl,
            clerkImageUrl: r.clerkImageUrl,
          }
        : null,
    })),
    { userId: actor.userId, privileged }
  );
  return { ok: true, items, viewerPrivileged: privileged };
}
