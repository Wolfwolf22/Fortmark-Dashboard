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
  History,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
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
  const { data, loading, error, refetch } = useQuery<TimelineItem[]>(() => getTimeline(leadId), [leadId]);
  const [all, setAll] = useState(false);
  // Every contact opens collapsed.
  const [forLead, setForLead] = useState(leadId);
  if (forLead !== leadId) {
    setForLead(leadId);
    setAll(false);
  }

  return (
    <section aria-labelledby="lead-activity-heading" data-testid="lead-timeline">
      <div className="flex items-center gap-2.5">
      <IconWell icon={History} />
      <h3 id="lead-activity-heading" className="text-[15px] font-semibold">
        Activity{data && data.length > 0 ? ` (${data.length})` : ""}
      </h3>
      </div>
      {!data && loading ? (
        <div className="mt-3 space-y-3" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <div role="alert" className="mt-3 rounded-panel border border-border bg-tint p-4 text-sm">
          <p>Activity could not be loaded.</p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={refetch}>Try again</Button>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="mt-3 rounded-panel border border-dashed border-input px-4 py-5 text-[13px] text-muted-foreground">No activity yet.</p>
      ) : (
        <>
          <ol id="lead-activity-list" className="mt-3 rounded-panel border border-border p-4">
            {(all ? data : data.slice(0, COLLAPSED)).map((item) => {
              const Icon = ICONS[item.type] ?? StickyNote;
              return (
                <li key={item.id} className="group relative flex gap-3 pb-5 last:pb-0" data-testid="timeline-item" data-type={item.type}>
                  <span aria-hidden className="absolute bottom-0 left-[15px] top-10 w-px bg-border group-last:hidden" />
                  <IconWell icon={Icon} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug">{item.title}</p>
                    {item.detail && <p className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{item.detail}</p>}
                    <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">
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
              className="mt-3 min-h-10 rounded-lg border border-input px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-accent"
            >
              {all ? "Show fewer" : "Show all activity"}
            </button>
          )}
        </>
      )}
      {error && data && <p role="alert" className="mt-3 text-sm text-muted-foreground">Activity could not be refreshed. <button type="button" className="min-h-10 rounded-md px-1 font-semibold underline underline-offset-4" onClick={refetch}>Try again</button></p>}
    </section>
  );
}
