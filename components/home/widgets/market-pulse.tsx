"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  FileCheck2,
  Plus,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { DeltaBadge } from "@/components/ui/delta-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { getMarketActivity } from "@/lib/data/adapters/market";
import { useQuery } from "@/lib/data/hooks";
import type { MarketActivityItem } from "@/lib/data/types";
import { formatRelative } from "@/lib/utils";

const COLLAPSED_ROWS = 6;

const KIND_ICONS: Record<MarketActivityItem["kind"], LucideIcon> = {
  priceReduction: TrendingDown,
  newComp: FileCheck2,
  demandShift: Activity,
  newListing: Plus,
  closed: CheckCircle2,
};

type PulseTab = "today" | "history";

/**
 * Market pulse feed: price cuts, comps, demand shifts, and closings in the
 * brokerage's segments — split into today's tape and the recent history.
 */
export default function MarketPulseWidget() {
  const [tab, setTab] = React.useState<PulseTab>("today");
  const { data, loading, error } = useQuery(() => getMarketActivity(tab), [tab]);

  return (
    <WidgetCard
      domain="market" icon={Activity} title="Market pulse" preset={null}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as PulseTab)}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <PulseFeed tab="today" items={data} loading={loading} error={error} />
        </TabsContent>
        <TabsContent value="history">
          <PulseFeed tab="history" items={data} loading={loading} error={error} />
        </TabsContent>
      </Tabs>
    </WidgetCard>
  );
}

function PulseFeed({
  tab,
  items,
  loading,
  error,
}: {
  tab: PulseTab;
  items: MarketActivityItem[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  const expanded = useWidgetExpanded();

  if (error) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Market activity failed to load. Refresh the page to retry.
      </p>
    );
  }

  if (loading || !items) {
    return (
      <ul className="divide-y divide-border">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-start gap-3 py-3 first:pt-0">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <Skeleton className="h-3 w-12" />
          </li>
        ))}
      </ul>
    );
  }

  if (items.length === 0) {
    return tab === "today" ? (
      <EmptyState
        icon={Activity}
        title="Quiet so far today"
        description="New market activity lands here as it happens. Check history for recent movement."
      />
    ) : (
      <EmptyState
        icon={Activity}
        title="No recorded activity"
        description="Past market activity builds up here over time."
      />
    );
  }

  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);

  return (
    <div>
      <ul className="divide-y divide-border">
        {visible.map((item) => {
          const Icon = KIND_ICONS[item.kind];
          return (
            <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {item.detail}
                </p>
                <p className="text-micro mt-1">{item.neighborhood}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="tabular whitespace-nowrap text-[11px] text-muted-foreground">
                  {formatRelative(item.timestamp)}
                </span>
                {item.delta && (
                  <DeltaBadge
                    value={
                      item.delta.direction === "down"
                        ? -item.delta.value
                        : item.delta.value
                    }
                    suffix={item.delta.unit}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!expanded && items.length > COLLAPSED_ROWS && (
        <p className="text-micro mt-3 border-t border-border pt-3">
          Showing {visible.length} of {items.length} — expand to see all
        </p>
      )}
    </div>
  );
}
