"use client";

import Link from "next/link";
import { ChevronRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { WidgetCard, useWidgetExpanded } from "@/components/widgets/widget-card";
import { MetricState } from "@/components/home/metric-state";
import { useHomeMetrics } from "@/components/home/metrics-provider";
import type { AttentionItem, AttentionMetrics } from "@/lib/metrics/types";
import { formatDateShort } from "@/lib/utils";

const COLLAPSED_ROWS = 6;

const KIND_LABELS: Record<AttentionItem["kind"], string> = {
  deadline_overdue: "Overdue",
  deadline_soon: "Deadline",
  follow_up_due: "Follow up",
};

/**
 * What actually needs doing, from records that actually exist.
 *
 * Two rules produce every row, and both can be said in one sentence: a
 * transaction deadline that is unmet and due within the week, and a contact
 * whose stored follow-up date has arrived. That is the whole engine.
 *
 * Deliberately not a health score. A deal is not "72/100"; it either has an
 * inspection due on Thursday or it does not. Anything a person cannot check
 * against the record in front of them is not an insight, it is an opinion with
 * a number attached — and the rows the sample generator used to invent here
 * (missing disclosures, expiring agreements) are gone until FortMark stores
 * the documents that would prove them.
 */
export default function ComplianceWidget() {
  const { metrics } = useHomeMetrics();

  return (
    <WidgetCard icon={ShieldAlert} title="Needs attention" preset={null}>
      <MetricState
        group={metrics?.attention}
        detail="Deadlines and follow-ups appear once the deal and contact records are connected."
        skeleton={
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
        }
      >
        {(data) => <AttentionBody data={data} />}
      </MetricState>
    </WidgetCard>
  );
}

/** Overdue reads as a warning; everything else is simply upcoming. */
function toneFor(item: AttentionItem): "warn" | "neutral" {
  return item.daysAway < 0 ? "warn" : "neutral";
}

function hintFor(days: number): string {
  if (days < 0) return days === -1 ? "1 day overdue" : `${Math.abs(days)} days overdue`;
  if (days === 0) return "due today";
  return days === 1 ? "due tomorrow" : `due in ${days}d`;
}

function AttentionBody({ data }: { data: AttentionMetrics }) {
  const expanded = useWidgetExpanded();
  const items = data.items;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nothing needs attention this week"
        description="Overdue deadlines and follow-ups that are due will appear here."
      />
    );
  }

  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);

  return (
    <div>
      <ul className="divide-y divide-border">
        {visible.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors duration-150 hover:bg-tint"
            >
              <StatusPill tone={toneFor(item)} className="shrink-0">
                {KIND_LABELS[item.kind]}
              </StatusPill>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{item.subject}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.label}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-[13px]">{formatDateShort(item.dueDate)}</p>
                <p className="text-micro mt-0.5">{hintFor(item.daysAway)}</p>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-micro mt-3 border-t border-border pt-3">
        {data.overdueCount > 0
          ? `${data.overdueCount} overdue · ${data.soonCount} due within the week`
          : `${data.soonCount} due within the week`}
        {!expanded && items.length > COLLAPSED_ROWS
          ? ` · showing ${visible.length} of ${items.length}`
          : ""}
      </p>
    </div>
  );
}
