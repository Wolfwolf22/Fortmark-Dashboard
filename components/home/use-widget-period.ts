"use client";

import { useDateRange } from "@/lib/stores/date-range";
import { useLayoutStore, WidgetId } from "@/lib/stores/layout";
import { rangeFromPreset } from "@/lib/dates";
import { DateRange, DateRangePreset } from "@/lib/data/types";

/**
 * Resolves the effective period for a Home widget: the widget's own override
 * when set, otherwise the global top-bar selector. Every widget uses this so
 * the date-range selector re-filters the whole page.
 */
export function useWidgetPeriod(id: WidgetId): {
  preset: DateRangePreset;
  range: DateRange;
  overridden: boolean;
  setOverride: (preset: DateRangePreset | null) => void;
} {
  const globalPreset = useDateRange((s) => s.preset);
  const globalRange = useDateRange((s) => s.range);
  const override = useLayoutStore((s) => s.widgetPeriods[id] ?? null);
  const setWidgetPeriod = useLayoutStore((s) => s.setWidgetPeriod);

  return {
    preset: override ?? globalPreset,
    range: override ? rangeFromPreset(override) : globalRange,
    overridden: override !== null,
    setOverride: (preset) => setWidgetPeriod(id, preset),
  };
}
