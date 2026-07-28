import "server-only";

/**
 * Server-side identity for the dashboard, sourced from Clerk.
 *
 * Authentication identity (who you are) and brokerage role (what you may do)
 * are separate concerns:
 *
 * - Identity comes from Clerk: name, primary email, avatar.
 * - Role comes only from server-controlled sources — the Clerk organization
 *   role, or server-managed `publicMetadata.fortmarkRole`. Never from
 *   `unsafeMetadata` (the user can edit it) and never inferred from an email
 *   domain.
 *
 * When no valid role is configured the user is a non-privileged "Member".
 */
import { auth, currentUser } from "@clerk/nextjs/server";

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
      role: resolveRole(orgRole, user.publicMetadata as Record<string, unknown>),
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
