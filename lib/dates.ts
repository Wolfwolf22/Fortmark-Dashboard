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
import { DateRange, DateRangePreset } from "@/lib/data/types";
import { now } from "@/lib/data/mock/db";

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
