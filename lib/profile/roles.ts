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
