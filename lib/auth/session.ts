/**
 * The auth seam — now backed by the real Clerk session.
 *
 * Previously this returned a hardcoded "Marcus Webb" mock. It now reads the
 * authenticated Clerk user and enforces the approved-user allowlist. There is
 * no fallback identity: an unauthenticated or non-approved caller gets `null`
 * or a thrown `AccessDeniedError`, never a synthetic user.
 *
 * SERVER ONLY. Never import this from a client component — sign-out is a client
 * concern and lives in `components/layout/user-menu.tsx` via Clerk's hook.
 */
import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isApproved, loadAuthConfig, userRef, type AuthConfigReject } from "./config";
import { displayNameFrom, roleFrom, type DashboardRole } from "./identity";

export { displayNameFrom, roleFrom };
export type { DashboardRole };

export interface Session {
  user: {
    id: string;
    name: string;
    email: string;
    role: DashboardRole;
    imageUrl: string | null;
  };
}

/** Thrown when the configuration is unusable. Callers must fail closed. */
export class AuthConfigurationError extends Error {
  readonly reason: AuthConfigReject;
  constructor(reason: AuthConfigReject) {
    super(`dashboard auth configuration unavailable: ${reason}`);
    this.name = "AuthConfigurationError";
    this.reason = reason;
  }
}

/**
 * Thrown when a VALID Clerk user is not on the approved allowlist → 403.
 *
 * `ref` is the opaque, non-reversible user reference — safe to log. The raw
 * Clerk user id is never carried on the error.
 */
export class AccessDeniedError extends Error {
  readonly ref: string;
  constructor(ref = "anon") {
    super("access denied");
    this.name = "AccessDeniedError";
    this.ref = ref;
  }
}

/** Build an `AccessDeniedError` carrying the opaque reference for the caller. */
export async function accessDenied(
  clerkUserId: string | null | undefined
): Promise<AccessDeniedError> {
  return new AccessDeniedError(await userRef(clerkUserId));
}

/**
 * The authenticated session, or `null` when nobody is signed in.
 *
 * Throws `AuthConfigurationError` when Clerk or the allowlist is unusable
 * (fail closed), and `AccessDeniedError` when a valid user is not approved.
 */
export async function getSession(): Promise<Session | null> {
  const cfg = await loadAuthConfig();
  if (!cfg.ok) throw new AuthConfigurationError(cfg.reason);

  const { userId } = await auth();
  if (!userId) return null;

  if (!(await isApproved(cfg.config, userId))) throw await accessDenied(userId);

  const u = await currentUser();
  if (!u) return null;

  const emailAddress =
    u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? "";

  return {
    user: {
      id: u.id,
      name: displayNameFrom({
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        emailAddress,
      }),
      email: emailAddress,
      role: roleFrom(u.publicMetadata),
      imageUrl: u.imageUrl ?? null,
    },
  };
}

/**
 * The session, or throw. Used by the protected server layout so a page can
 * never render without an approved identity.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AccessDeniedError();
  return session;
}
