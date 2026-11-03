"use client";
import { DayView } from "./day-view";
import { CalendarSources } from "./calendar-sources";
import { calendarFailure, formatCalendarDay, shiftCalendarDay } from "./calendar-state";
import { getInternalCalendar } from "@/lib/data/adapters/internal-calendar";
import { useQuery } from "@/lib/data/hooks";
import type { CalendarItem, CalendarKind } from "@/lib/calendar/domain";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Fetch the selected day independently: a busy month's source limit cannot hide that day's items. */
export function MonthDayDialog({ day, kinds, onClose, onItemClick }: { day: string; kinds: CalendarKind[]; onClose: () => void; onItemClick: (item: CalendarItem) => void }) {
  const kindsKey = kinds.join(","), query = useQuery(() => getInternalCalendar({ fromDay: day, toDay: shiftCalendarDay("day", day, 1), kinds }), [day, kindsKey]);
  const data = query.error ? undefined : query.data;
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
    <DialogHeader className="border-b border-border p-5 pr-12"><DialogTitle>{formatCalendarDay(day, { weekday: "long", month: "long", day: "numeric" })}</DialogTitle><DialogDescription>All loaded items for this date. Open any item to update it here.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto p-4">{query.error ? <div role="alert"><p className="text-sm">{calendarFailure(query.error)}</p><Button variant="outline" className="mt-3" onClick={query.refetch}>Retry this day</Button></div> : <><DayView day={day} items={data?.items} loading={query.loading} onItemClick={onItemClick} partial={data?.sources.some(source => source.status !== "available" || source.truncated)}/>{data && <CalendarSources page={data}/>}</>}</div>
    <div className="border-t border-border p-4"><Button variant="outline" onClick={onClose}>Back to month</Button></div>
  </DialogContent></Dialog>;
}
