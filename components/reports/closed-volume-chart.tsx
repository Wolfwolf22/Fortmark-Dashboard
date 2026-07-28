"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import {
  ChartFrame,
  ChartTooltipFrame,
  chartColor,
} from "@/components/charts/chart-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { getClosedVolumeSeries } from "@/lib/data/adapters/metrics";
import { useQuery } from "@/lib/data/hooks";
import { useDateRange } from "@/lib/stores/date-range";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { periodSublabel } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { ExportCsvButton } from "./export-csv-button";
import { buildCsv, csvFilename } from "./export-csv";
import { ReportCard } from "./report-card";

type View = "chart" | "table";

/**
 * Closed volume over time — monotone monochrome line with a whisper of area
 * fill, plus a table view so the series is readable without the chart.
 */
export function ClosedVolumeChartCard() {
  const { preset } = useDateRange();
  const { data, loading } = useQuery(() => getClosedVolumeSeries(preset), [
    preset,
  ]);
  const [view, setView] = React.useState<View>("chart");

  const points = data?.points ?? [];
  const allZero = points.length > 0 && points.every((p) => p.value === 0);

  return (
    <ReportCard
      title="Closed volume over time"
      sublabel={periodSublabel(preset)}
      actions={
        <>
          <Segmented<View>
            ariaLabel="Closed volume view"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
          <ExportCsvButton
            filename={csvFilename("closed-volume", preset)}
            disabled={loading || points.length === 0}
            getCsv={() =>
              buildCsv(
                ["Period", "Closed volume"],
                points.map((p) => [p.label, formatCurrency(p.value)])
              )
            }
          />
        </>
      }
    >
      {loading || !data ? (
        <Skeleton className="h-[220px] w-full rounded-panel" />
      ) : allZero ? (
        <EmptyState
          icon={BarChart3}
          title="No closed volume in these periods"
          description="Widen the range or check back after the next closing."
        />
      ) : view === "chart" ? (
        <ChartFrame height={220}>
          <AreaChart
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
              cursor={{ stroke: chartColor("grid") }}
              content={({ active, payload, label }) =>
                active && payload && payload.length ? (
                  <ChartTooltipFrame
                    label={String(label)}
                    rows={[
                      {
                        name: "Closed volume",
                        value: formatCurrency(Number(payload[0]?.value ?? 0)),
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartColor("active")}
              strokeWidth={2}
              fill={chartColor("active")}
              fillOpacity={0.06}
              dot={false}
              activeDot={{
                r: 4,
                fill: chartColor("active"),
                stroke: "hsl(var(--card))",
                strokeWidth: 2,
              }}
              isAnimationActive
              animationDuration={300}
            />
          </AreaChart>
        </ChartFrame>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Closed volume</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.date}>
                <TableCell
                  className={p.active ? "font-semibold" : undefined}
                >
                  {p.label}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatCurrency(p.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
