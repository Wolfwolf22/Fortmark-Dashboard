"use client";

import { Segmented } from "@/components/ui/segmented";
import { useDateRange } from "@/lib/stores/date-range";
import { PRESETS, PRESET_LABELS } from "@/lib/dates";
import { DateRangePreset } from "@/lib/data/types";

/**
 * The global reporting-period control. Writing here re-filters every widget
 * on the page — adapters read the range from the same store.
 */
export function DateRangeSelector() {
  const preset = useDateRange((s) => s.preset);
  const setPreset = useDateRange((s) => s.setPreset);

  return (
    <Segmented<DateRangePreset>
      ariaLabel="Reporting period"
      options={PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
      value={preset}
      onChange={setPreset}
    />
  );
}
