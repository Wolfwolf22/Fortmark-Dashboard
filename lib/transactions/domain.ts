/** Transaction authorization plus compatibility exports for the client-safe domain modules. */
import type { TransactionRow } from "../db/schema.ts";
import { canCreateOwnedFor, canSeeOwned, canWriteOwned, type Actor } from "../auth/actor.ts";
export { isPrivileged, PRIVILEGED_ROLES, type Actor, type DbRole } from "../auth/actor.ts";
export * from "./validation.ts";
export * from "./projection.ts";
export function canSee(actor: Actor, row: Pick<TransactionRow, "brokerageKey" | "agentUserId">): boolean { return canSeeOwned(actor, { brokerageKey: row.brokerageKey, ownerUserId: row.agentUserId }); }
export function canWrite(actor: Actor, row: Pick<TransactionRow, "brokerageKey" | "agentUserId">): boolean { return canWriteOwned(actor, { brokerageKey: row.brokerageKey, ownerUserId: row.agentUserId }); }
export function canCreateFor(actor: Actor, agentUserId: string): boolean { return canCreateOwnedFor(actor, agentUserId); }
