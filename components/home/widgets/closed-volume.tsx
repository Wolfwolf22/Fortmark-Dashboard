"use client";

import { TrendingUp } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { Sparkline } from "@/components/charts/sparkline";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { DeltaBadge } from "@/components/ui/delta-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widgets/widget-card";
import { getDashboardMetrics } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import { formatCurrencyCompact } from "@/lib/utils";

/** Closed dollars in the period, with the prior-period delta and a sparkline. */
export default function ClosedVolumeWidget() {
  const { preset, range, overridden, setOverride } = useWidgetPeriod("closed-volume");
  const { data, loading, error } = useQuery(
    () => getDashboardMetrics(range, preset),
    [preset, range.from.getTime(), range.to.getTime()]
  );

  const deltaPct =
    data && data.closedVolumePrev > 0
      ? ((data.closedVolume - data.closedVolumePrev) / data.closedVolumePrev) * 100
      : null;

  return (
    <WidgetCard
      domain="reports"
      icon={TrendingUp}
      title="Closed volume"
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
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-11 w-full" />
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between gap-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CountUp
                value={data.closedVolume}
                format={formatCurrencyCompact}
                className="font-display text-4xl leading-none tabular"
              />
              <p className="tabular mt-2 text-[13px] text-muted-foreground">
                Prior period {formatCurrencyCompact(data.closedVolumePrev)}
              </p>
            </div>
            {deltaPct === null ? (
              <span
                className="inline-flex items-center rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-muted-foreground"
                aria-label="No prior-period volume to compare"
              >
                —
              </span>
            ) : (
              <DeltaBadge value={deltaPct} />
            )}
          </div>
          <Sparkline points={data.closedVolumeSpark} />
        </div>
      )}
    </WidgetCard>
  );
}
