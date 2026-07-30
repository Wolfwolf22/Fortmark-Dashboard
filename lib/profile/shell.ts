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
import {
  professionalProfileUiEnabled,
  profileDatabaseEnabled,
  type EnvLike,
} from "../flags.ts";
import { toProfileDisplay, type ShellProfile } from "./display.ts";
import {
  fallbackHomeIdentityCard,
  toHomeIdentityCard,
  type HomeIdentityCard,
} from "./home-card.ts";
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

/**
 * Categories a Home-card build can end in.
 *
 * Deliberately coarse and value-free so it is safe to log: no identifier, no
 * email, no licence, no hostname, no row contents. Temporary — this exists to
 * locate a sync failure in Preview and is removed once the cause is fixed.
 */
export type HomeCardOutcome =
  | "enriched"
  | "flags_disabled"
  | "sync_returned_null"
  | "sync_threw";

/**
 * The Home identity card for the current request. Never null.
 *
 * Authentication and the allowlist have already approved this request before
 * this function is reached, so the card is owed to the user unconditionally.
 * The database *enriches* the card; it does not gate it. Every failure path
 * returns the session-only projection instead of nothing, because a profile
 * problem must never remove a surface the user is entitled to — the same rule
 * that keeps a database outage from becoming an access outage.
 *
 * `syncCurrentUser` is reused rather than a second read path: it already
 * re-checks the allowlist before touching the database and returns the user,
 * profile and image rows this projection needs.
 */
export async function getHomeIdentityCard(
  user: SessionUser,
  env: EnvLike = process.env
): Promise<HomeIdentityCard> {
  const session = {
    name: user.name,
    role: user.role,
    email: user.email,
    imageUrl: user.imageUrl,
  };
  const fallback = fallbackHomeIdentityCard(session);

  if (!professionalProfileUiEnabled(env)) {
    // Report WHICH flag is off. Booleans only — never a value — so the
    // configuration gap is actionable without a Vercel token to read env with.
    reportHomeCardOutcome(
      "flags_disabled",
      undefined,
      `db_flag=${profileDatabaseEnabled(env)} ui_flag=${rawUiFlag(env)}`
    );
    return fallback;
  }

  const identity: ClerkIdentity = {
    clerkUserId: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.imageUrl,
    roleLabel: user.role,
  };

  try {
    const synced = await syncCurrentUser(identity, env);
    if (!synced) {
      reportHomeCardOutcome("sync_returned_null");
      return fallback;
    }
    reportHomeCardOutcome("enriched");
    return toHomeIdentityCard(session, synced.user, synced.profile, synced.image);
  } catch (error) {
    // Only the error's class name, never its message: a driver error can carry
    // the host and user portion of a connection string.
    reportHomeCardOutcome("sync_threw", (error as Error)?.constructor?.name);
    return fallback;
  }
}

/**
 * TEMPORARY diagnostic. Emits a single category, nothing else.
 *
 * Removed once the Preview sync failure is understood. Silent outside Preview
 * so Production logs are untouched.
 */
function reportHomeCardOutcome(
  outcome: HomeCardOutcome,
  errorClass?: string,
  detail?: string
): void {
  if (process.env.VERCEL_ENV !== "preview") return;
  console.log(
    `[home-card] outcome=${outcome}` +
      (errorClass ? ` error_class=${errorClass}` : "") +
      (detail ? ` ${detail}` : "")
  );
}

/**
 * Whether PROFESSIONAL_PROFILE_UI_ENABLED is truthy on its own.
 *
 * `professionalProfileUiEnabled` deliberately ANDs the two flags, so it cannot
 * distinguish "UI flag missing" from "database flag missing". This reads the
 * raw value for diagnostics only — it is never an authorization input.
 */
function rawUiFlag(env: EnvLike): boolean {
  const v = env.PROFESSIONAL_PROFILE_UI_ENABLED;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
