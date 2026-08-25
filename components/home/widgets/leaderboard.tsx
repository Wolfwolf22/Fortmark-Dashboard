"use client";

import * as React from "react";
import { Trophy } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PillProgress } from "@/components/ui/pill-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { useWidgetPeriod } from "@/components/home/use-widget-period";
import { useQuery } from "@/lib/data/hooks";
import { getLeaderboard } from "@/lib/data/adapters/agents";
import type { AgentProduction } from "@/lib/data/types";
import { cn, formatCurrencyCompact, initials } from "@/lib/utils";

const COLLAPSED_ROWS = 6;

/** Shared column template so the header and rows stay aligned. */
const GRID =
  "grid grid-cols-[1.75rem_minmax(0,1fr)_5.5rem_4.5rem_6rem_4.5rem] items-center gap-x-3";

/**
 * Agent leaderboard: production ranked by closed dollars plus active pipeline,
 * each row's bar compared against the top performer.
 */
export default function LeaderboardWidget() {
  // Gate persisted period overrides off first paint (hydration safety).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const { preset, range, overridden, setOverride } =
    useWidgetPeriod("leaderboard");
  const { data, loading } = useQuery(
    () => getLeaderboard(range),
    [range.from.getTime(), range.to.getTime()]
  );

  return (
    <WidgetCard
      domain="agents"
      icon={Trophy}
      title="Agent leaderboard"
      preset={mounted ? preset : null}
      onPresetChange={setOverride}
      presetOverridden={overridden}
    >
      <LeaderboardBody rows={data} loading={loading} />
    </WidgetCard>
  );
}

function LeaderboardBody({
  rows,
  loading,
}: {
  rows: AgentProduction[] | undefined;
  loading: boolean;
}) {
  const expanded = useWidgetExpanded();

  if (loading || !rows) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: COLLAPSED_ROWS }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-panel" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No production in this period"
        description="Widen the range to see agent activity."
      />
    );
  }

  const top = rows[0];
  const max = top ? top.closedDollars + top.volume : 0;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[32rem]">
        <div className={cn(GRID, "border-b border-border pb-2")}>
          <span className="text-micro">#</span>
          <span className="text-micro">Agent</span>
          <span className="text-micro text-right">Offers made</span>
          <span className="text-micro text-right">Volume</span>
          <span className="text-micro text-right">Deals closed</span>
          <span className="text-micro text-right">Closed $</span>
        </div>
        <ul>
          {visible.map((row, i) => (
            <li
              key={row.agentId}
              className="border-b border-border py-3 last:border-0 last:pb-0"
            >
              <div className={GRID}>
                <span className="text-micro tabular">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback>{initials(row.name)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-[13px] font-semibold">
                    {row.name}
                  </span>
                </div>
                <span className="tabular text-right text-[13px]">
                  {row.offersMade}
                </span>
                <span className="tabular text-right text-[13px]">
                  {formatCurrencyCompact(row.volume)}
                </span>
                <span className="tabular text-right text-[13px]">
                  {row.dealsClosed}
                </span>
                <span className="tabular text-right text-[13px] font-semibold">
                  {formatCurrencyCompact(row.closedDollars)}
                </span>
                <div className="col-span-5 col-start-2 mt-2">
                  <PillProgress
                    value={row.closedDollars + row.volume}
                    max={max}
                    className="h-1.5"
                    label={`${row.name} production compared with the top performer`}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
        {!expanded && rows.length > COLLAPSED_ROWS && (
          <p className="text-micro mt-3">
            Showing {visible.length} of {rows.length} agents — expand to see
            everyone
          </p>
        )}
      </div>
    </div>
  );
}
