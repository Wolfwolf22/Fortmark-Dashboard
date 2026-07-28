"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { getComplianceItems } from "@/lib/data/adapters/market";
import { useQuery } from "@/lib/data/hooks";
import type { ComplianceItem } from "@/lib/data/types";
import { daysBetween, formatDateShort } from "@/lib/utils";

const COLLAPSED_ROWS = 6;

const KIND_LABELS: Record<ComplianceItem["kind"], string> = {
  expiringListing: "Expiring",
  missingDisclosure: "Missing",
  inspectionDeadline: "Deadline",
};

/**
 * Compliance list: expiring agreements, missing disclosures, and inspection
 * deadlines, each row navigating to the place it gets fixed.
 */
export default function ComplianceWidget() {
  const { data, loading, error } = useQuery(() => getComplianceItems(), []);

  return (
    <WidgetCard icon={ShieldAlert} title="Needs attention" preset={null}>
      <ComplianceBody items={data} loading={loading} error={error} />
    </WidgetCard>
  );
}

function ComplianceBody({
  items,
  loading,
  error,
}: {
  items: ComplianceItem[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  const expanded = useWidgetExpanded();
  // Stable per mount; rows only render after the client-side fetch resolves.
  const [now] = React.useState(() => new Date());

  if (error) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Compliance items failed to load. Refresh the page to retry.
      </p>
    );
  }

  if (loading || !items) {
    return (
      <ul className="divide-y divide-border">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 py-3 first:pt-0">
            <Skeleton className="h-5 w-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-12" />
          </li>
        ))}
      </ul>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nothing requires attention this week"
        description="Expiring agreements, missing documents, and deadlines surface here."
      />
    );
  }

  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);

  return (
    <div>
      <ul className="divide-y divide-border">
        {visible.map((item) => {
          const days = daysBetween(now, item.dueDate);
          const hint = days < 0 ? "overdue" : days === 0 ? "due today" : `due in ${days}d`;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors duration-150 hover:bg-tint"
              >
                <StatusPill tone={item.severity} className="shrink-0">
                  {KIND_LABELS[item.kind]}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-[13px]">{formatDateShort(item.dueDate)}</p>
                  <p className="text-micro mt-0.5">{hint}</p>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
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
