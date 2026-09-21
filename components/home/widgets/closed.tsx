"use client";

import { CircleCheck } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { WidgetCard } from "@/components/widgets/widget-card";
import { FigureSkeleton, MetricNote, MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { monthLabel } from "@/components/home/metric-format";

/**
 * Deals that actually closed this month — and, separately, the ones scheduled
 * to.
 *
 * The two are never added together. A deal with a closing date in three weeks
 * has not produced a dollar, and a dashboard that merges "will close" with
 * "did close" is the single most flattering lie a brokerage can tell itself.
 *
 * The goal ring this card used to carry is gone: the goal it measured against
 * was invented by the sample generator. When FortMark stores real targets the
 * ring comes back, measuring a real one.
 */
export default function ClosedWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={CircleCheck} title="Closed this month" preset={null}>
      <MetricState
        group={metrics?.transactions}
        detail="Connect the transaction database to see closings."
        skeleton={<FigureSkeleton />}
      >
        {(data) => (
          <div className="flex h-full flex-col justify-between gap-5">
            <CountUp
              value={data.closedThisMonthCount}
              format={(n) => String(Math.round(n))}
              className="font-display text-4xl leading-none tabular"
            />
            <div className="space-y-1">
              <MetricNote>
                Closed in {metrics ? monthLabel(metrics.monthStart) : "this month"}
              </MetricNote>
              <MetricNote>
                {data.scheduledClosingsThisMonth === 0
                  ? "Nothing else is scheduled to close this month"
                  : `${data.scheduledClosingsThisMonth} more scheduled to close this month`}
              </MetricNote>
            </div>
          </div>
        )}
      </MetricState>
    </WidgetCard>
  );
}
