"use client";

/**
 * How a widget says "I don't know".
 *
 * There is exactly one of these in the product, deliberately. The moment each
 * tile invents its own phrasing for a missing source, two of them start
 * disagreeing about what a blank means — and the most expensive mistake a
 * dashboard can make is rendering "cannot answer" the same way as "zero".
 *
 * So: `0` is a number and belongs to the widget. Everything else — not
 * connected, unreachable, not yours to see, no identity yet — comes through
 * here, quietly, in the muted voice the rest of the interface already uses.
 * No red, no alarm, no empty-state illustration. The dashboard is stating a
 * fact about itself, not reporting an incident.
 */
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useHomeMetrics } from "./metrics-provider";
import type { MetricAvailability, MetricGroup } from "@/lib/metrics/types";

/** What each availability means to the person reading the tile. */
const MESSAGES: Record<Exclude<MetricAvailability, "available">, string> = {
  not_configured: "Not connected",
  unavailable: "Temporarily unavailable",
  not_permitted: "Not available for your role",
  no_identity: "Finish setting up your profile to see this",
};

/** The one-line note under a headline figure, when there is a caveat. */
export function MetricNote({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-snug text-muted-foreground">{children}</p>;
}

export function UnavailableBody({
  availability,
  detail,
}: {
  availability: Exclude<MetricAvailability, "available">;
  detail?: string;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-sm font-medium text-muted-foreground">{MESSAGES[availability]}</p>
      {detail && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{detail}</p>}
    </div>
  );
}

export interface MetricStateProps<T> {
  group: MetricGroup<T> | undefined;
  /** Shown while the single Home request is in flight. */
  skeleton: ReactNode;
  /** Extra sentence under the unavailable message, e.g. naming the source. */
  detail?: string;
  children: (data: T) => ReactNode;
}

/**
 * Render a metric group: the skeleton while loading, the honest sentence when
 * the source cannot answer, and the widget's own content when it can.
 */
export function MetricState<T>({ group, skeleton, detail, children }: MetricStateProps<T>) {
  const { loading, error } = useHomeMetrics();

  if (error) {
    return (
      <UnavailableBody
        availability="unavailable"
        detail="Metrics could not be loaded. Refresh to retry."
      />
    );
  }
  if (loading || !group) return <>{skeleton}</>;
  if (group.availability !== "available") {
    return <UnavailableBody availability={group.availability} detail={detail} />;
  }
  return <>{children(group.data)}</>;
}

/** The default skeleton for a single headline figure with a caption. */
export function FigureSkeleton() {
  return (
    <div className="flex h-full flex-col justify-between gap-5">
      <Skeleton className="h-10 w-28" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
