/**
 * The time windows behind the Leads filters — and the same filters, evaluated
 * in memory.
 *
 * Every "today", "overdue" or "14+ days" the list, the snapshot cards and the
 * quick views use is one of the boundaries computed here from a single `now`,
 * and the SQL in `list.ts` compares stored instants against exactly these
 * values. That is what makes a card's number and the table it opens the same
 * number: they are not two implementations of a date rule, they are one rule
 * evaluated twice.
 *
 * The follow-up boundaries are the certified business-day ones
 * (`America/New_York`, DST-safe). The last-touch and created windows are
 * elapsed time, which is what they mean: "more than 14 days ago" is an instant,
 * not a calendar day.
 *
 * The in-memory evaluator serves the labelled sample data set and the tests.
 * It is never used to filter a partial server result: the database path
 * filters in SQL and pages there.
 *
 * Pure and isomorphic: no server-only import.
 */
import type { Lead } from "../data/types.ts";
import { businessDayKey, businessDayStart, startOfNextBusinessDay } from "../metrics/business-day.ts";
import { followUpStatus } from "./follow-up.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ContactQuery,
  type SortDir,
  type SortKey,
} from "./filters.ts";
import { ALL_CONTACT_STAGES, OPEN_PIPELINE_STAGES } from "./stages.ts";

const DAY_MS = 86_400_000;

export interface QueryWindows {
  /** First instant of today's business day. Stored strictly before this is overdue. */
  todayStart: Date;
  /** First instant of tomorrow's business day. Due today is `[todayStart, tomorrowStart)`. */
  tomorrowStart: Date;
  /** More than `days` ago: strictly before this instant. */
  cutoff: (days: 7 | 14 | 30) => Date;
}

export function queryWindows(now: Date): QueryWindows {
  return {
    todayStart: businessDayStart(businessDayKey(now)),
    tomorrowStart: startOfNextBusinessDay(now),
    cutoff: (days) => new Date(now.getTime() - days * DAY_MS),
  };
}

/**
 * The last touch actually on record. A stored contact says so explicitly; the
 * labelled sample set has no such field and its last-contact date is the touch.
 */
function recordedTouch(lead: Pick<Lead, "lastTouchDate" | "lastContactDate" | "recordSource">): string | undefined {
  return lead.lastTouchDate ?? (lead.recordSource === "sample" ? lead.lastContactDate : undefined);
}

/** A lead's last real touch: the recorded one, else — for a person never touched — when they were added. */
function touchReference(lead: Pick<Lead, "lastTouchDate" | "lastContactDate" | "createdDate" | "recordSource">): Date {
  return new Date(recordedTouch(lead) ?? lead.createdDate);
}

const OPEN = OPEN_PIPELINE_STAGES as readonly string[];

/** Whether one lead satisfies every filter in the query. `viewerId` resolves `mine`. */
export function leadMatches(lead: Lead, query: ContactQuery, now: Date, viewerId?: string): boolean {
  const w = queryWindows(now);
  if (query.stage?.length && !query.stage.includes(lead.stage)) return false;
  if (query.source?.length && !query.source.includes(lead.source)) return false;
  if (query.intent?.length && !query.intent.includes(lead.intent)) return false;
  if (query.agentId && lead.assignedAgentId !== query.agentId) return false;
  if (query.mine && viewerId && lead.assignedAgentId !== viewerId) return false;
  if (query.active && !OPEN.includes(lead.stage)) return false;

  if (query.followUp) {
    const state = followUpStatus(lead.nextFollowUpDate, now).state;
    const want = query.followUp === "upcoming" ? "future" : query.followUp;
    if (state !== want) return false;
  }
  if (query.lastTouch) {
    const touched = recordedTouch(lead);
    if (query.lastTouch === "never") {
      if (touched) return false;
    } else if (query.lastTouch === "today") {
      if (!touched || new Date(touched) < w.todayStart) return false;
    } else {
      const days = query.lastTouch === "7d" ? 7 : query.lastTouch === "14d" ? 14 : 30;
      if (!(touchReference(lead) < w.cutoff(days))) return false;
    }
  }
  if (query.created) {
    const created = new Date(lead.createdDate);
    if (query.created === "today") {
      if (created < w.todayStart) return false;
    } else if (created < new Date(now.getTime() - (query.created === "7d" ? 7 : 30) * DAY_MS)) {
      return false;
    }
  }
  if (query.q) {
    const needle = query.q.toLowerCase();
    const digits = query.q.replace(/\D/g, "");
    const hit =
      lead.name.toLowerCase().includes(needle) ||
      lead.email.toLowerCase().includes(needle) ||
      (lead.neighborhood ?? "").toLowerCase().includes(needle) ||
      (digits.length >= 4 && lead.phone.replace(/\D/g, "").endsWith(digits));
    if (!hit) return false;
  }
  return true;
}

const STAGE_ORDER = new Map(ALL_CONTACT_STAGES.map((s, i) => [s, i]));

function keyOf(lead: Lead, sort: SortKey): string | number | null {
  switch (sort) {
    case "name":
      return lead.name.toLowerCase();
    case "stage":
      return STAGE_ORDER.get(lead.stage) ?? 99;
    case "lastTouch":
      return touchReference(lead).getTime();
    case "followUp":
      return lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).getTime() : null;
    case "created":
      return new Date(lead.createdDate).getTime();
  }
}

/** The order the list has always had: most recently touched first. */
export const DEFAULT_SORT: { sort: SortKey; dir: SortDir } = { sort: "lastTouch", dir: "desc" };

export function compareLeads(a: Lead, b: Lead, sort: SortKey, dir: SortDir): number {
  const ka = keyOf(a, sort);
  const kb = keyOf(b, sort);
  // Nothing set sorts last in either direction.
  if (ka === null && kb !== null) return 1;
  if (kb === null && ka !== null) return -1;
  let c = 0;
  if (ka !== null && kb !== null) c = ka < kb ? -1 : ka > kb ? 1 : 0;
  if (dir === "desc") c = -c;
  if (c !== 0) return c;
  // Stable, so a page boundary never repeats or drops a row.
  return new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime() || (a.id < b.id ? -1 : 1);
}

export interface LeadPage {
  items: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

/** Filter, sort and (optionally) page a complete in-memory set. */
export function applyQuery(leads: readonly Lead[], query: ContactQuery, now: Date, viewerId?: string): LeadPage {
  const sort = query.sort ?? DEFAULT_SORT.sort;
  const dir = query.dir ?? (query.sort ? "asc" : DEFAULT_SORT.dir);
  const matched = leads.filter((l) => leadMatches(l, query, now, viewerId)).sort((a, b) => compareLeads(a, b, sort, dir));
  const paged = query.page !== undefined || query.pageSize !== undefined;
  if (!paged) return { items: matched, total: matched.length, page: 1, pageSize: matched.length };
  const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = query.page ?? 1;
  return { items: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize };
}

export interface LeadSnapshot {
  /** The open pipeline: lead through under contract. */
  active: number;
  /** Added in the last 7 days. */
  newThisWeek: number;
  /** Follow-up due today, open pipeline. */
  dueToday: number;
  /** Follow-up overdue, open pipeline. */
  overdue: number;
  /** No touch on record for more than 14 days, open pipeline. */
  noTouch14: number;
  /** Everyone in scope, and each stage. */
  total: number;
  byStage: Record<string, number>;
}

/** The snapshot cards, from the same predicates the table uses. */
export function snapshotOf(leads: readonly Lead[], now: Date, viewerId?: string): LeadSnapshot {
  const count = (q: ContactQuery) => leads.filter((l) => leadMatches(l, q, now, viewerId)).length;
  const byStage: Record<string, number> = {};
  for (const l of leads) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
  return {
    active: count({ active: true }),
    newThisWeek: count({ created: "7d" }),
    dueToday: count({ active: true, followUp: "due_today" }),
    overdue: count({ active: true, followUp: "overdue" }),
    noTouch14: count({ active: true, lastTouch: "14d" }),
    total: leads.length,
    byStage,
  };
}
