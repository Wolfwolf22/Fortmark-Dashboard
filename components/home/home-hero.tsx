"use client";

/**
 * The Home hero: who this is, what day it is, and the one thing to look at.
 *
 * It replaced the identity card as Home's greeting. The name comes from the
 * server (`greetingNameFor`: preferred display name → legal first name →
 * Clerk first name), so it is never hard-coded and never an email; when none
 * resolves, the greeting is simply "Welcome".
 *
 * The right-hand panel is not an "insight". It restates the attention queue
 * the metrics service already computed — how many items, how many overdue,
 * and the next one — and holds the reporting-period control that used to
 * live in the top bar. Nothing on it is inferred or generated.
 *
 * The block is always black (`dark` token scope): the brand's black cover
 * band, in both themes.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useHomeMetrics } from "./metrics-provider";
import { DateRangeSelector } from "@/components/layout/date-range-selector";
import type { AttentionItem } from "@/lib/metrics/types";
import { cn } from "@/lib/utils";
import { dueText, greetingParts } from "./hero-text";

function AttentionSummary() {
  const { metrics, loading, error } = useHomeMetrics();

  if (error) {
    return <p className="text-[13px] text-white/60">Metrics could not be loaded. Refresh to retry.</p>;
  }
  if (loading || !metrics) {
    return (
      <div aria-hidden className="space-y-2.5">
        <div className="h-9 w-16 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  const group = metrics.attention;
  if (group.availability !== "available") {
    return <p className="text-[13px] text-white/60">The attention queue is not available right now.</p>;
  }

  const items = group.data.items;
  if (items.length === 0) {
    return (
      <div>
        <p className="font-display text-4xl leading-none tabular text-white">0</p>
        <p className="mt-3 text-[13px] text-white/70">Nothing requires immediate attention.</p>
      </div>
    );
  }

  const next: AttentionItem = items[0];
  return (
    <div>
      <p className="font-display text-4xl leading-none tabular text-white">{items.length}</p>
      <p className="mt-2 text-[12px] text-white/60">
        {group.data.overdueCount > 0 ? `${group.data.overdueCount} overdue · ` : ""}
        {items.length === 1 ? "1 item" : `${items.length} items`} in the queue
      </p>
      <Link
        href={next.href}
        className="group mt-4 flex items-start justify-between gap-3 border-t border-white/10 pt-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-white">
            {next.label} · {next.subject}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-[12px]",
              next.daysAway < 0 ? "text-white" : "text-white/60"
            )}
          >
            Next · {dueText(next.daysAway)}
          </span>
        </span>
        <ArrowUpRight
          className="mt-0.5 h-4 w-4 shrink-0 text-white/50 transition-colors group-hover:text-white"
          aria-hidden
        />
      </Link>
    </div>
  );
}

export function HomeHero({
  greetingName,
  roleLabel,
}: {
  greetingName: string | null;
  roleLabel: string | null;
}) {
  const { lead, name } = greetingParts(greetingName);

  // The reader's date, not the server's UTC idea of it.
  const [today, setToday] = React.useState<string | null>(null);
  React.useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    );
  }, []);

  return (
    <section
      aria-labelledby="home-welcome"
      className="dark mb-5 grid grid-cols-[minmax(0,1fr)] gap-6 overflow-hidden rounded-card border border-white/10 bg-[#0b0b0b] p-6 text-foreground md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:gap-10"
    >
      <div className="flex min-w-0 flex-col justify-between gap-8">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
          <span aria-hidden className="h-px w-6 bg-white/40" />
          My FortMark{roleLabel ? ` · ${roleLabel}` : ""}
        </p>

        <div>
          {/* One heading. The two spans stage the entrance: the lead word
              first, the name a beat later. Mounted once per visit to Home;
              a metrics refresh re-renders nothing here. */}
          <h1
            id="home-welcome"
            className="text-[44px] font-semibold leading-[0.95] tracking-[-0.035em] text-white sm:text-[56px] xl:text-[68px]"
          >
            <span className="fm-rise inline-block">{lead}</span>
            {name && (
              <>
                {" "}
                <span className="fm-rise fm-rise-delay-1 inline-block">{name}</span>
              </>
            )}
          </h1>
          <p className="fm-rise fm-rise-delay-2 mt-4 text-[14px] text-white/60">
            {today ? `${today} · ` : ""}Your business at a glance.
          </p>
        </div>
      </div>

      <aside
        aria-label="Needs attention summary"
        className="flex min-w-0 flex-col justify-between gap-6 rounded-panel border border-white/10 bg-white/[0.03] p-5"
      >
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
            Needs attention
          </p>
          <AttentionSummary />
        </div>
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
            Reporting period
          </p>
          <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <DateRangeSelector />
          </div>
        </div>
      </aside>
    </section>
  );
}
