/**
 * What Home shows, as pure decisions.
 *
 * These three predicates are the product judgements the real-data transition
 * forced, and they are kept out of the components so they can be tested
 * directly rather than inferred from a rendered tree.
 *
 * Each one hides or reshapes *presentation* only. None of them changes a
 * figure, suppresses a zero, or invents anything: the metrics payload still
 * carries every availability, and `/api/health` still reports every source.
 *
 * Isomorphic and dependency-free.
 */
import type { BrokerageMetrics } from "./types.ts";

/**
 * Show the brokerage leaderboard?
 *
 * Only when there is a real list behind it. For an agent the metrics service
 * returns `not_permitted`, and rendering a card that explains that on every
 * page load is worse than rendering nothing: it advertises, daily, a thing
 * the reader is not allowed to have.
 */
export function leaderboardVisible(metrics: BrokerageMetrics | undefined): boolean {
  return metrics?.leaderboard.availability === "available";
}

/**
 * Should the MLS module take a narrow slot?
 *
 * Connected, it is a wide image card. Not connected, its whole content is one
 * status line — and a full-width panel reading "Not connected" was the largest
 * element on a page meant to show what matters today. An optional integration
 * being absent must never be the loudest thing a brokerage sees each morning.
 */
export function mlsIsCompact(metrics: BrokerageMetrics | undefined): boolean {
  return metrics?.listings.availability !== "available";
}

/**
 * A brokerage with nothing in it yet.
 *
 * Both domains answered and both are empty. That is a fact about a new agent,
 * not a failure and not a reason to invent a demonstration — the brief still
 * renders its zeros, and this only decides whether to offer the two ways to
 * begin. It is deliberately false when either domain is unavailable: we do not
 * invite someone to start over because a database was unreachable.
 */
export function isFirstUse(metrics: BrokerageMetrics): boolean {
  const t = metrics.transactions;
  const c = metrics.contacts;
  if (t.availability !== "available" || c.availability !== "available") return false;
  const noDeals =
    t.data.activeCount === 0 &&
    t.data.onHoldCount === 0 &&
    t.data.monthly.every((month) => month.closedCount === 0);
  const noContacts = c.data.lifecycle.every((stage) => stage.count === 0);
  return noDeals && noContacts;
}
