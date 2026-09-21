/**
 * Shared phrasing for the Home tiles.
 *
 * The windows the metrics service measured are reported back in the payload
 * (`monthStart`, `scope`) precisely so the screen can name them. These helpers
 * turn those facts into the words on the card — one place, so "this month"
 * always means the same month and "your" always means the same scope.
 */
import type { MetricScope, MonthPoint } from "@/lib/metrics/types";
import type { PeriodPoint } from "@/lib/data/types";
import { centsToDollars } from "@/lib/transactions/money";

/** "2026-09-01" → "September". */
export function monthLabel(monthStart: string): string {
  return new Date(`${monthStart}T00:00:00.000Z`).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

/** "2026-09-01" → "Sep". */
export function shortMonthLabel(monthStart: string): string {
  return new Date(`${monthStart}T00:00:00.000Z`).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

/** Whose numbers these are, for a caption. */
export function scopeLabel(scope: MetricScope): string {
  return scope === "brokerage" ? "Brokerage" : "Your book";
}

/** A monthly series as the chart components expect it, in dollars. */
export function toPeriodPoints(
  months: MonthPoint[],
  pick: (point: MonthPoint) => number
): PeriodPoint[] {
  return months.map((month) => ({
    label: shortMonthLabel(month.month),
    date: month.month,
    value: centsToDollars(pick(month)),
  }));
}

/** Cents → dollars, for the existing currency formatters. */
export { centsToDollars };
