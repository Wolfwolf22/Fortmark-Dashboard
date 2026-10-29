"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ListTodo } from "lucide-react";
import { useHomeMetrics } from "./metrics-provider";
import { dueText, greetingParts } from "./hero-text";

/** A factual queue summary. An empty schedule is not a deal-health claim. */
function AttentionSummary() {
  const { metrics, loading, error } = useHomeMetrics();

  if (error) {
    return <p className="text-sm text-muted-foreground">Metrics could not be loaded. Refresh to retry.</p>;
  }
  if (loading || !metrics) {
    return (
      <div aria-hidden className="flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-panel bg-tint" />
        <div className="space-y-2">
          <div className="h-3 w-32 animate-pulse rounded bg-tint" />
          <div className="h-3 w-44 animate-pulse rounded bg-tint" />
        </div>
      </div>
    );
  }

  const group = metrics.attention;
  if (group.availability !== "available") {
    return <p className="text-sm text-muted-foreground">The attention queue is not available right now.</p>;
  }

  const items = group.data.items;
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-panel border border-border bg-card">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold">No scheduled items due</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Deadlines and follow-ups appear here.</p>
        </div>
      </div>
    );
  }

  const next = items[0];
  return (
    <Link href={next.href} className="group flex min-h-11 items-center gap-3 rounded-panel text-left">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-panel border border-border bg-card">
        <ListTodo className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {items.length} {items.length === 1 ? "item needs" : "items need"} attention
          {group.data.overdueCount > 0 ? ` · ${group.data.overdueCount} overdue` : ""}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{next.subject} · {dueText(next.daysAway)}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
    </Link>
  );
}

/** Compact welcome, real identity and a queue summary; operations lead the page. */
export function HomeHero({ greetingName, roleLabel }: {
  greetingName: string | null;
  roleLabel: string | null;
}) {
  const { lead, name } = greetingParts(greetingName);
  const [today, setToday] = React.useState<string | null>(null);
  React.useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
  }, []);

  return (
    <section
      aria-labelledby="home-welcome"
      className="mb-6 grid items-center gap-5 border-b border-border pb-6 pt-1 md:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] md:gap-8"
    >
      <div className="min-w-0">
        <p className="text-micro mb-3 flex items-center gap-2.5">
          <span className="h-px w-5 bg-foreground" aria-hidden />
          My FortMark{roleLabel ? ` / ${roleLabel}` : ""}
        </p>
        <h1 id="home-welcome" className="break-words text-[34px] font-semibold leading-[1.12] tracking-[-0.04em] sm:text-[40px] xl:text-[46px]">
          <span className="fm-rise inline-block">{lead}</span>
          {name && <>{" "}<span className="fm-rise fm-rise-delay-1 inline-block">{name}</span></>}
        </h1>
        <p className="mt-3 min-h-5 text-[13px] leading-relaxed text-muted-foreground">
          {today ? `${today} · ` : ""}Your business at a glance.
        </p>
      </div>
      <aside aria-label="Needs attention summary" className="min-w-0 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-7 md:pt-0">
        <AttentionSummary />
      </aside>
    </section>
  );
}
