"use client";

/** Measured counts and shortcuts over the same server predicates as the list. */
import { ArrowUpRight, CalendarClock, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconWell } from "@/components/ui/icon-well";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { ContactQuery, LeadSnapshot } from "@/lib/data/adapters/leads";
import { cn } from "@/lib/utils";

interface SnapshotCard {
  id: string;
  label: string;
  description: string;
  value: (s: LeadSnapshot) => number;
  filters: ContactQuery;
  tone?: "warn";
}

const CARDS: SnapshotCard[] = [
  { id: "overdue", label: "Overdue", description: "Open contacts · past due", value: (s) => s.overdue, filters: { active: true, followUp: "overdue" }, tone: "warn" },
  { id: "due", label: "Due today", description: "Open contacts · today", value: (s) => s.dueToday, filters: { active: true, followUp: "due_today" } },
  { id: "quiet", label: "No touch 14+ days", description: "Open contacts · last touch", value: (s) => s.noTouch14, filters: { active: true, lastTouch: "14d" } },
  { id: "active", label: "Active", description: "Open relationship stages", value: (s) => s.active, filters: { active: true } },
  { id: "new", label: "New · 7 days", description: "Added in the last 7 days", value: (s) => s.newThisWeek, filters: { created: "7d" } },
];

const UPCOMING: ContactQuery = { active: true, followUp: "upcoming" };
const KEYS = ["stage", "source", "intent", "agentId", "mine", "active", "followUp", "lastTouch", "created"] as const;

/** Exact filter match; sorting, pagination and private search do not change the view. */
function isSelected(current: ContactQuery, filters: ContactQuery): boolean {
  const want = filters as Record<string, unknown>;
  const have = current as Record<string, unknown>;
  return KEYS.every((k) => JSON.stringify(want[k]) === JSON.stringify(have[k]));
}

export function LeadsSnapshotStrip({
  snapshot,
  loading,
  failed,
  current,
  onApply,
}: {
  snapshot: LeadSnapshot | undefined;
  loading: boolean;
  failed: boolean;
  current: ContactQuery;
  onApply: (filters: ContactQuery) => void;
}) {
  const upcomingSelected = isSelected(current, UPCOMING);

  return (
    <section aria-label="Relationship snapshot" aria-busy={loading} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconWell icon={ListTodo} />
          <div>
            <h2 className="text-sm font-semibold leading-snug">Relationship snapshot</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Follow-ups, open contacts and recent additions.</p>
          </div>
        </div>
        <Button
          type="button"
          variant={upcomingSelected ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={upcomingSelected}
          onClick={() => onApply(upcomingSelected ? {} : UPCOMING)}
        >
          <CalendarClock aria-hidden />
          Upcoming follow-ups
          <ArrowUpRight aria-hidden />
        </Button>
      </div>

      {!snapshot ? (
        failed && !loading ? (
          <Card className="p-4" role="status">
            <p className="text-sm font-medium">Counts are unavailable right now.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">You can still search contacts or choose a view below.</p>
          </Card>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(9.5rem,1fr)] gap-3 overflow-x-auto pb-1 lg:grid-flow-row lg:grid-cols-5" aria-hidden>
            {CARDS.map((card) => <Skeleton key={card.id} className="h-[84px] rounded-panel" />)}
          </div>
        )
      ) : (
        <>
          {failed && !loading && (
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">Counts could not refresh. Showing the last loaded figures.</p>
          )}
          <div role="group" aria-label="Contacts snapshot" className="-m-1 grid grid-flow-col auto-cols-[minmax(9.5rem,1fr)] gap-3 overflow-x-auto p-1 [scrollbar-width:thin] lg:grid-flow-row lg:grid-cols-5">
            {CARDS.map((card) => {
              const value = card.value(snapshot);
              const selected = isSelected(current, card.filters);
              return (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`snapshot-${card.id}`}
                  onClick={() => onApply(selected ? {} : card.filters)}
                  className={cn(
                    "min-h-[84px] min-w-0 rounded-panel border border-border bg-card p-3 text-left shadow-card transition-colors duration-150 hover:bg-tint",
                    selected && "border-foreground bg-tint ring-1 ring-foreground"
                  )}
                >
                  <span className="flex min-h-5 items-center justify-between gap-2">
                    {card.tone === "warn" && value > 0 ? (
                      <StatusPill tone="warn">{card.label}</StatusPill>
                    ) : (
                      <span className="text-[13px] font-medium leading-snug text-muted-foreground">{card.label}</span>
                    )}
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="mt-2 block text-2xl font-semibold leading-none tracking-[-0.035em] tabular">{value}</span>
                  <span className="sr-only">{card.description}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
