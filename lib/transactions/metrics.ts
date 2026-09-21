import "server-only";

/**
 * Transaction aggregates.
 *
 * These live inside the transaction domain, not in a separate analytics
 * layer, for one reason: they must count exactly the rows the caller could
 * have listed, using exactly the lifecycle the rest of the domain uses. A
 * total is a disclosure, and a second definition of "active" is a second
 * truth. So `visibleTo` comes from the service and the stage sets come from
 * `stages.ts`; nothing here decides either for itself.
 *
 * Aggregation happens in Postgres where it is a count or a sum. It happens in
 * JavaScript for exactly one thing — commission — because that arithmetic is
 * `money.ts`'s job and re-implementing it in SQL would create a second, subtly
 * different answer. Those rows are fetched as a narrow projection of integer
 * columns, in one query, not per deal.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  dashboardUsers,
  professionalProfiles,
  transactionDeadlines,
  transactionEvents,
  transactions,
} from "../db/schema.ts";
import type { Actor } from "../auth/actor.ts";
import { isPrivileged } from "../auth/actor.ts";
import { visibleTo } from "./service.ts";
import { ACTIVE_STAGES, PAUSED_STAGE, STAGE_LABELS, type TransactionStage } from "./stages.ts";
import { projectCommission } from "./money.ts";
import type {
  ActivityItem,
  AttentionItem,
  LeaderboardRow,
  MonthPoint,
  TransactionMetrics,
} from "../metrics/types.ts";
import { daysUntil, dayKey, monthBucket, monthSeries, monthWindow, toInt } from "../metrics/window.ts";

export interface Ctx {
  actor: Actor;
  db: Db;
}

const ACTIVE = ACTIVE_STAGES as readonly string[] as string[];

/** How many months of closed production the small charts show. */
export const MONTHS_OF_HISTORY = 12;

/** How far ahead a deadline counts as "coming up" rather than merely future. */
export const DEADLINE_SOON_DAYS = 7;

/**
 * The counts and sums, in one pass over the visible rows.
 *
 * Every figure is a filtered aggregate on the same scan, so adding a metric
 * costs nothing extra and the numbers cannot disagree with each other by
 * being taken at different moments.
 */
async function totals(ctx: Ctx, now: Date) {
  const month = monthWindow(now);
  const rows = await ctx.db
    .select({
      activeCount: sql<number>`count(*) filter (where ${transactions.stage} = any(${ACTIVE}))`,
      onHoldCount: sql<number>`count(*) filter (where ${transactions.stage} = ${PAUSED_STAGE})`,
      activeVolume: sql<string>`coalesce(sum(${transactions.contractPriceCents}) filter (where ${transactions.stage} = any(${ACTIVE})), 0)::text`,
      unpriced: sql<number>`count(*) filter (where ${transactions.stage} = any(${ACTIVE}) and ${transactions.contractPriceCents} is null)`,
      scheduled: sql<number>`count(*) filter (where ${transactions.stage} = any(${ACTIVE}) and ${transactions.closingDate} >= ${month.start} and ${transactions.closingDate} <= ${month.end})`,
      closedCount: sql<number>`count(*) filter (where ${transactions.stage} = 'closed' and ${transactions.closedDate} >= ${month.start} and ${transactions.closedDate} <= ${month.end})`,
      closedVolume: sql<string>`coalesce(sum(${transactions.contractPriceCents}) filter (where ${transactions.stage} = 'closed' and ${transactions.closedDate} >= ${month.start} and ${transactions.closedDate} <= ${month.end}), 0)::text`,
    })
    .from(transactions)
    .where(visibleTo(ctx.actor));
  return rows[0];
}

/** The integer columns commission is projected from. Nothing else. */
const TERM_COLUMNS = {
  id: transactions.id,
  stage: transactions.stage,
  closedDate: transactions.closedDate,
  contractPriceCents: transactions.contractPriceCents,
  commissionRateBps: transactions.commissionRateBps,
  commissionFlatCents: transactions.commissionFlatCents,
  agentSplitBps: transactions.agentSplitBps,
  transactionFeeCents: transactions.transactionFeeCents,
  referralFeeBps: transactions.referralFeeBps,
};

export async function transactionMetrics(ctx: Ctx, now: Date): Promise<TransactionMetrics> {
  const historyStart = monthSeries(now, MONTHS_OF_HISTORY)[0];

  const [agg, activeTerms, closedTerms] = await Promise.all([
    totals(ctx, now),
    ctx.db
      .select(TERM_COLUMNS)
      .from(transactions)
      .where(and(visibleTo(ctx.actor), inArray(transactions.stage, ACTIVE as TransactionStage[]))),
    ctx.db
      .select(TERM_COLUMNS)
      .from(transactions)
      .where(
        and(
          visibleTo(ctx.actor),
          eq(transactions.stage, "closed"),
          sql`${transactions.closedDate} >= ${historyStart}`
        )
      ),
  ]);

  // Commission, through the one implementation of commission arithmetic.
  let projectedCommissionCents = 0;
  let untermed = 0;
  for (const row of activeTerms) {
    const projection = projectCommission(row);
    projectedCommissionCents += projection.grossCents;
    if (projection.basis === "none") untermed += 1;
  }

  const buckets = new Map<string, MonthPoint>(
    monthSeries(now, MONTHS_OF_HISTORY).map((month) => [
      month,
      { month, closedCount: 0, closedVolumeCents: 0, commissionCents: 0 },
    ])
  );
  for (const row of closedTerms) {
    if (!row.closedDate) continue;
    const point = buckets.get(monthBucket(row.closedDate));
    // A closed date outside the window can exist if the series shortens; it
    // is simply not in this chart rather than being folded into an edge month.
    if (!point) continue;
    point.closedCount += 1;
    point.closedVolumeCents += row.contractPriceCents ?? 0;
    point.commissionCents += projectCommission(row).grossCents;
  }

  return {
    activeCount: toInt(agg?.activeCount),
    onHoldCount: toInt(agg?.onHoldCount),
    activeVolumeCents: toInt(agg?.activeVolume),
    activeVolumeUnpricedCount: toInt(agg?.unpriced),
    projectedCommissionCents,
    projectedCommissionUntermedCount: untermed,
    scheduledClosingsThisMonth: toInt(agg?.scheduled),
    closedThisMonthCount: toInt(agg?.closedCount),
    closedThisMonthVolumeCents: toInt(agg?.closedVolume),
    monthly: Array.from(buckets.values()),
  };
}

/** `/transactions?open=<id>` — the deep link the board and table already use. */
function transactionHref(id: string): string {
  return `/transactions?open=${encodeURIComponent(id)}`;
}

function addressOf(row: { addressLine1: string; city: string }): string {
  return `${row.addressLine1}, ${row.city}`;
}

/**
 * Deadlines that need attention: overdue, or due within the next week.
 *
 * Only real `transaction_deadlines` rows, only on deals still being worked,
 * and only ones nobody has completed. A deal with no deadline records
 * produces no items — the absence of a milestone is not a milestone.
 */
export async function transactionAttention(
  ctx: Ctx,
  now: Date,
  /**
   * How far ahead to look, in whole days. Overdue deadlines are returned
   * whatever the window, because a passed date is not a forecast.
   *
   * Home wants the default: a week is what "needs attention" means on a
   * dashboard. It is a parameter so a caller that asks a wider question gets a
   * wider answer from THIS query rather than from a second one — a tool that
   * advertised a thirty-day window over a hard-coded seven-day predicate would
   * report "nothing due" about twenty-three days it never looked at.
   */
  horizonDays: number = DEADLINE_SOON_DAYS
): Promise<AttentionItem[]> {
  const horizon = dayKey(new Date(now.getTime() + horizonDays * 86_400_000));
  const rows = await ctx.db
    .select({
      id: transactionDeadlines.id,
      label: transactionDeadlines.label,
      dueDate: transactionDeadlines.dueDate,
      transactionId: transactions.id,
      addressLine1: transactions.addressLine1,
      city: transactions.city,
    })
    .from(transactionDeadlines)
    .innerJoin(transactions, eq(transactionDeadlines.transactionId, transactions.id))
    .where(
      and(
        visibleTo(ctx.actor),
        inArray(transactions.stage, ACTIVE as TransactionStage[]),
        isNull(transactionDeadlines.completedAt),
        sql`${transactionDeadlines.dueDate} <= ${horizon}`
      )
    )
    .orderBy(transactionDeadlines.dueDate)
    .limit(50);

  return rows.map((row) => {
    const daysAway = daysUntil(row.dueDate, now);
    return {
      id: `deadline:${row.id}`,
      kind: daysAway < 0 ? "deadline_overdue" : "deadline_soon",
      label: row.label,
      subject: addressOf(row),
      dueDate: row.dueDate,
      daysAway,
      href: transactionHref(row.transactionId),
    };
  });
}

/** How a stored event reads on the screen. Never the raw metadata. */
function describeEvent(eventType: string, address: string): { kind: ActivityItem["kind"]; summary: string } | null {
  switch (eventType) {
    case "transaction_created":
      return { kind: "transaction_created", summary: `Deal opened on ${address}` };
    case "transaction_stage_changed":
      return { kind: "transaction_stage_changed", summary: `Stage changed on ${address}` };
    default:
      // `transaction_updated` and anything added later are not feed-worthy
      // until they can be described in a sentence a person wants to read.
      return null;
  }
}

export async function transactionActivity(ctx: Ctx, limit: number): Promise<ActivityItem[]> {
  const rows = await ctx.db
    .select({
      id: transactionEvents.id,
      eventType: transactionEvents.eventType,
      createdAt: transactionEvents.createdAt,
      stage: transactions.stage,
      transactionId: transactions.id,
      addressLine1: transactions.addressLine1,
      city: transactions.city,
    })
    .from(transactionEvents)
    .innerJoin(transactions, eq(transactionEvents.transactionId, transactions.id))
    .where(visibleTo(ctx.actor))
    .orderBy(desc(transactionEvents.createdAt))
    .limit(limit);

  const items: ActivityItem[] = [];
  for (const row of rows) {
    const address = addressOf(row);
    const described = describeEvent(row.eventType, address);
    if (!described) continue;
    const closed = row.eventType === "transaction_stage_changed" && row.stage === "closed";
    items.push({
      id: `txn:${row.id}`,
      kind: closed ? "transaction_closed" : described.kind,
      summary: closed ? `${STAGE_LABELS.closed} — ${address}` : described.summary,
      subject: address,
      at: row.createdAt.toISOString(),
      href: transactionHref(row.transactionId),
    });
  }
  return items;
}

/**
 * Production by agent.
 *
 * Only for a privileged actor — the caller checks that before asking, because
 * for anyone else this is a list of one, and publishing colleagues' totals to
 * an agent is the same leak as publishing their deals.
 */
export async function transactionLeaderboard(ctx: Ctx, now: Date): Promise<LeaderboardRow[]> {
  if (!isPrivileged(ctx.actor)) return [];
  const { start } = monthWindow(now);
  const rows = await ctx.db
    .select({
      agentUserId: transactions.agentUserId,
      closedCount: sql<number>`count(*) filter (where ${transactions.stage} = 'closed' and ${transactions.closedDate} >= ${start})`,
      closedVolume: sql<string>`coalesce(sum(${transactions.contractPriceCents}) filter (where ${transactions.stage} = 'closed' and ${transactions.closedDate} >= ${start}), 0)::text`,
      activeCount: sql<number>`count(*) filter (where ${transactions.stage} = any(${ACTIVE}))`,
    })
    .from(transactions)
    .where(visibleTo(ctx.actor))
    .groupBy(transactions.agentUserId);

  if (rows.length === 0) return [];
  const names = await agentNames(ctx.db, rows.map((r) => r.agentUserId));
  return rows
    .map((row) => ({
      agentUserId: row.agentUserId,
      name: names.get(row.agentUserId) ?? "Unnamed agent",
      closedCount: toInt(row.closedCount),
      closedVolumeCents: toInt(row.closedVolume),
      activeCount: toInt(row.activeCount),
    }))
    .sort((a, b) => b.closedVolumeCents - a.closedVolumeCents || a.name.localeCompare(b.name));
}

/** Display names only — never an email, a Clerk id, or anything else. */
export async function agentNames(db: Db, userIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      userId: professionalProfiles.userId,
      display: professionalProfiles.preferredDisplayName,
      first: professionalProfiles.legalFirstName,
      last: professionalProfiles.legalLastName,
    })
    .from(professionalProfiles)
    .where(inArray(professionalProfiles.userId, unique));
  const names = new Map<string, string>();
  for (const row of rows) {
    const name = row.display?.trim() || [row.first, row.last].filter(Boolean).join(" ").trim();
    if (name) names.set(row.userId, name);
  }
  return names;
}

/** Present so the leaderboard can exclude nobody silently. */
export async function activeAgentCount(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(dashboardUsers)
    .where(eq(dashboardUsers.status, "active"));
  return toInt(rows[0]?.n);
}
