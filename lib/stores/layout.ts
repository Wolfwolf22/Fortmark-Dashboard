"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DateRangePreset } from "@/lib/data/types";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "./widget-order";

// The order lives in a dependency-free module so tests can import it under
// plain Node; re-exported here so existing consumers are unaffected.
export { DEFAULT_WIDGET_ORDER } from "./widget-order";
export type { WidgetId } from "./widget-order";

interface LayoutState {
  widgetOrder: WidgetId[];
  setWidgetOrder: (order: WidgetId[]) => void;
  resetLayout: () => void;
  /** Per-widget period override; null = follow the global selector. */
  widgetPeriods: Partial<Record<WidgetId, DateRangePreset | null>>;
  setWidgetPeriod: (id: WidgetId, preset: DateRangePreset | null) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      widgetOrder: [...DEFAULT_WIDGET_ORDER],
      setWidgetOrder: (widgetOrder) => set({ widgetOrder }),
      resetLayout: () =>
        set({ widgetOrder: [...DEFAULT_WIDGET_ORDER], widgetPeriods: {} }),
      widgetPeriods: {},
      setWidgetPeriod: (id, preset) =>
        set((s) => ({ widgetPeriods: { ...s.widgetPeriods, [id]: preset } })),
    }),
    {
      // v3: Release E1 replaced four KPI cards with the daily brief and moved
      // "Needs attention" to the top. `merge` below appends unknown ids at the
      // END, so a saved v2 order would have kept attention in last place
      // forever for anyone who had already loaded the dashboard — which is the
      // single thing this release set out to fix. A new key retires them.
      name: "fm.dashboard.layout.v3",
      merge: (persisted, current) => {
        // Tolerate widget ids added/removed between versions.
        const p = persisted as Partial<LayoutState> | undefined;
        const saved = (p?.widgetOrder ?? []).filter((id): id is WidgetId =>
          (DEFAULT_WIDGET_ORDER as readonly string[]).includes(id)
        );
        const missing = DEFAULT_WIDGET_ORDER.filter((id) => !saved.includes(id));
        return {
          ...current,
          ...p,
          widgetOrder: [...saved, ...missing],
          widgetPeriods: p?.widgetPeriods ?? {},
        };
      },
    }
  )
);
