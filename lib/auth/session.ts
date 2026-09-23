import "server-only";

/**
 * Server-side identity for the dashboard, sourced from Clerk.
 *
 * Authentication identity (who you are) and brokerage role (what you may do)
 * are separate concerns:
 *
 * - Identity comes from Clerk: name, primary email, avatar.
 * - Role comes from `dashboard_users.role` — the same row every authorisation
 *   check reads (`resolveActor`). The account card, user menu and Home must
 *   show the role the application actually enforces.
 *
 * Defect this closes: the displayed role used to come from Clerk (org role or
 * `publicMetadata.fortmarkRole`, defaulting to "Member") while authorisation
 * used the database, so an `admin` saw "Member" on Settings › Profile.
 *
 * Clerk's value is now only the BOOTSTRAP hint for a user who has no
 * application record yet (first sign-in, or the profile database is off); the
 * sync uses it once to seed the new row and never again. Never from
 * `unsafeMetadata`, never inferred from an email domain.
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { resolveActor } from "./actor.ts";
import { profileDatabaseEnabled } from "../flags.ts";
import { displayRoleLabel } from "../profile/roles.ts";

/** Brokerage roles, most privileged first. "Member" is the safe default. */
export const BROKERAGE_ROLES = [
  "Admin",
  "Broker",
  "Transaction coordinator",
  "Agent",
  "Member",
] as const;

export type BrokerageRole = (typeof BROKERAGE_ROLES)[number];

export const DEFAULT_ROLE: BrokerageRole = "Member";

export interface SessionUser {
  /** Clerk user id. Server-side only — never render this in the browser. */
  id: string;
  name: string;
  email: string | null;
  imageUrl: string | null;
  role: BrokerageRole;
}

export interface Session {
  user: SessionUser;
}

/** Normalise an arbitrary configured value onto a known role, or null. */
function toBrokerageRole(value: unknown): BrokerageRole | null {
  if (typeof value !== "string") return null;
  const needle = value.trim().toLowerCase();
  return BROKERAGE_ROLES.find((role) => role.toLowerCase() === needle) ?? null;
}

/**
 * Resolve the display role from server-controlled sources only, in priority
 * order: Clerk organization role, then server-managed public metadata.
 */
function resolveRole(
  orgRole: string | null | undefined,
  publicMetadata: Record<string, unknown> | undefined
): BrokerageRole {
  // Clerk org roles arrive as `org:admin` / `org:member`; map a recognised
  // role and otherwise fall through to server-managed metadata.
  if (typeof orgRole === "string" && orgRole.trim() !== "") {
    const bare = orgRole.replace(/^org:/, "");
    const mapped = toBrokerageRole(bare);
    if (mapped) return mapped;
    if (bare.toLowerCase() === "admin") return "Admin";
  }
  return toBrokerageRole(publicMetadata?.fortmarkRole) ?? DEFAULT_ROLE;
}

/**
 * The role to display: the application record's when there is one, otherwise
 * the Clerk bootstrap hint. Pure, so the precedence is testable.
 */
export function displayRole(dbRole: string | null | undefined, clerkRole: BrokerageRole): BrokerageRole {
  return toBrokerageRole(displayRoleLabel(dbRole, clerkRole)) ?? DEFAULT_ROLE;
}

/** The application role from `dashboard_users`, or null when there is none. */
async function applicationRole(clerkUserId: string): Promise<string | null> {
  const resolved = await resolveActor(clerkUserId, profileDatabaseEnabled());
  return resolved.ok ? resolved.actor.role : null;
}

/**
 * The signed-in user, or null. Returns identity only — it does not decide
 * whether this user may use the dashboard. That is `decideAccess()` in
 * `lib/auth/dashboard-access.ts`.
 */
export async function getSession(): Promise<Session | null> {
  const { userId, orgRole } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  if (!user) return null;

  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    user.primaryEmailAddress?.emailAddress ||
    "FortMark user";

  return {
    user: {
      id: userId,
      name,
      email: user.primaryEmailAddress?.emailAddress ?? null,
      imageUrl: user.imageUrl || null,
      role: displayRole(
        await applicationRole(userId),
        resolveRole(orgRole, user.publicMetadata as Record<string, unknown>)
      ),
    },
  };
}

/**
 * Identity safe to hand to client components: the Clerk user id is dropped so
 * a raw identifier never reaches the browser.
 */
export type PublicSessionUser = Omit<SessionUser, "id">;

export function toPublicUser(user: SessionUser): PublicSessionUser {
  const { id: _id, ...rest } = user;
  return rest;
}
