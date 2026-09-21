import "server-only";

/**
 * Finding deals.
 *
 * Real estate is address-heavy, so the property is the title and everything
 * else is there to tell two units in the same building apart. A deal also
 * matches on the people attached to it — `transaction_parties` already links
 * a party to a contact — because "the Brickell deal" and "Jane's deal" are
 * the same thought from two directions.
 *
 * Scoped by the same `visibleTo` predicate as the transactions list, so search
 * cannot surface a deal the caller could not open.
 *
 * Identification only. No price, no commission, no notes, no documents: a
 * closing date is the most a result will say about a deal's substance, and
 * only when one has actually been entered.
 */
import { and, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { contacts, transactionParties, transactions } from "../db/schema.ts";
import type { Actor } from "../auth/actor.ts";
import { visibleTo } from "./service.ts";
import { STAGE_LABELS, type TransactionStage } from "./stages.ts";
import { containsPattern, prefixPattern, type ParsedQuery } from "../search/query.ts";
import type { MatchKind, SearchHit } from "../search/types.ts";

export interface Ctx {
  actor: Actor;
  db: Db;
}

const COLUMNS = {
  id: transactions.id,
  addressLine1: transactions.addressLine1,
  addressLine2: transactions.addressLine2,
  city: transactions.city,
  side: transactions.side,
  stage: transactions.stage,
  closingDate: transactions.closingDate,
  closedDate: transactions.closedDate,
  mlsNumber: transactions.mlsNumber,
};

const SIDE_LABELS: Record<string, string> = {
  listing: "Listing",
  buyer: "Buyer",
  dual: "Dual",
  landlord: "Landlord",
  tenant: "Tenant",
};

const ADDRESS = sql`lower(trim(coalesce(${transactions.addressLine1}, '') || ' ' || coalesce(${transactions.addressLine2}, '')))`;
const CITY = sql`lower(coalesce(${transactions.city}, ''))`;

/** A party on this deal whose name matches. Bounded by the outer row set. */
function partyMatches(pattern: string): SQL {
  return sql`exists (select 1 from ${transactionParties} p where p.transaction_id = ${transactions.id} and lower(p.display_name) like ${pattern})`;
}

function criteria(query: ParsedQuery): { where: SQL; match: SQL<MatchKind> } | null {
  switch (query.shape) {
    case "uuid":
      return {
        where: sql`${transactions.id}::text = ${query.lower}`,
        match: sql<MatchKind>`'exact_id'`,
      };
    case "mls":
      return {
        where: sql`upper(coalesce(${transactions.mlsNumber}, '')) = ${query.mls}`,
        match: sql<MatchKind>`'exact_mls'`,
      };
    case "email":
      return {
        where: sql`exists (select 1 from ${transactionParties} p where p.transaction_id = ${transactions.id} and lower(p.email) = ${query.lower})`,
        match: sql<MatchKind>`'exact_email'`,
      };
    case "phone":
      // Either the number recorded on the party itself, or the one on the
      // contact it is linked to — `transaction_parties.contact_id` exists so
      // the person and the party are not two separate records of a phone
      // number, and a deal should be findable by whichever one is filled in.
      return {
        where: sql`exists (select 1 from ${transactionParties} p left join ${contacts} c on c.id = p.contact_id where p.transaction_id = ${transactions.id} and (p.phone_e164 like ${"%" + query.digits} or c.phone_e164 like ${"%" + query.digits}))`,
        match: sql<MatchKind>`'exact_phone'`,
      };
    default: {
      const prefix = prefixPattern(query.lower);
      const contains = containsPattern(query.lower);
      // Address containment is what makes "brickell" find "2451 Brickell Ave";
      // an anchored prefix alone would only match a street number.
      const anyMatch = or(
        sql`${ADDRESS} like ${contains}`,
        sql`${CITY} like ${contains}`,
        sql`lower(coalesce(${transactions.mlsNumber}, '')) like ${contains}`,
        partyMatches(contains)
      )!;
      const strongMatch = or(
        sql`${ADDRESS} like ${prefix}`,
        sql`${CITY} like ${prefix}`,
        partyMatches(prefix)
      )!;
      return {
        where: anyMatch,
        match: sql<MatchKind>`case when ${strongMatch} then 'prefix' else 'partial' end`,
      };
    }
  }
}

export async function searchTransactions(
  ctx: Ctx,
  query: ParsedQuery,
  limit: number
): Promise<SearchHit[]> {
  const rule = criteria(query);
  if (!rule) return [];

  const rows = await ctx.db
    .select({ ...COLUMNS, match: rule.match })
    .from(transactions)
    .where(and(visibleTo(ctx.actor), rule.where))
    .orderBy(ADDRESS, transactions.id)
    .limit(limit);

  return rows.map((row) => {
    const stage = row.stage as TransactionStage;
    const address = [row.addressLine1, row.addressLine2].filter(Boolean).join(" ");
    return {
      id: row.id,
      entity: "transaction" as const,
      title: row.city ? `${address}, ${row.city}` : address,
      subtitle: `${SIDE_LABELS[row.side] ?? row.side} · ${STAGE_LABELS[stage]}`,
      meta: dateNote(stage, row.closingDate, row.closedDate),
      href: `/transactions?open=${encodeURIComponent(row.id)}`,
      match: row.match as MatchKind,
    };
  });
}

/**
 * The one date worth putting on a search result, and only if it exists.
 *
 * A closed deal reports when it closed; a live one reports when it is due to.
 * A deal with no date entered says nothing rather than inventing a placeholder.
 */
function dateNote(
  stage: TransactionStage,
  closingDate: string | null,
  closedDate: string | null
): string | undefined {
  const format = (day: string) =>
    new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  if (stage === "closed") return closedDate ? `Closed ${format(closedDate)}` : undefined;
  return closingDate ? `Closing ${format(closingDate)}` : undefined;
}
