import {
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { DateRange, DateRangePreset } from "./data/types.ts";

/**
 * "Now", anchored to the top of the current hour.
 *
 * Every derived date in a render must agree between the server pass and the
 * client's hydration, and a clock read twice a millisecond apart does not.
 * This lived in the sample generator, which meant a module wanting nothing
 * more than the time had to import the fabricated brokerage to get it — and
 * that import is exactly what the mock-leak invariant needs to be able to
 * forbid outright. The clock is not sample data; it belongs here.
 */
const HOUR_ANCHOR = (() => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d;
})();

export const now = () => new Date(HOUR_ANCHOR);

export const PRESET_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

export const PRESETS: DateRangePreset[] = ["today", "week", "month", "quarter", "year"];

export function rangeFromPreset(preset: DateRangePreset, anchor = now()): DateRange {
  switch (preset) {
    case "today":
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    case "week":
      return {
        from: startOfWeek(anchor, { weekStartsOn: 1 }),
        to: endOfWeek(anchor, { weekStartsOn: 1 }),
      };
    case "month":
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case "quarter":
      return { from: startOfQuarter(anchor), to: endOfQuarter(anchor) };
    case "year":
      return { from: startOfYear(anchor), to: endOfYear(anchor) };
  }
}

/** The equal-length period immediately before `range` — used for deltas. */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span - 1),
    to: new Date(range.from.getTime() - 1),
  };
}

export function inRange(dateIso: string, range: DateRange): boolean {
  const t = new Date(dateIso).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

/** Human sublabel for a widget header, e.g. "This month". */
export function periodSublabel(preset: DateRangePreset): string {
  switch (preset) {
    case "today":
      return "Today";
    case "week":
      return "This week";
    case "month":
      return "This month";
    case "quarter":
      return "This quarter";
    case "year":
      return "This year";
  }
}
