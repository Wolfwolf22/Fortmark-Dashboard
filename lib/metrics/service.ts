import "server-only";

/**
 * The brokerage metrics service.
 *
 * One request, one answer, assembled from the domain services that already
 * own the records — never from a generator, and never from a widget reaching
 * into a table on its own.
 *
 * Two rules shape everything here.
 *
 * **A number is a claim.** Each domain is asked independently and reports its
 * own availability. A domain that is switched off says `not_configured`; one
 * that fails says `unavailable`; one that answers says `available`, and then
 * zero means zero. A failure never borrows another domain's numbers and never
 * falls back to the sample set — `sampleDashboardEnabled` is the only path to
 * fabricated figures, it is off by default, and the payload labels itself
 * `source: "sample"` so the screen can say so out loud.
 *
 * **A total is a disclosure.** Every aggregate runs through the same
 * visibility predicate as the list it summarises, so an agent's dashboard
 * counts an agent's book and nobody else's. Scope is reported alongside the
 * numbers so the screen can name whose business it is describing.
 */
import { resolveBridgeConfig } from "../mls/config.ts";
import { searchListings } from "../mls/service.ts";
import { resolveActor as resolveBrokerageActor, isPrivileged, type Actor } from "../auth/actor.ts";
import type { Db } from "../db/client.ts";
import { contactsDatabaseEnabled, transactionsDatabaseEnabled, type EnvLike } from "../flags.ts";
import {
  transactionActivity,
  transactionAttention,
  transactionLeaderboard,
  transactionMetrics,
} from "../transactions/metrics.ts";
import { contactActivity, contactAttention, contactMetrics } from "../contacts/metrics.ts";
import { DEADLINE_SOON_DAYS } from "../transactions/metrics.ts";
import {
  available,
  unavailableAs,
  type ActivityItem,
  type AttentionItem,
  type BrokerageMetrics,
  type MetricAvailability,
  type MetricGroup,
} from "./types.ts";
import { monthWindow } from "./window.ts";

/** How many events the Home feed carries. Enough to be useful, not a log. */
export const ACTIVITY_LIMIT = 8;

type Ctx = { actor: Actor; db: Db };

/** A domain either has a context to query, or a reason it has none. */
type Resolution =
  | { ok: true; ctx: Ctx }
  | { ok: false; availability: Exclude<MetricAvailability, "available"> };

/**
 * `resolveActor` already distinguishes "switched off" from "cannot reach the
 * database" from "this caller has no brokerage identity yet". Those are three
 * different sentences on screen, so they stay three different states here
 * rather than collapsing into one shrug.
 */
function toResolution(
  result: Awaited<ReturnType<typeof resolveBrokerageActor>>
): Resolution {
  if (result.ok) return { ok: true, ctx: { actor: result.actor, db: result.db } };
  switch (result.reason) {
    case "disabled":
      return { ok: false, availability: "not_configured" };
    case "no_identity":
      return { ok: false, availability: "no_identity" };
    default:
      return { ok: false, availability: "unavailable" };
  }
}

/**
 * Run a domain query, or report why it could not run.
 *
 * A thrown error becomes `unavailable`. It must never become a zero: "the
 * database refused the query" and "this brokerage has no deals" are opposite
 * facts, and a dashboard that renders them identically is lying.
 */
async function attempt<T>(
  resolution: Resolution,
  run: (ctx: Ctx) => Promise<T>
): Promise<MetricGroup<T>> {
  if (!resolution.ok) return unavailableAs(resolution.availability);
  try {
    return available(await run(resolution.ctx));
  } catch {
    return unavailableAs("unavailable");
  }
}

/** Overdue first, then soonest; ties broken by subject so order is stable. */
function orderAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) => a.daysAway - b.daysAway || a.subject.localeCompare(b.subject)
  );
}

export interface MetricsOptions {
  now?: Date;
  env?: EnvLike;
}

/**
 * Real metrics for one caller.
 *
 * `clerkUserId` comes from the verified session; nothing about ownership,
 * tenancy or role is ever read from the request.
 */
export async function brokerageMetrics(
  clerkUserId: string,
  options: MetricsOptions = {}
): Promise<BrokerageMetrics> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;

  // Each domain resolves against its own flag: transactions can be live while
  // contacts are not, and the dashboard must degrade one at a time.
  const [txnResolution, contactResolution] = await Promise.all([
    resolveBrokerageActor(clerkUserId, transactionsDatabaseEnabled(env)).then(toResolution),
    resolveBrokerageActor(clerkUserId, contactsDatabaseEnabled(env)).then(toResolution),
  ]);

  const actor = txnResolution.ok
    ? txnResolution.ctx.actor
    : contactResolution.ok
      ? contactResolution.ctx.actor
      : null;
  const privileged = actor ? isPrivileged(actor) : false;

  const [transactions, contacts, txnAttention, contactAttn, txnActivity, contactActs, leaderboard] =
    await Promise.all([
      attempt(txnResolution, (ctx) => transactionMetrics(ctx, now)),
      attempt(contactResolution, (ctx) => contactMetrics(ctx, now)),
      attempt(txnResolution, (ctx) => transactionAttention(ctx, now)),
      attempt(contactResolution, (ctx) => contactAttention(ctx, now)),
      attempt(txnResolution, (ctx) => transactionActivity(ctx, ACTIVITY_LIMIT)),
      attempt(contactResolution, (ctx) => contactActivity(ctx, ACTIVITY_LIMIT)),
      privileged
        ? attempt(txnResolution, (ctx) => transactionLeaderboard(ctx, now))
        : Promise.resolve(unavailableAs<Awaited<ReturnType<typeof transactionLeaderboard>>>("not_permitted")),
    ]);

  return {
    source: "database",
    generatedAt: now.toISOString(),
    scope: privileged ? "brokerage" : "own",
    monthStart: monthWindow(now).start,
    transactions,
    contacts,
    listings: await listingMetrics(env),
    attention: combineAttention(txnAttention, contactAttn),
    activity: combineActivity(txnActivity, contactActs),
    leaderboard,
  };
}

/**
 * Listings.
 *
 * The MLS is reached through Bridge or not at all, and the three outcomes are
 * kept strictly apart:
 *
 *   not configured  -> `not_configured`. Never `0`, which would state as fact
 *                      that the brokerage has no active listings.
 *   configured, up  -> `available` with the count the MLS itself reports.
 *   configured, down-> `unavailable`. A failed call is not an empty market.
 *
 * There is no fourth path. The sample listing generator belongs to the
 * listings screens, which label it on the page, and has no business supplying
 * a figure to an executive summary.
 *
 * The count is the server-side `$count` for the same active-status filter the
 * listings screen uses — one row fetched, the total read from the envelope,
 * so asking costs a single cheap request.
 */
async function listingMetrics(env: EnvLike): Promise<MetricGroup<{ activeCount: number }>> {
  const config = resolveBridgeConfig(env);
  if (!config.ok) return unavailableAs("not_configured");
  try {
    const page = await searchListings(config.config, {
      status: ["active"],
      page: 1,
      pageSize: 1,
      sortKey: "listedDate",
      sortDirection: "desc",
    });
    return available({ activeCount: page.total });
  } catch {
    return unavailableAs("unavailable");
  }
}

/**
 * Attention items from both domains, merged.
 *
 * Available when either domain answered — a live transaction domain should
 * still surface its deadlines while contacts are off. Only when neither can
 * answer does the section report the reason, preferring the more specific of
 * the two.
 */
function combineAttention(
  fromTransactions: MetricGroup<AttentionItem[]>,
  fromContacts: MetricGroup<AttentionItem[]>
): BrokerageMetrics["attention"] {
  if (fromTransactions.availability !== "available" && fromContacts.availability !== "available") {
    return unavailableAs(
      fromTransactions.availability === "not_configured"
        ? fromContacts.availability
        : fromTransactions.availability
    );
  }
  const items = orderAttention([
    ...(fromTransactions.data ?? []),
    ...(fromContacts.data ?? []),
  ]);
  return available({
    items,
    overdueCount: items.filter((i) => i.daysAway < 0).length,
    soonCount: items.filter((i) => i.daysAway >= 0 && i.daysAway <= DEADLINE_SOON_DAYS).length,
  });
}

function combineActivity(
  fromTransactions: MetricGroup<ActivityItem[]>,
  fromContacts: MetricGroup<ActivityItem[]>
): MetricGroup<ActivityItem[]> {
  if (fromTransactions.availability !== "available" && fromContacts.availability !== "available") {
    return unavailableAs(
      fromTransactions.availability === "not_configured"
        ? fromContacts.availability
        : fromTransactions.availability
    );
  }
  const items = [...(fromTransactions.data ?? []), ...(fromContacts.data ?? [])]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_LIMIT);
  return available(items);
}
