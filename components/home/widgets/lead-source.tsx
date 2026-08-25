"use client";

import * as React from "react";
import { PieChart as PieChartIcon } from "lucide-react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import {
  ChartFrame,
  ChartTooltipFrame,
  chartColor,
} from "@/components/charts/chart-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { useQuery } from "@/lib/data/hooks";
import { getDashboardMetrics } from "@/lib/data/adapters/metrics";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/lib/data/types";

/** Fixed source order — color follows the source, never its rank. */
const SOURCE_ORDER: LeadSource[] = [
  "referral",
  "sphere",
  "signCall",
  "website",
  "openHouse",
  "pastClient",
];

/** Lightness steps assigned in fixed order; the sixth repeats step 3. */
const SOURCE_FILL: Record<LeadSource, string> = {
  referral: chartColor("active"),
  sphere: chartColor("2"),
  signCall: chartColor("3"),
  website: chartColor("4"),
  openHouse: chartColor("5"),
  pastClient: chartColor("3"),
};

interface Slice {
  source: LeadSource;
  label: string;
  count: number;
  pct: number;
}

/**
 * Lead source donut: where the period's leads came from, differentiated by
 * fill density with a 2px card-colored spacer between segments.
 */
export default function LeadSourceWidget() {
  // Gate persisted period overrides off first paint (hydration safety).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const { preset, range, overridden, setOverride } =
    useWidgetPeriod("lead-source");
  const { data, loading } = useQuery(
    () => getDashboardMetrics(range, preset),
    [preset, range.from.getTime(), range.to.getTime()]
  );

  const slices = React.useMemo<Slice[] | undefined>(() => {
    if (!data) return undefined;
    const counts = new Map(
      data.leadSourceBreakdown.map((b) => [b.source, b.count])
    );
    const total = data.leadSourceBreakdown.reduce((sum, b) => sum + b.count, 0);
    return SOURCE_ORDER.filter((source) => (counts.get(source) ?? 0) > 0).map(
      (source) => {
        const count = counts.get(source) ?? 0;
        return {
          source,
          label: LEAD_SOURCE_LABELS[source],
          count,
          pct: total > 0 ? Math.round((count / total) * 100) : 0,
        };
      }
    );
  }, [data]);

  return (
    <WidgetCard
      domain="leads"
      icon={PieChartIcon}
      title="Lead source"
      preset={mounted ? preset : null}
      onPresetChange={setOverride}
      presetOverridden={overridden}
    >
      <LeadSourceBody slices={slices} loading={loading} />
    </WidgetCard>
  );
}

function LeadSourceBody({
  slices,
  loading,
}: {
  slices: Slice[] | undefined;
  loading: boolean;
}) {
  const expanded = useWidgetExpanded();
  const chartHeight = expanded ? 300 : 200;

  if (loading || !slices) {
    return (
      <div className="space-y-4">
        <div
          className="flex items-center justify-center"
          style={{ height: chartHeight }}
        >
          <Skeleton className="h-40 w-40 rounded-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  const total = slices.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={PieChartIcon}
        title="No leads in this period"
        description="Widen the range or add a lead."
      />
    );
  }

  return (
    <div
      className={
        expanded ? "grid items-center gap-8 sm:grid-cols-2" : "space-y-4"
      }
    >
      <div className="relative">
        <ChartFrame height={chartHeight}>
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                const slice = payload?.[0]?.payload as Slice | undefined;
                return active && slice ? (
                  <ChartTooltipFrame
                    label={slice.label}
                    rows={[
                      { name: "Leads", value: `${slice.count} (${slice.pct}%)` },
                    ]}
                  />
                ) : null;
              }}
            />
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius="58%"
              outerRadius="85%"
              paddingAngle={1}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              isAnimationActive
              animationDuration={300}
            >
              {slices.map((s) => (
                <Cell key={s.source} fill={SOURCE_FILL[s.source]} />
              ))}
            </Pie>
          </PieChart>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-display text-3xl tabular">{total}</p>
          <p className="text-micro mt-1">Leads</p>
        </div>
      </div>
      <ul className="space-y-2">
        {slices.map((s) => (
          <li key={s.source} className="flex items-center gap-2.5 text-[13px]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: SOURCE_FILL[s.source] }}
            />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="tabular font-semibold">{s.count}</span>
            <span className="text-micro w-9 text-right tabular">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
