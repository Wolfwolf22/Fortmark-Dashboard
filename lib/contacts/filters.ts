/**
 * The Leads query: what a request may ask of the contact list, parsed once for
 * both shapes it arrives in.
 *
 * The list screen sends its non-identifying filters in a query string; the
 * search term arrives in a POST body instead (`app/api/contacts/search`).
 * Both paths must agree on what a valid query is, so both run through
 * `parseContactQuery`. `read` is a plain key lookup, satisfied by
 * `URLSearchParams.get` or by a JSON object.
 *
 * Strict on purpose. A filter the server does not understand is an error the
 * caller is told about, never a filter that quietly disappears: `?stage=garbage`
 * used to become "every contact", which is the opposite of what was asked.
 *
 * Isomorphic: no server-only import, so a test — and the sample data set in the
 * browser — can use it without a request.
 */
import type { LeadIntent, LeadSource, LeadStage } from "../data/types.ts";
import { ALL_CONTACT_STAGES } from "./stages.ts";

export const SOURCES: readonly LeadSource[] = ["referral", "sphere", "sign_call", "website", "open_house", "past_client", "social", "advertising", "walk_in", "other"];
export const INTENTS: readonly LeadIntent[] = ["buy", "sell", "both", "lease", "invest", "other"];

/** Where the stored follow-up stands, judged on the business day. */
export const FOLLOW_UP_FILTERS = ["overdue", "due_today", "upcoming", "none"] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

/**
 * How long since the last real touch. `7d`/`14d`/`30d` mean MORE than that many
 * days; `today` is a touch on the business day; `never` is no touch on record.
 */
export const LAST_TOUCH_FILTERS = ["today", "7d", "14d", "30d", "never"] as const;
export type LastTouchFilter = (typeof LAST_TOUCH_FILTERS)[number];

export const CREATED_FILTERS = ["today", "7d", "30d"] as const;
export type CreatedFilter = (typeof CREATED_FILTERS)[number];

export const SORT_KEYS = ["name", "stage", "lastTouch", "followUp", "created"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 10_000;

export interface ContactQuery {
  stage?: LeadStage[];
  source?: LeadSource[];
  intent?: LeadIntent[];
  /** A specific assigned agent. Honoured for privileged callers only. */
  agentId?: string;
  /** Contacts assigned to the caller. Resolved on the server, never by id. */
  mine?: boolean;
  /** Only the open pipeline: lead through under contract (see `OPEN_PIPELINE_STAGES`). */
  active?: boolean;
  followUp?: FollowUpFilter;
  lastTouch?: LastTouchFilter;
  created?: CreatedFilter;
  /** Literal search text. Never a pattern. */
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  /** 1-based. Present (with or without `pageSize`) means a paged answer. */
  page?: number;
  pageSize?: number;
}

export type FilterReader = (key: string) => string | null;

export type ParsedContactQuery =
  | { ok: true; query: ContactQuery }
  | { ok: false; fields: string[] };

const AGENT_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Parse and validate. Returns the names of every parameter that is wrong so the
 * caller can say which — never the values, which may be identifying.
 *
 * An empty value means "not given". A list with even one bad member is wrong as
 * a whole: half a filter is a different question from the one asked.
 */
export function parseContactQuery(read: FilterReader): ParsedContactQuery {
  const bad: string[] = [];
  const given = (key: string): string | null => {
    const raw = read(key);
    if (raw === null || raw === undefined) return null;
    const value = String(raw).trim();
    return value === "" ? null : value;
  };
  const list = <T extends string>(key: string, allowed: readonly T[]): T[] | undefined => {
    const raw = given(key);
    if (!raw) return undefined;
    const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length === 0 || parts.some((p) => !(allowed as readonly string[]).includes(p))) {
      bad.push(key);
      return undefined;
    }
    return Array.from(new Set(parts)) as T[];
  };
  const one = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const raw = given(key);
    if (!raw) return undefined;
    if (!(allowed as readonly string[]).includes(raw)) {
      bad.push(key);
      return undefined;
    }
    return raw as T;
  };
  const flag = (key: string): boolean | undefined => {
    const raw = given(key);
    if (!raw) return undefined;
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    bad.push(key);
    return undefined;
  };
  const integer = (key: string, min: number, max: number): number | undefined => {
    const raw = given(key);
    if (!raw) return undefined;
    if (!/^\d{1,6}$/.test(raw)) {
      bad.push(key);
      return undefined;
    }
    const n = Number(raw);
    if (n < min || n > max) {
      bad.push(key);
      return undefined;
    }
    return n;
  };

  const query: ContactQuery = {};
  const stage = list("stage", ALL_CONTACT_STAGES as readonly LeadStage[]);
  if (stage) query.stage = stage;
  const source = list("source", SOURCES);
  if (source) query.source = source;
  const intent = list("intent", INTENTS);
  if (intent) query.intent = intent;

  const agent = given("agent");
  if (agent) {
    if (AGENT_ID.test(agent)) query.agentId = agent;
    else bad.push("agent");
  }
  if (flag("mine")) query.mine = true;
  if (flag("active")) query.active = true;

  const followUp = one("followUp", FOLLOW_UP_FILTERS);
  if (followUp) query.followUp = followUp;
  const lastTouch = one("lastTouch", LAST_TOUCH_FILTERS);
  if (lastTouch) query.lastTouch = lastTouch;
  const created = one("created", CREATED_FILTERS);
  if (created) query.created = created;

  const sort = one("sort", SORT_KEYS);
  if (sort) query.sort = sort;
  const dir = one("dir", ["asc", "desc"] as const);
  if (dir) query.dir = dir;
  const page = integer("page", 1, MAX_PAGE);
  if (page !== undefined) query.page = page;
  const pageSize = integer("pageSize", 1, MAX_PAGE_SIZE);
  if (pageSize !== undefined) query.pageSize = pageSize;

  const q = read("q");
  const text = typeof q === "string" ? q.trim().slice(0, 120) : "";
  if (text) query.q = text;

  return bad.length ? { ok: false, fields: Array.from(new Set(bad)) } : { ok: true, query };
}

/** True when the caller asked for pages. Otherwise the list answers as it always did. */
export function isPaged(query: ContactQuery): boolean {
  return query.page !== undefined || query.pageSize !== undefined;
}

// --- The quick views ---------------------------------------------------------------

/**
 * Presets over the same query. A view is a shortcut for a set of filters and
 * nothing more: it is not a dataset, it has no state of its own, and choosing
 * one is choosing exactly these parameters.
 *
 * The follow-up and no-touch views are scoped to the open pipeline for the same
 * reason Home's Needs-attention queue is: a lost or archived person is not owed
 * a call.
 */
export const QUICK_VIEWS = [
  { id: "all", label: "All contacts", filters: {} },
  // Leads are the earlier stages, before anyone has agreed to anything.
  { id: "mine", label: "My leads", filters: { mine: true, stage: ["lead", "contacted", "qualified", "appointment"] } },
  { id: "representation", label: "Representation", filters: { stage: ["representation"] } },
  // Exactly the `active_client` stage — Representation is its own view, and the two are never merged.
  { id: "active_clients", label: "Active clients", filters: { stage: ["active_client"] } },
  { id: "due_today", label: "Due today", filters: { active: true, followUp: "due_today" } },
  { id: "overdue", label: "Overdue", filters: { active: true, followUp: "overdue" } },
  { id: "no_touch_14", label: "No touch 14+ days", filters: { active: true, lastTouch: "14d" } },
] as const satisfies readonly { id: string; label: string; filters: ContactQuery }[];

export type QuickViewId = (typeof QUICK_VIEWS)[number]["id"];

/** The keys that define what is shown, as opposed to how (sort, page) or the search text. */
const FILTER_KEYS = ["stage", "source", "intent", "agentId", "mine", "active", "followUp", "lastTouch", "created"] as const;

/** Which quick view, if any, exactly matches these filters. Sort, paging and search are not part of it. */
export function matchingView(query: ContactQuery): QuickViewId | null {
  const set = (q: ContactQuery) => FILTER_KEYS.filter((k) => q[k] !== undefined && !(Array.isArray(q[k]) && (q[k] as unknown[]).length === 0));
  const mine = set(query);
  for (const view of QUICK_VIEWS) {
    const preset = view.filters as ContactQuery;
    const keys = set(preset);
    if (keys.length === mine.length && keys.every((k) => JSON.stringify(preset[k]) === JSON.stringify(query[k]))) return view.id;
  }
  return null;
}

/** How many filters are narrowing the list (search text counts once). */
export function filterCount(query: ContactQuery): number {
  const n = FILTER_KEYS.filter((k) => query[k] !== undefined).length;
  return n + (query.q ? 1 : 0);
}
