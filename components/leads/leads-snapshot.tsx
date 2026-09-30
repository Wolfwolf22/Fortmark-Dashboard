"use client";

/**
 * The Contacts snapshot: five counts an agent reads before anything else.
 *
 * Every figure is computed by the server over the contacts this person may list,
 * from the same predicates the table applies — so a card and the table it opens
 * are the same number. A card is also a shortcut: it applies exactly the filters
 * it counts. If the counts cannot be had, the strip says so; it never shows a
 * zero it did not measure. (There is no "Unassigned" card: every contact has an
 * owner, so that count could only ever be zero.)
 */
import { Skeleton } from "@/components/ui/skeleton";
import type { ContactQuery, LeadSnapshot } from "@/lib/data/adapters/leads";
import { cn } from "@/lib/utils";

interface Card {
  id: string;
  label: string;
  value: (s: LeadSnapshot) => number;
  filters: ContactQuery;
  tone?: "warn";
}

const CARDS: Card[] = [
  { id: "active", label: "Active", value: (s) => s.active, filters: { active: true } },
  { id: "new", label: "New · 7 days", value: (s) => s.newThisWeek, filters: { created: "7d" } },
  { id: "due", label: "Due today", value: (s) => s.dueToday, filters: { active: true, followUp: "due_today" } },
  { id: "overdue", label: "Overdue", value: (s) => s.overdue, filters: { active: true, followUp: "overdue" }, tone: "warn" },
  { id: "quiet", label: "No touch 14+ days", value: (s) => s.noTouch14, filters: { active: true, lastTouch: "14d" } },
];

const KEYS = ["stage", "source", "intent", "agentId", "mine", "active", "followUp", "lastTouch", "created"] as const;

/** Whether the current filters are exactly this card's, so it can show as selected. */
function isSelected(current: ContactQuery, card: Card): boolean {
  const want = card.filters as Record<string, unknown>;
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
  if (!snapshot) {
    return failed && !loading ? (
      <p role="status" className="text-sm text-muted-foreground">
        Counts are unavailable right now.
      </p>
    ) : (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-hidden>
        {CARDS.map((c) => (
          <Skeleton key={c.id} className="h-[3.75rem] rounded-panel" />
        ))}
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label="Contacts snapshot"
      aria-busy={loading}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      {CARDS.map((card) => {
        const value = card.value(snapshot);
        const selected = isSelected(current, card);
        return (
          <button
            key={card.id}
            type="button"
            aria-pressed={selected}
            data-testid={`snapshot-${card.id}`}
            onClick={() => onApply(selected ? {} : card.filters)}
            className={cn(
              "rounded-panel border border-border bg-card px-3 py-2.5 text-left transition-colors duration-150 hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-foreground bg-tint"
            )}
          >
            <span className="text-micro block">{card.label}</span>
            <span
              className={cn(
                "tabular mt-0.5 block text-xl font-semibold leading-tight",
                card.tone === "warn" && value > 0 && "text-status-warn"
              )}
            >
              {value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
