/**
 * Which contacts a caller may see, as SQL.
 *
 * Its own module so the list predicates (`list-sql.ts`) and the service can
 * both depend on it without depending on each other. `service.ts` re-exports
 * `visibleTo`, so every existing importer (metrics, search) is unchanged.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { contacts } from "../db/schema.ts";
import { isBrokerageAdmin, type Actor } from "../auth/actor.ts";

/** The visibility predicate, as SQL. Mirrors `canSee` for a query.
 *  Exported so aggregates (lib/contacts/metrics.ts) count exactly the rows
 *  this actor may list — a total is a disclosure like any other. */
export function visibleTo(actor: Actor, options: { includeMerged?: boolean } = {}) {
  const tenant = eq(contacts.brokerageKey, actor.brokerageKey);
  return and(tenant, isBrokerageAdmin(actor) ? undefined : eq(contacts.assignedAgentUserId, actor.userId), options.includeMerged ? undefined : isNull(contacts.mergedIntoContactId));
}

/** Old audit rows retain their original IDs; the authorized primary file reads its family. */
export function contactFamilyIds(actor: Actor, id: string) {
  return sql`select related.id::text from contacts related join contacts primary_contact on primary_contact.id = ${id}::uuid
    where related.brokerage_key = ${actor.brokerageKey} and related.brokerage_key = primary_contact.brokerage_key
      and related.assigned_agent_user_id = primary_contact.assigned_agent_user_id
      and (related.id = primary_contact.id or related.merged_into_contact_id = primary_contact.id)`;
}
