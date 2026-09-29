/**
 * Which contacts a caller may see, as SQL.
 *
 * Its own module so the list predicates (`list-sql.ts`) and the service can
 * both depend on it without depending on each other. `service.ts` re-exports
 * `visibleTo`, so every existing importer (metrics, search) is unchanged.
 */
import { and, eq } from "drizzle-orm";
import { contacts } from "../db/schema.ts";
import { isPrivileged, type Actor } from "../auth/actor.ts";

/** The visibility predicate, as SQL. Mirrors `canSee` for a query.
 *  Exported so aggregates (lib/contacts/metrics.ts) count exactly the rows
 *  this actor may list — a total is a disclosure like any other. */
export function visibleTo(actor: Actor) {
  const tenant = eq(contacts.brokerageKey, actor.brokerageKey);
  return isPrivileged(actor) ? tenant : and(tenant, eq(contacts.assignedAgentUserId, actor.userId));
}
