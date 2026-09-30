"use client";

/**
 * A contact's activity, newest first, in the CRM's own words: a call, a stage
 * change, a follow-up set, a note added, a client need updated. The server
 * translates the history into these lines — this component only draws them, and
 * loads them when the drawer opens rather than for every row of the list.
 *
 * Collapsed by default to the latest five, so the drawer stays compact. "Show all
 * activity" is a disclosure button (`aria-expanded`, keyboard operable) and shows
 * the rest of what was already loaded — it does not fetch again.
 */
import { useState } from "react";
import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarClock,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  UserCheck,
  UserPlus,
  Users,
  Home,
  ListChecks,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getTimeline, type TimelineItem } from "@/lib/data/adapters/leads";
import { useQuery } from "@/lib/data/hooks";
import { formatDate, formatRelative } from "@/lib/utils";

const ICONS: Record<TimelineItem["type"], LucideIcon> = {
  call: Phone,
  email: Mail,
  text: MessageSquare,
  meeting: Users,
  showing: Home,
  note: StickyNote,
  task: ListChecks,
  stage: ArrowRightLeft,
  follow_up_scheduled: CalendarClock,
  follow_up_completed: CalendarCheck,
  assignment: UserCheck,
  need: Target,
  transaction: Workflow,
  created: UserPlus,
};

/** The drawer stays compact: the latest few, and the rest on request. */
const COLLAPSED = 5;

export function LeadTimeline({ leadId }: { leadId: string }) {
  const { data, loading, error } = useQuery<TimelineItem[]>(() => getTimeline(leadId), [leadId]);
  const [all, setAll] = useState(false);
  // Every contact opens collapsed.
  const [forLead, setForLead] = useState(leadId);
  if (forLead !== leadId) {
    setForLead(leadId);
    setAll(false);
  }

  return (
    <section aria-labelledby="lead-activity-heading" data-testid="lead-timeline">
      <h3 id="lead-activity-heading" className="text-micro">
        Activity{data && data.length > 0 ? ` (${data.length})` : ""}
      </h3>
      {!data && loading ? (
        <div className="mt-3 space-y-3" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Activity could not be loaded.
        </p>
      ) : !data || data.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <>
          <ol id="lead-activity-list" className="mt-3 space-y-3">
            {(all ? data : data.slice(0, COLLAPSED)).map((item) => {
              const Icon = ICONS[item.type] ?? StickyNote;
              return (
                <li key={item.id} className="flex gap-3" data-testid="timeline-item" data-type={item.type}>
                  <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-tint text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{item.title}</p>
                    {item.detail && <p className="mt-0.5 break-words text-sm text-muted-foreground">{item.detail}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <time dateTime={item.at} title={formatDate(item.at)}>
                        {formatRelative(item.at)}
                      </time>
                      {item.by ? ` · ${item.by}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {data.length > COLLAPSED && (
            <button
              type="button"
              aria-expanded={all}
              aria-controls="lead-activity-list"
              onClick={() => setAll((v) => !v)}
              className="mt-3 text-[13px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {all ? "Show fewer" : "Show all activity"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
