"use client";

import { Layers } from "lucide-react";
import { CountUp } from "@/components/charts/count-up";
import { WidgetCard } from "@/components/widgets/widget-card";
import { FigureSkeleton, MetricNote, MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import { centsToDollars } from "@/components/home/metric-format";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils";

/**
 * Contract dollars on the deals currently being worked.
 *
 * Only deals that actually have a contract price are in the sum. A deal at the
 * offer stage with no agreed figure contributes nothing — it is not estimated
 * from the list price, and it is not quietly dropped either: the count of
 * unpriced deals sits under the total, so the number is understood as partial
 * whenever it is.
 */
export default function PipelineValueWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={Layers} title="Pipeline value" preset={null}>
      <MetricState
        group={metrics?.transactions}
        detail="Connect the transaction database to see the pipeline."
        skeleton={<FigureSkeleton />}
      >
        {(data) => {
          const dollars = centsToDollars(data.activeVolumeCents);
          return (
            <div className="flex h-full flex-col justify-between gap-5">
              <div>
                <CountUp
                  value={dollars}
                  format={formatCurrencyCompact}
                  className="font-display text-4xl leading-none tabular"
                />
                <p className="tabular mt-2 text-[13px] text-muted-foreground">
                  {formatCurrency(dollars)} in contract prices
                </p>
              </div>
              <div className="border-t border-border pt-4">
                <MetricNote>
                  {data.activeVolumeUnpricedCount === 0
                    ? `Across ${data.activeCount} active ${data.activeCount === 1 ? "deal" : "deals"}`
                    : `${data.activeVolumeUnpricedCount} of ${data.activeCount} active ${
                        data.activeCount === 1 ? "deal has" : "deals have"
                      } no contract price yet, so they are not in this total`}
                </MetricNote>
              </div>
            </div>
          );
        }}
      </MetricState>
    </WidgetCard>
  );
}
