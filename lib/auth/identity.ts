/**
 * Pure identity mapping — no Clerk import, no `server-only`.
 *
 * Kept separate from `session.ts` so the mapping rules stay unit-testable
 * without weakening the `server-only` guard that protects the Clerk-touching
 * code. `session.ts` re-exports these.
 */
export type DashboardRole = "Broker" | "Agent" | "Transaction coordinator" | "Admin";

const ROLES: DashboardRole[] = ["Broker", "Agent", "Transaction coordinator", "Admin"];

/**
 * Role for the authenticated user.
 *
 * Read from Clerk public metadata when present; otherwise the LEAST-privileged
 * default. A role is never inferred from an email address or a display name.
 */
export function roleFrom(metadata: unknown): DashboardRole {
  const raw =
    metadata && typeof metadata === "object" && "role" in metadata
      ? (metadata as { role?: unknown }).role
      : undefined;
  return typeof raw === "string" && (ROLES as string[]).includes(raw)
    ? (raw as DashboardRole)
    : "Agent";
}

/**
 * Best available display name.
 *
 * The final fallback is deliberately generic — never a fabricated person. The
 * old mock identity ("Marcus Webb") is unreachable from every branch.
 */
export function displayNameFrom(u: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  emailAddress?: string | null;
}): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (u.username) return u.username;
  if (u.emailAddress) return u.emailAddress.split("@")[0];
  return "FortMark user";
}
