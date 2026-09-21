"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  FileCheck2,
  PhoneCall,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import type { ActivityItem } from "@/lib/metrics/types";
import { formatRelative } from "@/lib/utils";

const COLLAPSED_ROWS = 5;

const ICONS: Record<ActivityItem["kind"], LucideIcon> = {
  transaction_created: FileCheck2,
  transaction_stage_changed: ArrowRightLeft,
  transaction_closed: CheckCircle2,
  contact_created: UserPlus,
  contact_stage_changed: ArrowRightLeft,
  contact_touch: PhoneCall,
};

/**
 * What has actually happened, lately.
 *
 * Built from `transaction_events` and `contact_activities` — the records the
 * domains already write when something changes. It is a presentation layer
 * over those, not a second history: nothing is stored to feed this card, and
 * the audit log is deliberately not its source. Audit rows answer "who did
 * what, and can we prove it"; they carry actor identity for compliance, and a
 * feed is the wrong place for them.
 *
 * This card used to be a market tape of invented price cuts and demand
 * shifts. Market intelligence returns when there is a market source behind
 * it; until then the space belongs to events that really occurred.
 */
export default function MarketPulseWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={Activity} title="Recent activity" preset={null}>
      <MetricState
        group={metrics?.activity}
        detail="Activity appears once the deal and contact records are connected."
        skeleton={
          <ul className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </li>
            ))}
          </ul>
        }
      >
        {(items) => <ActivityBody items={items} />}
      </MetricState>
    </WidgetCard>
  );
}

function ActivityBody({ items }: { items: ActivityItem[] }) {
  const expanded = useWidgetExpanded();

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Nothing has happened yet"
        description="Deals and contacts you work on show up here as they change."
      />
    );
  }

  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);

  return (
    <ul className="divide-y divide-border">
      {visible.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors duration-150 hover:bg-tint"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tint">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{item.summary}</p>
                <p className="text-micro mt-0.5">{formatRelative(item.at)}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
