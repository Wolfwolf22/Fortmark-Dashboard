import "server-only";

/**
 * Finding people.
 *
 * The contact provider for unified search. It lives inside the contact domain
 * for the same reason the aggregates do: it must return exactly the rows this
 * caller could have listed, using the same `visibleTo` predicate, so search
 * can never become a way around the ownership rules the list screens enforce.
 *
 * It returns identification, not records. A name, what kind of relationship it
 * is, and one contact detail to tell two Smiths apart. Notes, tags, budgets
 * and activity never leave this function — those are what opening the contact
 * is for.
 */
import { and, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { contacts } from "../db/schema.ts";
import type { Actor } from "../auth/actor.ts";
import { visibleTo } from "./service.ts";
import { displayName } from "./domain.ts";
import { CONTACT_STAGE_LABELS, type ContactStage } from "./stages.ts";
import { containsPattern, prefixPattern, type ParsedQuery } from "../search/query.ts";
import type { MatchKind, SearchHit } from "../search/types.ts";

export interface Ctx {
  actor: Actor;
  db: Db;
}

/** The columns a search result is allowed to see. Nothing else is selected. */
const COLUMNS = {
  id: contacts.id,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  preferredName: contacts.preferredName,
  email: contacts.email,
  phoneE164: contacts.phoneE164,
  company: contacts.company,
  stage: contacts.stage,
};

/** The full name as stored, for prefix matching against "Jane Smith". */
const FULL_NAME = sql`lower(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')))`;
const PREFERRED = sql`lower(coalesce(${contacts.preferredName}, ''))`;
const FIRST = sql`lower(coalesce(${contacts.firstName}, ''))`;
const LAST = sql`lower(coalesce(${contacts.lastName}, ''))`;
const COMPANY = sql`lower(coalesce(${contacts.company}, ''))`;

function nameMatches(pattern: string): SQL {
  return or(
    sql`${FULL_NAME} like ${pattern}`,
    sql`${PREFERRED} like ${pattern}`,
    sql`${FIRST} like ${pattern}`,
    sql`${LAST} like ${pattern}`,
    sql`${COMPANY} like ${pattern}`
  )!;
}

/**
 * The predicate and the reason it matched, together.
 *
 * They are returned as a pair because the match kind is what ranking is built
 * on, and deriving it a second time in JavaScript from the row would be a
 * second implementation of the same rule, free to disagree with this one.
 */
function criteria(query: ParsedQuery): { where: SQL; match: SQL<MatchKind> } | null {
  switch (query.shape) {
    case "email":
      return {
        where: sql`lower(${contacts.email}) = ${query.lower}`,
        match: sql<MatchKind>`'exact_email'`,
      };
    case "phone":
      // Stored E.164 is digits after a leading '+', so a digits-only query is
      // a suffix of it: '+19545550100' ends with '9545550100'. That also makes
      // a query typed as (954) 555-0100 match without touching stored data.
      return {
        where: sql`${contacts.phoneE164} like ${"%" + query.digits}`,
        match: sql<MatchKind>`'exact_phone'`,
      };
    case "uuid":
      return {
        where: sql`${contacts.id}::text = ${query.lower}`,
        match: sql<MatchKind>`'exact_id'`,
      };
    case "mls":
      // An MLS number identifies a property, never a person.
      return null;
    default: {
      const prefix = prefixPattern(query.lower);
      const contains = containsPattern(query.lower);
      return {
        where: or(
          nameMatches(contains),
          sql`lower(coalesce(${contacts.email}, '')) like ${contains}`
        )!,
        match: sql<MatchKind>`case when ${nameMatches(prefix)} then 'prefix' else 'partial' end`,
      };
    }
  }
}

export async function searchContacts(
  ctx: Ctx,
  query: ParsedQuery,
  limit: number
): Promise<SearchHit[]> {
  const rule = criteria(query);
  if (!rule) return [];

  const rows = await ctx.db
    .select({ ...COLUMNS, match: rule.match })
    .from(contacts)
    .where(and(visibleTo(ctx.actor), rule.where))
    // Ordered so the cap takes a stable subset; final ordering is the
    // orchestrator's, which ranks across every provider at once.
    .orderBy(FULL_NAME, contacts.id)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    entity: "contact" as const,
    title: displayName(row),
    subtitle: subtitleFor(row.stage as ContactStage, row.company),
    meta: row.email ?? row.phoneE164 ?? undefined,
    href: `/leads?open=${encodeURIComponent(row.id)}`,
    match: row.match as MatchKind,
  }));
}

/** Where the relationship stands, and who they are with. Never a note. */
function subtitleFor(stage: ContactStage, company: string | null): string {
  const label = CONTACT_STAGE_LABELS[stage];
  return company ? `${label} · ${company}` : label;
}
