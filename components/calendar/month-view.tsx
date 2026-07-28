"use client";

import * as React from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarX2 } from "lucide-react";
import { EventChip, EVENT_TYPE_ICONS } from "./event-chip";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarEvent } from "@/lib/data/types";
import { cn, formatTime } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Month grid: 6 weeks × 7 days, chips per day, day dialog for overflow. */
export function MonthView({
  cursor,
  events,
  loading,
  onEventClick,
}: {
  cursor: Date;
  events: CalendarEvent[] | undefined;
  loading: boolean;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const cursorTime = cursor.getTime();
  const days = React.useMemo(() => {
    const anchor = new Date(cursorTime);
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
    });
  }, [cursorTime]);

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events ?? []) {
      const key = dayKey(new Date(event.start));
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);

  const [openDay, setOpenDay] = React.useState<Date | null>(null);
  const openDayEvents = openDay ? (eventsByDay.get(dayKey(openDay)) ?? []) : [];

  if (loading) {
    return (
      <Card className="p-4">
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={`h-${i}`} className="h-4 w-full" />
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((day) => (
            <div key={day} className="text-micro px-2.5 py-2.5 text-right">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {days.map((day) => {
            const inMonth = isSameMonth(day, cursor);
            const today = isToday(day);
            const dayEvents = eventsByDay.get(dayKey(day)) ?? [];
            const overflow = dayEvents.length - MAX_CHIPS;
            return (
              <div
                key={day.getTime()}
                className="flex min-h-[112px] min-w-0 flex-col gap-1 bg-card p-1.5"
              >
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpenDay(day)}
                    aria-label={`View events on ${format(day, "MMMM d, yyyy")}`}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-150 tabular",
                      today
                        ? "bg-primary text-primary-foreground hover:bg-primary/85"
                        : "hover:bg-accent",
                      !inMonth && !today && "text-muted-foreground"
                    )}
                  >
                    {format(day, "d")}
                  </button>
                </div>
                {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                  <EventChip
                    key={event.id}
                    event={event}
                    onClick={() => onEventClick(event)}
                    className={cn(!inMonth && "opacity-60")}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenDay(day)}
                    className="self-start rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Dialog
        open={openDay !== null}
        onOpenChange={(open) => {
          if (!open) setOpenDay(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openDay ? format(openDay, "EEEE, MMMM d") : ""}
            </DialogTitle>
            <DialogDescription>
              {openDayEvents.length === 1
                ? "1 event"
                : `${openDayEvents.length} events`}
            </DialogDescription>
          </DialogHeader>
          {openDayEvents.length === 0 ? (
            <EmptyState
              icon={CalendarX2}
              title="No events this day"
              description="Add one from the New menu."
              className="py-8"
            />
          ) : (
            <div className="-mx-2 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
              {openDayEvents.map((event) => {
                const Icon = EVENT_TYPE_ICONS[event.type];
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => {
                      setOpenDay(null);
                      onEventClick(event);
                    }}
                    className="flex items-start gap-3 rounded-panel p-2.5 text-left transition-colors duration-150 hover:bg-tint"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-tint">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {event.title}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground tabular">
                        {formatTime(event.start)} – {formatTime(event.end)}
                        {event.address ? ` · ${event.address}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
