"use client";

import * as React from "react";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartTooltipFrame, chartColor } from "@/components/charts/chart-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { MetricNote, MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { centsToDollars, shortMonthLabel } from "@/components/home/metric-format";
import type { MonthPoint } from "@/lib/metrics/types";
import { formatCurrency } from "@/lib/utils";

/**
 * Commission that has actually been closed, by the month it closed in.
 *
 * History only. The forward **projection** now lives in the daily brief at the
 * top of the page, and keeping the two apart is the point: this card used to
 * carry a projected headline directly above a chart of realised commission,
 * which invited exactly the misreading the whole release exists to prevent —
 * that money the paperwork implies is money that has arrived.
 *
 * Every figure comes from `projectCommission` in the transaction domain. There
 * is one implementation of commission arithmetic in this codebase and a chart
 * is not allowed to become a second one.
 */
export default function ProjectedCommissionWidget() {
  const { metrics } = useHomeMetrics();
  // Lifted so the selection carries into the expanded dialog.
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <WidgetCard icon={BarChart3} title="Commission closed" preset={null}>
      <MetricState
        group={metrics?.transactions}
        detail="Connect the transaction database to see commission."
        skeleton={<Skeleton className="h-[220px] w-full rounded-panel" />}
      >
        {(data) => (
          <div>
            <ClosedCommissionChart
              months={data.monthly}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        )}
      </MetricState>
    </WidgetCard>
  );
}

interface Bucket {
  label: string;
  month: string;
  value: number;
  active: boolean;
}

function ClosedCommissionChart({
  months,
  selected,
  onSelect,
}: {
  months: MonthPoint[];
  selected: string | null;
  onSelect: (label: string) => void;
}) {
  const expanded = useWidgetExpanded();
  const height = expanded ? 380 : 220;

  const points: Bucket[] = months.map((month, i) => ({
    label: shortMonthLabel(month.month),
    month: month.month,
    value: centsToDollars(month.commissionCents),
    active: i === months.length - 1,
  }));

  if (points.every((p) => p.value === 0)) {
    return (
      <div
        className="flex items-center rounded-panel bg-tint px-4"
        style={{ height: height / 2 }}
      >
        <MetricNote>No commission has been closed in the last twelve months</MetricNote>
      </div>
    );
  }

  const focused =
    points.find((p) => p.label === selected) ??
    points.find((p) => p.active) ??
    points[points.length - 1];

  return (
    <div>
      <ChartFrame height={height}>
        <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} accessibilityLayer>
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
                      name: "Closed commission",
                      value: formatCurrency(Number(payload[0]?.value ?? 0)),
                    },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive animationDuration={300}>
            {points.map((p) => (
              <Cell
                key={p.label}
                cursor="pointer"
                fill={p.active || p.label === focused?.label ? chartColor("active") : chartColor("5")}
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
          commission from deals closed that month
        </p>
      )}
    </div>
  );
}
