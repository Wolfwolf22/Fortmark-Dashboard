import "server-only";

/**
 * Bridges the profile service to the dashboard shell.
 *
 * The contract this module exists to enforce: **the shell renders the same
 * whether or not the database is working.** Every failure path here returns a
 * session-only projection rather than throwing, so a Neon outage, a missing
 * row, or a disabled flag degrades the identity strip to what the dashboard
 * already showed before Release 1 — never to an error page and never to a
 * denied request.
 */
import { professionalProfileUiEnabled, type EnvLike } from "../flags.ts";
import { toProfileDisplay, type ShellProfile } from "./display.ts";
import { syncCurrentUser, type ClerkIdentity } from "./service.ts";
import type { SessionUser } from "../auth/session.ts";

export type { ShellProfile };

/** The session-only projection. The floor that every failure path lands on. */
export function fallbackShellProfile(user: SessionUser): ShellProfile {
  return {
    display: toProfileDisplay({
      name: user.name,
      role: user.role,
      imageUrl: user.imageUrl,
    }),
    editable: false,
  };
}

/**
 * Resolve the shell's identity strip for the current request.
 *
 * Calls `syncCurrentUser`, which independently re-checks the allowlist before
 * touching the database — being signed in is not enough to provision a row.
 */
export async function getShellProfile(
  user: SessionUser,
  env: EnvLike = process.env
): Promise<ShellProfile> {
  if (!professionalProfileUiEnabled(env)) return fallbackShellProfile(user);

  const identity: ClerkIdentity = {
    clerkUserId: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    roleLabel: user.role,
  };

  try {
    const synced = await syncCurrentUser(identity, env);
    if (!synced) return fallbackShellProfile(user);

    return {
      display: toProfileDisplay(
        { name: user.name, role: user.role, imageUrl: user.imageUrl },
        synced.profile,
        synced.image
      ),
      editable: true,
    };
  } catch {
    // Swallowed on purpose. A profile problem must never become an access
    // problem while the allowlist is the access authority.
    return fallbackShellProfile(user);
  }
}
