"use client";

import { Trophy } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PillProgress } from "@/components/ui/pill-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { centsToDollars, monthLabel } from "@/components/home/metric-format";
import type { LeaderboardRow } from "@/lib/metrics/types";
import { cn, formatCurrencyCompact, initials } from "@/lib/utils";

const COLLAPSED_ROWS = 6;

/** Shared column template so the header and rows stay aligned. */
const GRID = "grid grid-cols-[1.75rem_minmax(0,1fr)_5rem_5rem_6rem] items-center gap-x-3";

/**
 * Production by agent, this month.
 *
 * Only a broker, admin or transaction coordinator sees it. For an agent the
 * metrics service returns `not_permitted` rather than a table of one, because
 * an agent who may not open a colleague's deal may not read that colleague's
 * totals either — an aggregate discloses just as precisely as a row.
 *
 * "Offers made" is gone with the sample generator that invented it. Every
 * column here is a count or a sum of real records.
 */
export default function LeaderboardWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={Trophy} title="Agent leaderboard" preset={null}>
      <MetricState
        group={metrics?.leaderboard}
        detail="Brokerage-wide production is shown to brokers, admins and coordinators."
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            {Array.from({ length: COLLAPSED_ROWS }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-panel" />
            ))}
          </div>
        }
      >
        {(rows) => <LeaderboardBody rows={rows} monthStart={metrics?.monthStart} />}
      </MetricState>
    </WidgetCard>
  );
}

function LeaderboardBody({
  rows,
  monthStart,
}: {
  rows: LeaderboardRow[];
  monthStart: string | undefined;
}) {
  const expanded = useWidgetExpanded();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No deals on the books yet"
        description="Agents appear here once they have a transaction."
      />
    );
  }

  // Ranked on closed dollars; the bar compares like with like rather than
  // adding closed money to open pipeline, which are not the same thing.
  const max = Math.max(...rows.map((r) => r.closedVolumeCents), 0);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[30rem]">
        <div className={cn(GRID, "border-b border-border pb-2")}>
          <span className="text-micro">#</span>
          <span className="text-micro">Agent</span>
          <span className="text-micro text-right">Active</span>
          <span className="text-micro text-right">Closed</span>
          <span className="text-micro text-right">Closed $</span>
        </div>
        <ul>
          {visible.map((row, i) => (
            <li key={row.agentUserId} className="border-b border-border py-3 last:border-0 last:pb-0">
              <div className={GRID}>
                <span className="text-micro tabular">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback>{initials(row.name)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-[13px] font-semibold">{row.name}</span>
                </div>
                <span className="tabular text-right text-[13px]">{row.activeCount}</span>
                <span className="tabular text-right text-[13px]">{row.closedCount}</span>
                <span className="tabular text-right text-[13px] font-semibold">
                  {formatCurrencyCompact(centsToDollars(row.closedVolumeCents))}
                </span>
                {max > 0 && (
                  <div className="col-span-4 col-start-2 mt-2">
                    <PillProgress
                      value={row.closedVolumeCents}
                      max={max}
                      className="h-1.5"
                      label={`${row.name} closed volume compared with the top performer`}
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-micro mt-3">
          Closed figures cover {monthStart ? monthLabel(monthStart) : "this month"}
          {!expanded && rows.length > COLLAPSED_ROWS
            ? ` · showing ${visible.length} of ${rows.length} agents`
            : ""}
        </p>
      </div>
    </div>
  );
}
