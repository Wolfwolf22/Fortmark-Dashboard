"use client";

/**
 * Pipeline summary strip — one chip per lead stage with its live count.
 * Each chip toggles the table's stage filter; the active chip inverts.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@/lib/data/types";
import { cn } from "@/lib/utils";

export function PipelineSummary({
  counts,
  activeStage,
  onToggle,
}: {
  counts: Record<LeadStage, number> | undefined;
  activeStage: LeadStage | null;
  onToggle: (stage: LeadStage) => void;
}) {
  if (!counts) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {LEAD_STAGES.map((stage) => (
          <Skeleton key={stage} className="h-[4.5rem] w-28 flex-none rounded-panel" />
        ))}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Pipeline stages"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {LEAD_STAGES.map((stage) => {
        const active = activeStage === stage;
        return (
          <span key={stage} className="flex flex-none items-stretch gap-2">
            {stage === "converted" && (
              <span aria-hidden className="my-2 w-px flex-none bg-border" />
            )}
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(stage)}
              title={
                active
                  ? `Clear the ${LEAD_STAGE_LABELS[stage].toLowerCase()} filter`
                  : `Show ${LEAD_STAGE_LABELS[stage].toLowerCase()} leads`
              }
              className={cn(
                "flex w-28 flex-none flex-col items-start gap-1.5 rounded-panel border px-4 py-3 text-left transition-colors duration-150",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-micro",
                  active ? "text-primary-foreground/70" : "text-muted-foreground"
                )}
              >
                {LEAD_STAGE_LABELS[stage]}
              </span>
              <span className="tabular text-xl font-bold leading-none">
                {counts[stage]}
              </span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
