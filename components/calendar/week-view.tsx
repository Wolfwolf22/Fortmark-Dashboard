"use client";

import * as React from "react";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfWeek,
} from "date-fns";
import { CalendarX2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarEvent } from "@/lib/data/types";
import { cn, formatTime } from "@/lib/utils";

const HOUR_START = 8;
const HOUR_END = 19;
const HOUR_PX = 48;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * HOUR_PX;
const MIN_BLOCK_PX = 24;

function hourLabel(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Week grid: 8:00–19:00 rows, 7 day columns, blocks placed by time. */
export function WeekView({
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
      start: startOfWeek(anchor, { weekStartsOn: 1 }),
      end: endOfWeek(anchor, { weekStartsOn: 1 }),
    });
  }, [cursorTime]);

  const hours = React.useMemo(
    () =>
      Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i),
    []
  );

  if (loading) {
    return (
      <Card className="p-4">
        <div className="grid grid-cols-[56px_repeat(7,1fr)] gap-2">
          <div />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={`h-${i}`} className="h-8 w-full" />
          ))}
          <div />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-[420px] w-full" />
          ))}
        </div>
      </Card>
    );
  }

  const weekEvents = events ?? [];

  if (weekEvents.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarX2}
          title="No events this week"
          description="Add one from the New menu."
          className="py-20"
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
        <div aria-hidden />
        {days.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.getTime()}
              className="flex min-w-0 items-center justify-center gap-1.5 border-l border-border py-2.5"
            >
              <span className="text-micro">{format(day, "EEE")}</span>
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular",
                  today && "bg-primary text-primary-foreground"
                )}
              >
                {format(day, "d")}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative">
        {hours.map(
          (hour) =>
            hour > HOUR_START && (
              <div
                key={hour}
                aria-hidden
                className="absolute left-14 right-0 border-t border-border"
                style={{ top: (hour - HOUR_START) * HOUR_PX }}
              />
            )
        )}
        <div
          className="grid grid-cols-[56px_repeat(7,1fr)]"
          style={{ height: GRID_HEIGHT }}
        >
          <div className="relative" aria-hidden>
            {hours.map((hour) => (
              <span
                key={hour}
                className="text-micro absolute right-2"
                style={{ top: (hour - HOUR_START) * HOUR_PX + 4 }}
              >
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const dayEvents = weekEvents
              .filter((event) => isSameDay(new Date(event.start), day))
              .sort((a, b) => a.start.localeCompare(b.start));
            // Lane = how many earlier events this one overlaps; used for a
            // slight left offset so stacked events stay visible.
            const spans = dayEvents.map((event) => {
              const start = Math.max(
                minutesOfDay(new Date(event.start)),
                HOUR_START * 60
              );
              const end = Math.min(
                Math.max(minutesOfDay(new Date(event.end)), start + 1),
                HOUR_END * 60
              );
              return { start, end };
            });
            const lanes = spans.map((span, i) => {
              let lane = 0;
              for (let j = 0; j < i; j++) {
                if (spans[j].end > span.start) lane++;
              }
              return Math.min(lane, 3);
            });
            return (
              <div
                key={day.getTime()}
                className="relative min-w-0 border-l border-border"
              >
                {dayEvents.map((event, i) => {
                  const top =
                    ((spans[i].start - HOUR_START * 60) / 60) * HOUR_PX;
                  const height = Math.max(
                    ((spans[i].end - spans[i].start) / 60) * HOUR_PX,
                    MIN_BLOCK_PX
                  );
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onEventClick(event)}
                      title={`${formatTime(event.start)} · ${event.title}`}
                      className="absolute overflow-hidden rounded-md border-l-2 border-l-foreground bg-tint px-1.5 py-1 text-left transition-colors duration-150 hover:bg-accent"
                      style={{
                        top,
                        height,
                        left: 2 + lanes[i] * 10,
                        right: 2,
                        zIndex: lanes[i] + 1,
                      }}
                    >
                      <span className="block truncate text-[11px] font-semibold leading-tight">
                        <span className="text-muted-foreground tabular">
                          {formatTime(event.start)}
                        </span>{" "}
                        {event.title}
                      </span>
                      {event.address && (
                        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                          {event.address}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
