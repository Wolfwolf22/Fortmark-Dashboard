import "server-only";

/**
 * The contacts a new transaction may be opened for.
 *
 * Eligible means exactly: at Representation, inside the caller's own Contacts
 * scope (an admin: the brokerage; anyone else: their own book — never a
 * colleague's, however much of the brokerage's deals they may supervise), and
 * matching the typed name. A lead is not eligible, and neither is anyone who has
 * moved on to another stage or been archived, because the stage predicate is the
 * whole definition.
 *
 * Decided in SQL and bounded: a person never downloads a book to filter it in
 * the browser. The search matches names only, as a literal — `%` and `_` are
 * characters, not wildcards — and is sent in a POST body so a client's name
 * never reaches a request line.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { contacts } from "../db/schema.ts";
import { containsPattern } from "../search/query.ts";
import { displayName } from "./domain.ts";
import type { Ctx } from "./service.ts";
import { visibleTo } from "./visibility.ts";

export const ELIGIBLE_LIMIT = 25;
export const ELIGIBLE_STAGE = "representation" as const;

export interface EligibleContact {
  id: string;
  name: string;
}

export async function listEligibleContacts(ctx: Pick<Ctx, "actor" | "db">, text?: string): Promise<EligibleContact[]> {
  const clauses = [visibleTo(ctx.actor), eq(contacts.stage, ELIGIBLE_STAGE)];
  const needle = text?.trim().toLowerCase().slice(0, 100);
  if (needle) {
    const contains = containsPattern(needle);
    clauses.push(
      sql`(lower(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, ''))) like ${contains} or lower(coalesce(${contacts.preferredName}, '')) like ${contains})`
    );
  }
  const rows = await ctx.db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, preferredName: contacts.preferredName })
    .from(contacts)
    .where(and(...clauses))
    .orderBy(asc(sql`lower(coalesce(${contacts.preferredName}, trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, ''))))`), asc(contacts.id))
    .limit(ELIGIBLE_LIMIT);
  return rows.map((r) => ({ id: r.id, name: displayName(r) }));
}
