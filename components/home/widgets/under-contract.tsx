"use client";

import { FilePenLine } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { WidgetCard } from "@/components/widgets/widget-card";
import { FigureSkeleton, MetricNote, MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { scopeLabel } from "@/components/home/metric-format";

/**
 * Deals being worked right now.
 *
 * The count comes from the lifecycle the transaction domain already defines —
 * the six active stages — so it can never drift from what the transactions
 * board shows. `on_hold` is reported beside it rather than folded in: a paused
 * deal is real, but calling it active would overstate the book.
 *
 * Period-independent by nature, so the card carries no period control. "Active"
 * is a fact about now, and a date filter over it would be decoration.
 */
export default function UnderContractWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={FilePenLine} title="Active transactions" preset={null}>
      <MetricState
        group={metrics?.transactions}
        detail="Connect the transaction database to see live deals."
        skeleton={<FigureSkeleton />}
      >
        {(data) => (
          <div className="flex h-full flex-col justify-between gap-5">
            <CountUp
              value={data.activeCount}
              format={(n) => String(Math.round(n))}
              className="font-display text-4xl leading-none tabular"
            />
            <div className="space-y-1">
              <MetricNote>
                {metrics ? scopeLabel(metrics.scope) : "Your book"} · in an active stage now
              </MetricNote>
              {data.onHoldCount > 0 && (
                <MetricNote>
                  {data.onHoldCount} on hold, not counted above
                </MetricNote>
              )}
            </div>
          </div>
        )}
      </MetricState>
    </WidgetCard>
  );
}
