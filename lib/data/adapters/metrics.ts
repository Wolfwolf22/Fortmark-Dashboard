/**
 * Metrics adapter.
 *
 * Two things live here, and the difference between them matters.
 *
 * `getBrokerageMetrics` is the real path: it asks the server, which asks the
 * transaction and contact domain services, and every group in the answer
 * carries its own availability. It never falls back to anything. If a domain
 * cannot answer, the caller is told that, and Home renders it as "not
 * connected" or "unavailable" rather than a number.
 *
 * `getDashboardMetrics` is the generated sample series that still powers the
 * Reports screen. It is fiction, it is labelled as such, and Home no longer
 * touches it. Reports is the next screen to be made real (Phase E3); until
 * then nothing in this file lets sample figures reach the live dashboard.
 */
import { apiPath } from "@/lib/routes";
import type { BrokerageMetrics } from "@/lib/metrics/types";
import {
  endOfMonth,
  endOfQuarter,
  format,
  startOfMonth,
  startOfQuarter,
  subDays,
  subMonths,
  subQuarters,
} from "date-fns";
import {
  DashboardMetrics,
  DateRange,
  DateRangePreset,
  LeadSource,
  PeriodPoint,
} from "../types";
import { leads, listings, transactions } from "../mock/db";
import { now } from "@/lib/dates";
import { requireSubsystem } from "./subsystems";
import { inRange, previousRange } from "@/lib/dates";
import { delay } from "./latency";

export class MetricsError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Metrics request failed (${status})`);
    this.name = "MetricsError";
    this.status = status;
  }
}

/**
 * The real brokerage metrics for the signed-in caller.
 *
 * A failed request throws. It deliberately does not return the sample set on
 * error: a dashboard that quietly shows a healthy invented brokerage when the
 * server is down is worse than one that says it cannot reach the server.
 */
export async function getBrokerageMetrics(): Promise<BrokerageMetrics> {
  const response = await fetch(apiPath("/api/metrics"), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new MetricsError(response.status);
  return (await response.json()) as BrokerageMetrics;
}

// Monthly brokerage goals, scaled to the selected period.
const MONTHLY_GOALS = { underContract: 8, closed: 6 };

const PRESET_FACTOR: Record<DateRangePreset, number> = {
  today: 1 / 20,
  week: 1 / 4,
  month: 1,
  quarter: 3,
  year: 12,
};

function scaleGoal(monthly: number, preset: DateRangePreset): number {
  return Math.max(1, Math.round(monthly * PRESET_FACTOR[preset]));
}

interface Bucket {
  label: string;
  from: Date;
  to: Date;
  active: boolean;
}

/** Chart buckets that contextualize the selected period within a longer series. */
function bucketsFor(preset: DateRangePreset): Bucket[] {
  const anchor = now();
  if (preset === "today" || preset === "week") {
    return Array.from({ length: 7 }, (_, i) => {
      const day = subDays(anchor, 6 - i);
      const from = new Date(day);
      from.setHours(0, 0, 0, 0);
      const to = new Date(day);
      to.setHours(23, 59, 59, 999);
      return { label: format(day, "EEE"), from, to, active: i === 6 };
    });
  }
  if (preset === "quarter") {
    return Array.from({ length: 4 }, (_, i) => {
      const q = subQuarters(anchor, 3 - i);
      return {
        label: format(startOfQuarter(q), "QQQ"),
        from: startOfQuarter(q),
        to: endOfQuarter(q),
        active: i === 3,
      };
    });
  }
  const count = preset === "year" ? 12 : 6;
  return Array.from({ length: count }, (_, i) => {
    const m = subMonths(anchor, count - 1 - i);
    return {
      label: format(m, "MMM"),
      from: startOfMonth(m),
      to: endOfMonth(m),
      active: i === count - 1,
    };
  });
}

function gciInBucket(bucket: Bucket): number {
  const range: DateRange = { from: bucket.from, to: bucket.to };
  return transactions
    .filter(
      (t) =>
        (t.stage === "closed" && (t.closeDate ? inRange(t.closeDate, range) : false)) ||
        (t.stage !== "closed" && (t.closeDate ? inRange(t.closeDate, range) : false))
    )
    .reduce((sum, t) => sum + t.contractPrice * t.commissionRate, 0);
}

export interface CommissionPoint extends PeriodPoint {
  active: boolean;
}

export async function getDashboardMetrics(
  range: DateRange,
  preset: DateRangePreset
): Promise<DashboardMetrics & { commissionByPeriod: CommissionPoint[] }> {
  await requireSubsystem("reports");
  await delay(220);

  const enteredContract = transactions.filter((t) => inRange(t.contractDate, range));
  const underContractCount = enteredContract.filter((t) => t.stage !== "closed").length;

  const closedInRange = transactions.filter(
    (t) => t.stage === "closed" && (t.closeDate ? inRange(t.closeDate, range) : false)
  );
  const prev = previousRange(range);
  const closedPrev = transactions.filter(
    (t) => t.stage === "closed" && (t.closeDate ? inRange(t.closeDate, prev) : false)
  );

  const pipeline = transactions.filter(
    (t) =>
      t.stage !== "closed" &&
      (inRange(t.contractDate, range) || (t.closeDate ? inRange(t.closeDate, range) : false))
  );
  const pipelineValue = pipeline.reduce((sum, t) => sum + t.contractPrice, 0);
  const projectedGci = pipeline.reduce(
    (sum, t) => sum + t.contractPrice * t.commissionRate,
    0
  );

  const closedVolume = closedInRange.reduce((sum, t) => sum + t.contractPrice, 0);
  const closedVolumePrev = closedPrev.reduce((sum, t) => sum + t.contractPrice, 0);

  // Sparkline: 12 slices across the selected range.
  const span = range.to.getTime() - range.from.getTime();
  const slice = span / 12;
  const closedVolumeSpark: PeriodPoint[] = Array.from({ length: 12 }, (_, i) => {
    const from = new Date(range.from.getTime() + i * slice);
    const to = new Date(range.from.getTime() + (i + 1) * slice);
    const value = transactions
      .filter(
        (t) =>
          t.stage === "closed" &&
          t.closeDate !== undefined &&
          new Date(t.closeDate) >= from &&
          new Date(t.closeDate) < to
      )
      .reduce((sum, t) => sum + t.contractPrice, 0);
    return { label: String(i + 1), date: from.toISOString(), value };
  });

  const commissionByPeriod: CommissionPoint[] = bucketsFor(preset).map((b) => ({
    label: b.label,
    date: b.from.toISOString(),
    value: Math.round(gciInBucket(b)),
    active: b.active,
  }));

  const leadsInRange = leads.filter((l) => inRange(l.createdDate, range));
  const bySource = new Map<LeadSource, number>();
  for (const lead of leadsInRange) {
    bySource.set(lead.source, (bySource.get(lead.source) ?? 0) + 1);
  }

  return {
    underContractCount,
    underContractGoal: scaleGoal(MONTHLY_GOALS.underContract, preset),
    closedCount: closedInRange.length,
    closedGoal: scaleGoal(MONTHLY_GOALS.closed, preset),
    pipelineValue,
    projectedGci,
    closedVolume,
    closedVolumePrev,
    closedVolumeSpark,
    commissionByPeriod,
    leadSourceBreakdown: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Reports

export interface ReportSeries {
  points: (PeriodPoint & { active?: boolean })[];
}

/** Closed volume over time (bucketed like the commission chart). */
export async function getClosedVolumeSeries(preset: DateRangePreset): Promise<ReportSeries> {
  await requireSubsystem("reports");
  await delay();
  const points = bucketsFor(preset).map((b) => ({
    label: b.label,
    date: b.from.toISOString(),
    active: b.active,
    value: transactions
      .filter(
        (t) => t.stage === "closed" && (t.closeDate ? inRange(t.closeDate, { from: b.from, to: b.to }) : false)
      )
      .reduce((sum, t) => sum + t.contractPrice, 0),
  }));
  return { points };
}

export async function getListToSaleRatio(range: DateRange): Promise<number> {
  await requireSubsystem("reports");
  await delay();
  const closed = listings.filter(
    (l) => l.status === "closed" && l.closedPrice && l.closedDate && inRange(l.closedDate, range)
  );
  if (!closed.length) return 0;
  const sum = closed.reduce((acc, l) => acc + l.closedPrice! / l.listPrice, 0);
  return sum / closed.length;
}

export async function getMedianDaysOnMarket(range: DateRange): Promise<number> {
  await requireSubsystem("reports");
  await delay();
  const closed = listings
    .filter((l) => l.status === "closed" && l.closedDate && inRange(l.closedDate, range))
    .map((l) => l.daysOnMarket)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);
  if (!closed.length) return 0;
  const mid = Math.floor(closed.length / 2);
  return closed.length % 2 ? closed[mid]! : Math.round((closed[mid - 1]! + closed[mid]!) / 2);
}

export interface LeadSourceRoi {
  source: LeadSource;
  leads: number;
  converted: number;
  closedDollars: number;
  spend: number;
  roi: number; // gci attributed / spend
}

// Mock acquisition spend per source — replaced by the marketing ledger later.
const SOURCE_SPEND: Record<LeadSource, number> = {
  referral: 1200,
  sphere: 800,
  sign_call: 600,
  website: 2400,
  open_house: 900,
  past_client: 300,
  social: 700,
  advertising: 1500,
  walk_in: 200,
  other: 100,
};

export async function getLeadSourceRoi(range: DateRange): Promise<LeadSourceRoi[]> {
  await requireSubsystem("reports");
  await delay();
  const sources = Object.keys(SOURCE_SPEND) as LeadSource[];
  const avgGci =
    transactions.reduce((sum, t) => sum + t.contractPrice * t.commissionRate, 0) /
    Math.max(1, transactions.length);
  return sources
    .map((source) => {
      const pool = leads.filter(
        (l) => l.source === source && inRange(l.createdDate, range)
      );
      const converted = pool.filter((l) => l.stage === "closed" || l.stage === "past_client").length;
      const closedDollars = Math.round(converted * avgGci);
      const spend = SOURCE_SPEND[source];
      return {
        source,
        leads: pool.length,
        converted,
        closedDollars,
        spend,
        roi: spend ? closedDollars / spend : 0,
      };
    })
    .sort((a, b) => b.roi - a.roi);
}
