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
 * Commission, split into the two statements it actually makes.
 *
 * The headline is a **projection**: gross commission implied by the terms
 * entered on the deals currently being worked. It is not revenue and it is not
 * earned — it is what the paperwork says these deals would pay if they all
 * closed as written, and the card says exactly that underneath. Deals with no
 * commission terms project nothing and are counted separately, so the figure
 * is never mistaken for a complete one.
 *
 * The bars are **history**: commission from deals that actually closed, by the
 * month they closed in. Projections and history never share an axis.
 *
 * All of it comes from `projectCommission` in the transaction domain. There is
 * one implementation of commission arithmetic in this codebase and a chart is
 * not allowed to become a second one.
 */
export default function ProjectedCommissionWidget() {
  const { metrics } = useHomeMetrics();
  // Lifted so the selection carries into the expanded dialog.
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <WidgetCard icon={BarChart3} title="Projected commission" preset={null}>
      <MetricState
        group={metrics?.transactions}
        detail="Connect the transaction database to see commission."
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-[220px] w-full rounded-panel" />
          </div>
        }
      >
        {(data) => (
          <div>
            <div className="mb-4">
              <p className="font-display text-4xl leading-none tabular">
                {formatCurrency(centsToDollars(data.projectedCommissionCents))}
              </p>
              <div className="mt-2 space-y-1">
                <MetricNote>
                  Gross, projected from the terms on {data.activeCount} active{" "}
                  {data.activeCount === 1 ? "deal" : "deals"} — not earned
                </MetricNote>
                {data.projectedCommissionUntermedCount > 0 && (
                  <MetricNote>
                    {data.projectedCommissionUntermedCount}{" "}
                    {data.projectedCommissionUntermedCount === 1 ? "deal has" : "deals have"} no
                    commission terms entered and project nothing
                  </MetricNote>
                )}
              </div>
            </div>
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
