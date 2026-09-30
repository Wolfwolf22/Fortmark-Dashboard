/**
 * The Leads filters, as SQL.
 *
 * Every filter is answered by the database — filtering, sorting, paging and the
 * snapshot counts — so nothing is ever narrowed in the browser over a result
 * that was already cut off. The time boundaries come from `queryWindows`, the
 * same values the in-memory evaluator uses, which is what keeps a card's count
 * equal to the rows in the table it opens.
 *
 * The search text is LITERAL. `%` and `_` in what a person types are escaped
 * (`escapeLike`) so `q=%` looks for a percent sign, not for everything; the
 * predicate is added to the visibility predicate, never in place of it.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, not, or, sql, type SQL } from "drizzle-orm";
import { contactOpportunities, contacts } from "../db/schema.ts";
import type { Actor } from "../auth/actor.ts";
import { isBrokerageAdmin } from "../auth/actor.ts";
import { containsPattern } from "../search/query.ts";
import type { ContactRow } from "../db/schema.ts";
import type { LeadIntent } from "../data/types.ts";
import { queryWindows } from "./windows.ts";
import type { ContactQuery, SortDir, SortKey } from "./filters.ts";
import { OPEN_PIPELINE_STAGES } from "./stages.ts";
import { visibleTo } from "./visibility.ts";

const DAY_MS = 86_400_000;

/** Does the person have an open need of one of these kinds? */
function hasOpenNeed(kinds: readonly string[]): SQL {
  return sql`exists (select 1 from ${contactOpportunities} where ${eq(contactOpportunities.contactId, contacts.id)} and ${eq(contactOpportunities.status, "open")} and ${inArray(contactOpportunities.kind, kinds as never)})`;
}

const BUYING = ["buyer", "commercial_buyer"];
const SELLING = ["seller", "commercial_seller"];
const LEASING = ["tenant", "landlord", "commercial_tenant", "commercial_landlord"];
const INVESTING = ["investor"];

/** The SQL twin of `toIntent`: the same decision, made where the rows are. */
function intentPredicate(intent: LeadIntent): SQL {
  const buying = hasOpenNeed(BUYING);
  const selling = hasOpenNeed(SELLING);
  const leasing = hasOpenNeed(LEASING);
  const investing = hasOpenNeed(INVESTING);
  switch (intent) {
    case "buy":
      return and(buying, not(selling))!;
    case "sell":
      return and(selling, not(buying))!;
    case "both":
      return and(buying, selling)!;
    case "lease":
      return and(not(buying), not(selling), leasing)!;
    case "invest":
      return and(not(buying), not(selling), not(leasing), investing)!;
    case "other":
      return and(not(buying), not(selling), not(leasing), not(investing))!;
  }
}

/** A person's last touch, or — for someone never touched — when they were added. */
const TOUCH_REFERENCE = sql`coalesce(${contacts.lastContactAt}, ${contacts.createdAt})`;

/** The literal-text search: name, preferred name, company, email, neighbourhood, phone digits. */
export function textPredicate(text: string): SQL {
  const needle = text.trim().toLowerCase();
  const contains = containsPattern(needle);
  const digits = text.replace(/\D/g, "");
  const clauses: SQL[] = [
    sql`lower(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, ''))) like ${contains}`,
    sql`lower(coalesce(${contacts.preferredName}, '')) like ${contains}`,
    sql`lower(coalesce(${contacts.company}, '')) like ${contains}`,
    sql`lower(coalesce(${contacts.email}, '')) like ${contains}`,
    sql`exists (select 1 from ${contactOpportunities} o where o.contact_id = ${contacts.id} and lower(coalesce(o.area, '')) like ${contains})`,
  ];
  // Stored numbers are E.164, so typed digits match as a suffix: (954) 555-0100
  // finds +19545550100. Only digits go into this pattern — nothing to escape.
  if (digits.length >= 4) clauses.push(sql`${contacts.phoneE164} like ${"%" + digits}`);
  return or(...clauses)!;
}

/**
 * Every filter in the query except visibility, as predicates to AND together.
 * `viewerId` resolves `mine`; `now` fixes every window.
 */
export function filterPredicates(actor: Actor, query: ContactQuery, now: Date): SQL[] {
  const w = queryWindows(now);
  const out: SQL[] = [];

  if (query.stage?.length) out.push(inArray(contacts.stage, query.stage));
  if (query.active) out.push(inArray(contacts.stage, OPEN_PIPELINE_STAGES as unknown as ContactRow["stage"][]));
  if (query.source?.length) out.push(inArray(contacts.source, query.source as ContactRow["source"][]));
  if (query.intent?.length) out.push(or(...query.intent.map(intentPredicate))!);
  // A colleague's book is a privileged view; anyone else already only sees their own.
  if (query.agentId && isBrokerageAdmin(actor)) out.push(eq(contacts.assignedAgentUserId, query.agentId));
  if (query.mine) out.push(eq(contacts.assignedAgentUserId, actor.userId));

  switch (query.followUp) {
    case "overdue":
      out.push(and(isNotNull(contacts.nextFollowUpAt), lt(contacts.nextFollowUpAt, w.todayStart))!);
      break;
    case "due_today":
      out.push(and(gte(contacts.nextFollowUpAt, w.todayStart), lt(contacts.nextFollowUpAt, w.tomorrowStart))!);
      break;
    case "upcoming":
      out.push(gte(contacts.nextFollowUpAt, w.tomorrowStart));
      break;
    case "none":
      out.push(isNull(contacts.nextFollowUpAt));
      break;
  }

  switch (query.lastTouch) {
    case "never":
      out.push(isNull(contacts.lastContactAt));
      break;
    case "today":
      out.push(and(isNotNull(contacts.lastContactAt), gte(contacts.lastContactAt, w.todayStart))!);
      break;
    case "7d":
    case "14d":
    case "30d": {
      // Reads last contact (or creation, for someone never touched) and nothing
      // else: scheduling a reminder or editing a record cannot make a stale
      // contact look recent.
      const days = query.lastTouch === "7d" ? 7 : query.lastTouch === "14d" ? 14 : 30;
      out.push(sql`${TOUCH_REFERENCE} < ${w.cutoff(days)}`);
      break;
    }
  }

  switch (query.created) {
    case "today":
      out.push(gte(contacts.createdAt, w.todayStart));
      break;
    case "7d":
      out.push(gte(contacts.createdAt, new Date(now.getTime() - 7 * DAY_MS)));
      break;
    case "30d":
      out.push(gte(contacts.createdAt, new Date(now.getTime() - 30 * DAY_MS)));
      break;
  }

  if (query.q) out.push(textPredicate(query.q));
  return out;
}

/** Visibility first, then the filters. There is no filter that can widen visibility. */
export function contactWhere(actor: Actor, query: ContactQuery, now: Date): SQL {
  return and(visibleTo(actor), ...filterPredicates(actor, query, now))!;
}

/** The name as the screen shows it, lower-cased for ordering. */
const NAME_KEY = sql`lower(coalesce(nullif(trim(coalesce(${contacts.preferredName}, '')), ''), nullif(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')), ''), ''))`;

/**
 * The order. Whatever the key, ties fall back to newest-first then id, so a
 * page boundary never repeats or drops a row. A follow-up that is not set
 * sorts last in either direction.
 */
export function contactOrder(sort: SortKey | undefined, dir: SortDir | undefined): SQL[] {
  const direction = dir ?? (sort ? "asc" : "desc");
  const by = (expr: SQL) => (direction === "desc" ? sql`${expr} desc` : sql`${expr} asc`);
  const tail = [desc(contacts.createdAt), asc(contacts.id)];
  switch (sort ?? "lastTouch") {
    case "name":
      return [by(NAME_KEY), ...tail];
    case "stage":
      // The enum is declared in lifecycle order, so this is lifecycle order.
      return [by(sql`${contacts.stage}`), ...tail];
    case "followUp":
      return [sql`${contacts.nextFollowUpAt} ${direction === "desc" ? sql`desc` : sql`asc`} nulls last`, ...tail];
    case "created":
      return [by(sql`${contacts.createdAt}`), asc(contacts.id)];
    case "lastTouch":
    default:
      return [by(TOUCH_REFERENCE), ...tail];
  }
}
