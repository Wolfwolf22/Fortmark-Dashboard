"use client";

import { Layers } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widgets/widget-card";
import { getDashboardMetrics } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";

/** Open contract dollars in the period, with the projected GCI beneath. */
export default function PipelineValueWidget() {
  const { preset, range, overridden, setOverride } = useWidgetPeriod("pipeline-value");
  const { data, loading, error } = useQuery(
    () => getDashboardMetrics(range, preset),
    [preset, range.from.getTime(), range.to.getTime()]
  );

  return (
    <WidgetCard
      icon={Layers}
      title="Pipeline value"
      preset={preset}
      onPresetChange={setOverride}
      presetOverridden={overridden}
    >
      {error ? (
        <p className="text-[13px] text-muted-foreground">
          Metrics failed to load. Refresh the page to retry.
        </p>
      ) : loading || !data ? (
        <div className="flex h-full flex-col justify-between gap-5">
          <div className="space-y-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-36" />
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between gap-5">
          <div>
            <CountUp
              value={data.pipelineValue}
              format={formatCurrencyCompact}
              className="font-display text-4xl leading-none tabular"
            />
            <p className="tabular mt-2 text-[13px] text-muted-foreground">
              {formatCurrency(data.pipelineValue)} in open contracts
            </p>
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-micro">Projected GCI</p>
            <p className="tabular mt-1 text-lg font-bold leading-tight">
              {formatCurrency(data.projectedGci)}
            </p>
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
