"use client";

import { create } from "zustand";
import { DateRange, DateRangePreset } from "@/lib/data/types";
import { rangeFromPreset } from "@/lib/dates";

/**
 * The global reporting period. The top-bar selector writes here; every
 * widget and adapter call on the page reads from here, so changing the
 * period re-filters the whole view.
 */
interface DateRangeState {
  preset: DateRangePreset;
  range: DateRange;
  setPreset: (preset: DateRangePreset) => void;
}

export const useDateRange = create<DateRangeState>((set) => ({
  preset: "month",
  range: rangeFromPreset("month"),
  setPreset: (preset) => set({ preset, range: rangeFromPreset(preset) }),
}));
