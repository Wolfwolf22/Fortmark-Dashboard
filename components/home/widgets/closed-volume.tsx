"use client";

import { TrendingUp } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { Sparkline } from "@/components/charts/sparkline";
import { DeltaBadge } from "@/components/ui/delta-badge";
import { WidgetCard } from "@/components/widgets/widget-card";
import { FigureSkeleton, MetricNote, MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { centsToDollars, monthLabel, toPeriodPoints } from "@/components/home/metric-format";
import { formatCurrencyCompact } from "@/lib/utils";

/**
 * Closed dollars this month, against the twelve months behind it.
 *
 * The sparkline is real production history — one point per calendar month,
 * built from the deals that reached `closed` with a closed date in it. The
 * prior-month comparison is only drawn when there is a prior month with
 * something in it: a percentage change from zero is not a percentage change,
 * and an arrow implying growth from nothing is the kind of flattery this
 * dashboard is meant to refuse.
 */
export default function ClosedVolumeWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={TrendingUp} title="Closed volume" preset={null}>
      <MetricState
        group={metrics?.transactions}
        detail="Connect the transaction database to see closed volume."
        skeleton={<FigureSkeleton />}
      >
        {(data) => {
          const months = data.monthly;
          const previous = months.length >= 2 ? months[months.length - 2] : undefined;
          const current = centsToDollars(data.closedThisMonthVolumeCents);
          const prior = previous ? centsToDollars(previous.closedVolumeCents) : 0;
          const deltaPct = prior > 0 ? ((current - prior) / prior) * 100 : null;

          return (
            <div className="flex h-full flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CountUp
                    value={current}
                    format={formatCurrencyCompact}
                    className="font-display text-4xl leading-none tabular"
                  />
                  <p className="tabular mt-2 text-[13px] text-muted-foreground">
                    {previous
                      ? `${monthLabel(previous.month)} ${formatCurrencyCompact(prior)}`
                      : "No prior month to compare"}
                  </p>
                </div>
                {deltaPct === null ? (
                  <span
                    className="inline-flex items-center rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-muted-foreground"
                    aria-label="No prior-month volume to compare"
                  >
                    —
                  </span>
                ) : (
                  <DeltaBadge value={deltaPct} />
                )}
              </div>
              {months.some((m) => m.closedVolumeCents > 0) ? (
                <Sparkline points={toPeriodPoints(months, (m) => m.closedVolumeCents)} />
              ) : (
                <MetricNote>Nothing has closed in the last twelve months</MetricNote>
              )}
            </div>
          );
        }}
      </MetricState>
    </WidgetCard>
  );
}
