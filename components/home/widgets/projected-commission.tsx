"use client";

import * as React from "react";
import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartFrame,
  ChartTooltipFrame,
  chartColor,
} from "@/components/charts/chart-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { useQuery } from "@/lib/data/hooks";
import {
  getDashboardMetrics,
  type CommissionPoint,
} from "@/lib/data/adapters/metrics";
import { formatCurrency } from "@/lib/utils";

/**
 * Projected commission by period: GCI bucketed across the series returned by
 * the metrics adapter, current bucket highlighted. Clicking a bar pins its
 * value to the caption under the chart.
 */
export default function ProjectedCommissionWidget() {
  // Gate persisted period overrides off first paint (hydration safety).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const { preset, range, overridden, setOverride } = useWidgetPeriod(
    "projected-commission"
  );
  const { data, loading } = useQuery(
    () => getDashboardMetrics(range, preset),
    [preset, range.from.getTime(), range.to.getTime()]
  );

  // Lifted so the selection carries into the expanded dialog.
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <WidgetCard
      domain="transactions"
      icon={BarChart3}
      title="Projected commission"
      preset={mounted ? preset : null}
      onPresetChange={setOverride}
      presetOverridden={overridden}
    >
      <CommissionChart
        points={data?.commissionByPeriod}
        loading={loading}
        selected={selected}
        onSelect={setSelected}
      />
    </WidgetCard>
  );
}

function CommissionChart({
  points,
  loading,
  selected,
  onSelect,
}: {
  points: CommissionPoint[] | undefined;
  loading: boolean;
  selected: string | null;
  onSelect: (label: string) => void;
}) {
  const expanded = useWidgetExpanded();
  const height = expanded ? 380 : 220;

  if (loading || !points) {
    return (
      <div className="space-y-3">
        <Skeleton style={{ height }} className="w-full rounded-panel" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  }

  // Caption target: explicit selection, else the active (current) bucket.
  const focused =
    points.find((p) => p.label === selected) ??
    points.find((p) => p.active) ??
    points[points.length - 1];

  return (
    <div>
      <ChartFrame height={height}>
        <BarChart
          data={points}
          margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} stroke={chartColor("grid")} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            dy={4}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "hsl(var(--tint))" }}
            content={({ active, payload, label }) =>
              active && payload && payload.length ? (
                <ChartTooltipFrame
                  label={String(label)}
                  rows={[
                    {
                      name: "Projected GCI",
                      value: formatCurrency(Number(payload[0]?.value ?? 0)),
                    },
                  ]}
                />
              ) : null
            }
          />
          <Bar
            dataKey="value"
            radius={[6, 6, 0, 0]}
            maxBarSize={40}
            isAnimationActive
            animationDuration={300}
          >
            {points.map((p) => (
              <Cell
                key={p.label}
                cursor="pointer"
                fill={
                  p.active || p.label === focused?.label
                    ? chartColor("active")
                    : chartColor("5")
                }
                onClick={() => onSelect(p.label)}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
      {focused && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">{focused.label}</span>
          {": "}
          <span className="tabular font-semibold text-foreground">
            {formatCurrency(focused.value)}
          </span>{" "}
          projected GCI
        </p>
      )}
    </div>
  );
}
