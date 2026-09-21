import "server-only";

/**
 * The caller as a brokerage actor.
 *
 * Every brokerage-owned domain (transactions, contacts, and whatever follows)
 * scopes its queries by the same three facts: the caller's dashboard_users
 * row, that row's role, and the brokerage it belongs to. They are resolved
 * here, once, from the verified Clerk session — never from a request — so a
 * second domain cannot restate the rule differently.
 *
 * A signed-in, allowlisted caller with no dashboard_users row has no
 * brokerage identity yet (the profile sync has not run for them) and can own
 * or see nothing. That is `no_identity`, distinct from "forbidden".
 */
import { eq } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { dashboardUsers, FORTMARK_BROKERAGE_KEY } from "../db/schema.ts";

export type DbRole = "admin" | "broker" | "transaction_coordinator" | "agent" | "member";

/** Roles that see and may change every record in the brokerage. */
export const PRIVILEGED_ROLES: readonly DbRole[] = ["admin", "broker", "transaction_coordinator"];

export interface Actor {
  /** dashboard_users.id — never the Clerk id. */
  userId: string;
  role: DbRole;
  brokerageKey: string;
}

export function isPrivileged(actor: Actor): boolean {
  return PRIVILEGED_ROLES.includes(actor.role);
}

/** A record's ownership facts, the shape every scoped table shares. */
export interface Owned {
  brokerageKey: string;
  ownerUserId: string;
}

/**
 * May this actor see this record? The brokerage boundary is checked first and
 * unconditionally; within it, a privileged role sees everything and anyone
 * else sees only what they are responsible for.
 */
export function canSeeOwned(actor: Actor, record: Owned): boolean {
  if (record.brokerageKey !== actor.brokerageKey) return false;
  return isPrivileged(actor) || record.ownerUserId === actor.userId;
}

/** May this actor change this record? Same rule as seeing it; members may not. */
export function canWriteOwned(actor: Actor, record: Owned): boolean {
  if (actor.role === "member") return false;
  return canSeeOwned(actor, record);
}

/** May this actor create a record owned by this user? Agents only for themselves. */
export function canCreateOwnedFor(actor: Actor, ownerUserId: string): boolean {
  if (actor.role === "member") return false;
  return isPrivileged(actor) || ownerUserId === actor.userId;
}

/**
 * May a record be owned by this user? A privileged actor may name any owner,
 * but the id comes from the request: it must be a real, active dashboard
 * user in a role that owns work — a member does not, and neither does a
 * suspended or pending account. Nothing else about the row is read.
 */
export async function canOwnRecords(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ role: dashboardUsers.role, status: dashboardUsers.status })
    .from(dashboardUsers)
    .where(eq(dashboardUsers.id, userId))
    .limit(1);
  const user = rows[0];
  return Boolean(user && user.status === "active" && user.role !== "member");
}

export type ActorFailure = "disabled" | "unavailable" | "no_identity";

export type ActorResult =
  | { ok: true; actor: Actor; db: Db }
  | { ok: false; reason: ActorFailure };

/**
 * Resolve the caller. `enabled` is the domain's own flag, evaluated by the
 * caller, so this module stays ignorant of which feature is asking.
 */
export async function resolveActor(clerkUserId: string, enabled: boolean): Promise<ActorResult> {
  if (!enabled) return { ok: false, reason: "disabled" };
  const db = getDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    const rows = await db
      .select({ id: dashboardUsers.id, role: dashboardUsers.role, status: dashboardUsers.status })
      .from(dashboardUsers)
      .where(eq(dashboardUsers.clerkUserId, clerkUserId))
      .limit(1);
    const user = rows[0];
    if (!user || user.status === "suspended") return { ok: false, reason: "no_identity" };
    return {
      ok: true,
      actor: { userId: user.id, role: user.role as DbRole, brokerageKey: FORTMARK_BROKERAGE_KEY },
      db,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
