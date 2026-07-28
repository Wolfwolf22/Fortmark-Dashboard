"use client";

import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PillProgress } from "@/components/ui/pill-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getLeaderboard } from "@/lib/data/adapters/agents";
import { useQuery } from "@/lib/data/hooks";
import { useDateRange } from "@/lib/stores/date-range";
import { periodSublabel } from "@/lib/dates";
import { formatCurrencyCompact } from "@/lib/utils";
import { ReportCard } from "./report-card";

/**
 * Production by agent — top eight producers with closed dollars, deal count,
 * and a pill bar sized against the top performer.
 */
export function ProductionByAgentCard() {
  const { preset, range } = useDateRange();
  const from = range.from.getTime();
  const to = range.to.getTime();
  const { data, loading } = useQuery(() => getLeaderboard(range), [
    preset,
    from,
    to,
  ]);

  const rows = (data ?? []).slice(0, 8);
  const topClosed = rows.reduce((max, r) => Math.max(max, r.closedDollars), 0);

  return (
    <ReportCard title="Production by agent" sublabel={periodSublabel(preset)}>
      {loading || !data ? (
        <ul className="space-y-4" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 || topClosed === 0 ? (
        <EmptyState
          icon={Users}
          title="No closed production in this period"
          description="Widen the range to compare closed dollars across agents."
        />
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.agentId}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-semibold">
                  {row.name}
                </span>
                <span className="tabular whitespace-nowrap text-[13px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {formatCurrencyCompact(row.closedDollars)}
                  </span>
                  {" · "}
                  {row.dealsClosed} {row.dealsClosed === 1 ? "deal" : "deals"}
                </span>
              </div>
              <PillProgress
                value={row.closedDollars}
                max={topClosed}
                className="h-2"
                label={`${row.name} closed dollars versus the top performer`}
              />
            </li>
          ))}
        </ul>
      )}
    </ReportCard>
  );
}
