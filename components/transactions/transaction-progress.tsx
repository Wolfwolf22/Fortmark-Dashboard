import { Badge } from "@/components/ui/badge";
import { TRANSACTION_STAGES, TRANSACTION_STAGE_LABELS, type TransactionStage } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * Position in the workflow, not a completion percentage. Only the current
 * position is highlighted: an earlier stage is not proof its work was done.
 * Paused/exited files have no position in this ordered path.
 */
export function TransactionProgress({ stage, compact = false }: { stage: TransactionStage; compact?: boolean }) {
  const position = TRANSACTION_STAGES.indexOf(stage);
  const label = TRANSACTION_STAGE_LABELS[stage];

  if (position < 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted">{label}</Badge>
        <p className="text-xs text-muted-foreground">
          {stage === "on_hold" ? "Workflow paused" : "Outside the active pipeline"}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={cn("font-semibold", compact ? "text-xs" : "text-base")}>{label}</p>
        <p className="tabular text-[11px] text-muted-foreground">Stage {position + 1} of {TRANSACTION_STAGES.length}</p>
      </div>
      <ol
        aria-label="Transaction workflow position"
        className={cn("mt-2.5", compact ? "flex gap-1" : "grid grid-cols-2 gap-1.5")}
      >
        {TRANSACTION_STAGES.map((step, index) => {
          const current = step === stage;
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className={cn(
                compact ? "min-w-0 flex-1" : "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2",
                !compact && (current ? "border-input bg-tint" : "border-transparent")
              )}
            >
              {compact ? (
                <>
                  <span aria-hidden className={cn("block h-1 rounded-full", current ? "bg-primary" : "bg-track")} />
                  <span className="sr-only">Stage {index + 1}: {TRANSACTION_STAGE_LABELS[step]}</span>
                </>
              ) : (
                <>
                  <span aria-hidden className={cn("tabular inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold", current ? "bg-primary text-primary-foreground" : "bg-tint text-muted-foreground")}>{index + 1}</span>
                  <span className={cn("min-w-0 text-[11px] leading-4", current ? "font-semibold" : "text-muted-foreground")}>{TRANSACTION_STAGE_LABELS[step]}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {!compact && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Milestones are tracked separately from stage.</p>}
    </div>
  );
}
