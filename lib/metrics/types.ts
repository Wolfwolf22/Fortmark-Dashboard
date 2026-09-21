/**
 * The brokerage metrics contract.
 *
 * One rule governs this file: **a number here is a claim about the business,
 * and FortMark only makes claims it can prove.** Every group therefore
 * carries an availability before it carries data, because `0` and "we could
 * not ask" are different facts and must never render the same way.
 *
 *   available      the source answered. The numbers are facts. Zero means zero.
 *   not_configured this deployment has no such source connected.
 *   not_permitted  the caller's role may not see this aggregate.
 *   no_identity    the caller has no brokerage identity yet (profile unsynced).
 *   unavailable    the source exists but could not be reached this time.
 *
 * Money is integer cents throughout, as everywhere else in the domain. Dates
 * that name a day are `YYYY-MM-DD`; instants are ISO strings.
 *
 * Isomorphic: no server-only imports, so the browser and the tests can both
 * hold this shape.
 */
import type { ContactStage } from "../contacts/stages.ts";
import type { LeadSource } from "../data/types.ts";

export type MetricAvailability =
  | "available"
  | "not_configured"
  | "not_permitted"
  | "no_identity"
  | "unavailable";

export type MetricGroup<T> =
  | { availability: "available"; data: T }
  | { availability: Exclude<MetricAvailability, "available">; data?: undefined };

export function available<T>(data: T): MetricGroup<T> {
  return { availability: "available", data };
}

export function unavailableAs<T>(
  availability: Exclude<MetricAvailability, "available">
): MetricGroup<T> {
  return { availability };
}

// --- Transactions ------------------------------------------------------------

/** One month of closed production. Oldest first in the series. */
export interface MonthPoint {
  /** First day of the month, `YYYY-MM-01`. */
  month: string;
  closedCount: number;
  closedVolumeCents: number;
  /** Gross commission projected from the terms of the deals closed that month. */
  commissionCents: number;
}

export interface TransactionMetrics {
  /** Deals in an active lifecycle stage. Excludes closed and every terminal
   *  stage, and excludes `on_hold` — a paused deal is not being worked. */
  activeCount: number;
  /** On hold, reported separately rather than hidden inside "active". */
  onHoldCount: number;
  /** Sum of contract prices across active deals **that have one**. */
  activeVolumeCents: number;
  /** Active deals with no contract price yet: the sum above does not include
   *  them, and the UI says so rather than implying the total is complete. */
  activeVolumeUnpricedCount: number;
  /** Gross commission projected from active deals' stated terms. */
  projectedCommissionCents: number;
  /** Active deals whose commission terms are not entered, so they project
   *  nothing. Reported so "projected" is never mistaken for "complete". */
  projectedCommissionUntermedCount: number;
  /** Active deals scheduled to close inside the current calendar month.
   *  Scheduled — not closed. The two are never merged. */
  scheduledClosingsThisMonth: number;
  /** Deals that actually reached `closed` with a closed date this month. */
  closedThisMonthCount: number;
  closedThisMonthVolumeCents: number;
  /** Real monthly production, oldest first. Empty when nothing has closed. */
  monthly: MonthPoint[];
}

// --- Contacts ----------------------------------------------------------------

export interface ContactMetrics {
  /** Contacts in ACTIVE_CLIENT_STAGES — one shared definition. */
  activeClients: number;
  /** Contacts created inside the current calendar month. The label says
   *  "this month" and the window is the calendar month; they always agree. */
  newLeadsThisMonth: number;
  /** Contacts in the open pipeline whose next follow-up is due today or
   *  earlier. A deliberate follow-up date, never an inferred staleness rule. */
  followUpsDue: number;
  /** Every lifecycle stage with its count. Zero-count stages are included so
   *  the pipeline strip renders the shape of the business, not just its peaks. */
  lifecycle: { stage: ContactStage; count: number }[];
  /** Where this month's new contacts came from. Only sources actually seen. */
  newLeadsBySource: { source: LeadSource; count: number }[];
}

// --- Listings ----------------------------------------------------------------

export interface ListingMetrics {
  activeCount: number;
}

// --- Needs attention ---------------------------------------------------------

export type AttentionKind = "deadline_overdue" | "deadline_soon" | "follow_up_due";

/**
 * One thing a person should do something about.
 *
 * Every item is explainable in one line — the rule that produced it is named
 * by `kind`, and `dueDate` is the fact behind it. No scores, no weighting, no
 * opinion dressed up as arithmetic.
 */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  /** What is due: the deadline's label, or "Follow up". */
  label: string;
  /** Who or what it concerns: a property address, or a contact's name. */
  subject: string;
  /** The day it is due, `YYYY-MM-DD`. */
  dueDate: string;
  /** Whole days from today. Negative when overdue. */
  daysAway: number;
  href: string;
}

export interface AttentionMetrics {
  items: AttentionItem[];
  overdueCount: number;
  soonCount: number;
}

// --- Recent activity ---------------------------------------------------------

export type ActivityKind =
  | "transaction_created"
  | "transaction_stage_changed"
  | "transaction_closed"
  | "contact_created"
  | "contact_stage_changed"
  | "contact_touch";

/**
 * A presentation-layer event. Built from `transaction_events` and
 * `contact_activities` — never from the audit log, which records who did what
 * for compliance and is not a feed.
 */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** One line, already phrased for a person. */
  summary: string;
  subject: string;
  /** ISO instant. */
  at: string;
  href: string;
}

// --- Leaderboard -------------------------------------------------------------

export interface LeaderboardRow {
  agentUserId: string;
  name: string;
  closedCount: number;
  closedVolumeCents: number;
  activeCount: number;
}

// --- The payload -------------------------------------------------------------

/**
 * What the numbers cover, so the screen can say it out loud.
 *
 *   own        the caller's own book of business
 *   brokerage  every record in the brokerage (privileged roles only)
 */
export type MetricScope = "own" | "brokerage";

export interface BrokerageMetrics {
  /** `database` when these came from real records; `sample` only in the
   *  explicit fixture mode, which the UI labels on screen. */
  source: "database" | "sample";
  generatedAt: string;
  scope: MetricScope;
  /** First day of the calendar month the "this month" figures cover. */
  monthStart: string;
  transactions: MetricGroup<TransactionMetrics>;
  contacts: MetricGroup<ContactMetrics>;
  listings: MetricGroup<ListingMetrics>;
  attention: MetricGroup<AttentionMetrics>;
  activity: MetricGroup<ActivityItem[]>;
  leaderboard: MetricGroup<LeaderboardRow[]>;
}
