"use client";

import { CircleCheck } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { PillProgress } from "@/components/ui/pill-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widgets/widget-card";
import { getDashboardMetrics } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";

/** Files closed in the period, against the scaled goal. */
export default function ClosedWidget() {
  const { preset, range, overridden, setOverride } = useWidgetPeriod("closed");
  const { data, loading, error } = useQuery(
    () => getDashboardMetrics(range, preset),
    [preset, range.from.getTime(), range.to.getTime()]
  );

  return (
    <WidgetCard
      icon={CircleCheck}
      title="Closed"
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
          <Skeleton className="h-10 w-24" />
          <div className="space-y-3">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between gap-5">
          <div className="flex items-baseline gap-2">
            <CountUp
              value={data.closedCount}
              format={(n) => String(Math.round(n))}
              className="font-display text-4xl leading-none tabular"
            />
            <span className="tabular text-sm font-medium text-muted-foreground">
              / {data.closedGoal} goal
            </span>
          </div>
          <div className="space-y-3">
            <PillProgress
              value={data.closedCount}
              max={data.closedGoal}
              label={`${data.closedCount} of ${data.closedGoal} closed goal`}
            />
            <p className="text-[13px] leading-snug text-muted-foreground">
              Files that closed this period
            </p>
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
