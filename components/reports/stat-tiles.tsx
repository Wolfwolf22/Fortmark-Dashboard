"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { DeltaBadge } from "@/components/ui/delta-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDashboardMetrics,
  getListToSaleRatio,
  getMedianDaysOnMarket,
} from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import { useDateRange } from "@/lib/stores/date-range";
import { formatCurrencyCompact, formatPercent } from "@/lib/utils";

/**
 * The Reports stat row: closed volume (with prior-period delta),
 * list-to-sale ratio, median days on market, and projected GCI — all for the
 * global period. Zeros are shown honestly when a small period has no
 * closings.
 */
export function ReportStatTiles() {
  const { preset, range } = useDateRange();
  const from = range.from.getTime();
  const to = range.to.getTime();

  const metrics = useQuery(
    () => getDashboardMetrics(range, preset),
    [preset, from, to]
  );
  const ratio = useQuery(() => getListToSaleRatio(range), [preset, from, to]);
  const medianDom = useQuery(
    () => getMedianDaysOnMarket(range),
    [preset, from, to]
  );

  const deltaPct =
    metrics.data && metrics.data.closedVolumePrev > 0
      ? ((metrics.data.closedVolume - metrics.data.closedVolumePrev) /
          metrics.data.closedVolumePrev) *
        100
      : null;

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Closed volume"
        loading={metrics.loading || !metrics.data}
        value={formatCurrencyCompact(metrics.data?.closedVolume ?? 0)}
        badge={
          metrics.data &&
          (deltaPct === null ? (
            <span
              className="inline-flex items-center rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-muted-foreground"
              aria-label="No prior-period volume to compare"
            >
              —
            </span>
          ) : (
            <DeltaBadge value={deltaPct} />
          ))
        }
      />
      <StatTile
        label="List-to-sale ratio"
        loading={ratio.loading || ratio.data === undefined}
        value={formatPercent(ratio.data ?? 0, 1)}
      />
      <StatTile
        label="Median days on market"
        loading={medianDom.loading || medianDom.data === undefined}
        value={String(Math.round(medianDom.data ?? 0))}
        unit="days"
      />
      <StatTile
        label="Projected GCI"
        loading={metrics.loading || !metrics.data}
        value={formatCurrencyCompact(metrics.data?.projectedGci ?? 0)}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  unit,
  badge,
  loading,
}: {
  label: string;
  value: string;
  unit?: string;
  badge?: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card className="p-6">
      <p className="text-micro">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-28" />
      ) : (
        <div className="mt-3 flex items-end justify-between gap-2">
          <p className="font-display text-3xl leading-none tabular">
            {value}
            {unit && (
              <span className="ml-1.5 font-sans text-sm font-medium normal-case text-muted-foreground">
                {unit}
              </span>
            )}
          </p>
          {badge}
        </div>
      )}
    </Card>
  );
}
