"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DateRangePreset } from "@/lib/data/types";

/** Canonical widget order for the Home bento grid. */
export const DEFAULT_WIDGET_ORDER = [
  "under-contract",
  "closed",
  "pipeline-value",
  "closed-volume",
  "projected-commission",
  // Release 1.1 moved the featured listing out of the upper-left slot, which
  // the permanent identity card now occupies, to a wide card between the
  // commission chart and the transactions table.
  "featured-listing",
  "transactions-table",
  "lead-source",
  "leaderboard",
  "market-pulse",
  "compliance",
] as const;

export type WidgetId = (typeof DEFAULT_WIDGET_ORDER)[number];

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
      // v2: the default order changed in Release 1.1. `merge` below appends
      // unknown ids at the END, so a persisted v1 order would have kept
      // featured-listing in first place forever for anyone who had already
      // loaded the dashboard. A new key retires those saved orders.
      name: "fm.dashboard.layout.v2",
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
