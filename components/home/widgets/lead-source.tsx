"use client";

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
import { MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { monthLabel } from "@/components/home/metric-format";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/lib/data/types";

/** Fixed source order — color follows the source, never its rank. */
const SOURCE_ORDER: LeadSource[] = [
  "referral",
  "sphere",
  "sign_call",
  "website",
  "open_house",
  "past_client",
  "social",
  "advertising",
  "walk_in",
  "other",
];

/** Lightness steps assigned in fixed order, cycling from the sixth on. */
const SOURCE_FILL: Record<LeadSource, string> = {
  referral: chartColor("active"),
  sphere: chartColor("2"),
  sign_call: chartColor("3"),
  website: chartColor("4"),
  open_house: chartColor("5"),
  past_client: chartColor("3"),
  social: chartColor("2"),
  advertising: chartColor("4"),
  walk_in: chartColor("5"),
  other: chartColor("3"),
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
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={PieChartIcon} title="New leads by source" preset={null}>
      <MetricState
        group={metrics?.contacts}
        detail="Connect the contact database to see where leads come from."
        skeleton={<LeadSourceSkeleton />}
      >
        {(data) => (
          <LeadSourceBody
            slices={toSlices(data.newLeadsBySource)}
            monthStart={metrics?.monthStart}
          />
        )}
      </MetricState>
    </WidgetCard>
  );
}

/**
 * Only sources that actually produced a lead this month appear. An absent
 * source is not drawn as a zero-width sliver — the donut describes where this
 * month's business came from, not the list of channels that exist.
 */
function toSlices(breakdown: { source: LeadSource; count: number }[]): Slice[] {
  const counts = new Map(breakdown.map((b) => [b.source, b.count]));
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  return SOURCE_ORDER.filter((source) => (counts.get(source) ?? 0) > 0).map((source) => {
    const count = counts.get(source) ?? 0;
    return {
      source,
      label: LEAD_SOURCE_LABELS[source],
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  });
}

function LeadSourceSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center" style={{ height: 200 }}>
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

function LeadSourceBody({
  slices,
  monthStart,
}: {
  slices: Slice[];
  monthStart: string | undefined;
}) {
  const expanded = useWidgetExpanded();
  const chartHeight = expanded ? 300 : 200;
  const total = slices.reduce((sum, s) => sum + s.count, 0);

  // A real zero. The contact database answered and nobody new arrived this
  // month — which is a finding, not a gap to be filled with a sample.
  if (total === 0) {
    return (
      <EmptyState
        icon={PieChartIcon}
        title={`No new leads in ${monthStart ? monthLabel(monthStart) : "this month"}`}
        description="New contacts will appear here as they are added."
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
          <p className="text-micro mt-1">New leads</p>
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
