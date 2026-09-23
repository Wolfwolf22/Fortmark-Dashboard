/**
 * Server-controlled role mapping. Pure and dependency-free so the fallback
 * behaviour can be asserted directly: an unrecognised label must never
 * escalate, it must land on the least-privileged role.
 */
export type DbRole =
  | "admin"
  | "broker"
  | "transaction_coordinator"
  | "agent"
  | "member";

const ROLE_BY_LABEL: Record<string, DbRole> = {
  admin: "admin",
  broker: "broker",
  "transaction coordinator": "transaction_coordinator",
  transaction_coordinator: "transaction_coordinator",
  agent: "agent",
  member: "member",
};

/** Map a Clerk org role or `publicMetadata.fortmarkRole` onto the DB enum. */
export function resolveDbRole(label: string | null | undefined): DbRole {
  if (typeof label !== "string") return "member";
  return ROLE_BY_LABEL[label.trim().toLowerCase().replace(/^org:/, "")] ?? "member";
}

/**
 * How each application role is written on screen. One table for every
 * surface — account card, user menu, Team, Home — so no two places can
 * disagree about the same person.
 */
export const ROLE_DISPLAY: Record<DbRole, string> = {
  admin: "Admin",
  broker: "Broker",
  transaction_coordinator: "Transaction coordinator",
  agent: "Agent",
  member: "Member",
};

/** The display label for an application role; unknown values read as Member. */
export function roleDisplayLabel(role: string | null | undefined): string {
  return ROLE_DISPLAY[(role ?? "") as DbRole] ?? ROLE_DISPLAY.member;
}

/**
 * The role label to DISPLAY for the signed-in user. The application record
 * (`dashboard_users.role`, the one authorisation enforces) always wins; the
 * Clerk-derived label is only a bootstrap hint for a user with no record yet.
 */
export function displayRoleLabel(dbRole: string | null | undefined, clerkLabel: string): string {
  return dbRole ? roleDisplayLabel(dbRole) : clerkLabel;
}
