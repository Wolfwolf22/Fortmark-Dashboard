"use client";

/**
 * Calendar — month and week views over typed brokerage events. Local cursor
 * plus view toggle drive the adapter range; type chips include/exclude event
 * kinds; clicking an event opens the shared detail dialog.
 */
import { useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EVENT_TYPE_ICONS } from "@/components/calendar/event-chip";
import { EventDetail } from "@/components/calendar/event-detail";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { getEvents } from "@/lib/data/adapters/calendar";
import { useQuery } from "@/lib/data/hooks";
import {
  CalendarEvent,
  EVENT_TYPE_LABELS,
  EventType,
} from "@/lib/data/types";
import { cn } from "@/lib/utils";

type CalendarView = "month" | "week";

const ALL_TYPES: EventType[] = [
  "showing",
  "inspection",
  "appraisal",
  "closing",
  "openHouse",
  "deadline",
];

const WEEK_OPTS = { weekStartsOn: 1 as const };

export default function Page() {
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [types, setTypes] = useState<EventType[]>(ALL_TYPES);

  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const cursorTime = cursor.getTime();
  const range = useMemo(() => {
    const anchor = new Date(cursorTime);
    if (view === "month") {
      // Cover the whole visible grid, leading and trailing days included.
      return {
        from: startOfWeek(startOfMonth(anchor), WEEK_OPTS),
        to: endOfWeek(endOfMonth(anchor), WEEK_OPTS),
      };
    }
    return {
      from: startOfWeek(anchor, WEEK_OPTS),
      to: endOfWeek(anchor, WEEK_OPTS),
    };
  }, [view, cursorTime]);

  const typesKey = [...types].sort().join(",");
  const { data: events, loading } = useQuery(
    () =>
      types.length === 0
        ? Promise.resolve<CalendarEvent[]>([])
        : getEvents(range, types),
    [view, range.from.getTime(), range.to.getTime(), typesKey]
  );

  const label =
    view === "month"
      ? format(cursor, "MMMM yyyy")
      : `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`;

  function goPrevious() {
    setCursor((c) => (view === "month" ? addMonths(c, -1) : addWeeks(c, -1)));
  }

  function goNext() {
    setCursor((c) => (view === "month" ? addMonths(c, 1) : addWeeks(c, 1)));
  }

  function goToday() {
    setCursor(new Date());
  }

  function toggleType(type: EventType) {
    setTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function openEvent(event: CalendarEvent) {
    setDetailEvent(event);
    setDetailOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={goPrevious}
            aria-label={view === "month" ? "Previous month" : "Previous week"}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={goNext}
            aria-label={view === "month" ? "Next month" : "Next week"}
          >
            <ChevronRight />
          </Button>
        </div>
        <h2 className="min-w-0 truncate text-lg font-bold leading-none tabular">
          {label}
        </h2>
        <div className="ml-auto">
          <Segmented
            ariaLabel="Calendar view"
            value={view}
            onChange={setView}
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
            ]}
          />
        </div>
      </div>

      <div
        role="group"
        aria-label="Filter by event type"
        className="flex flex-wrap items-center gap-1.5"
      >
        {ALL_TYPES.map((type) => {
          const active = types.includes(type);
          const Icon = EVENT_TYPE_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggleType(type)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-150",
                active
                  ? "bg-primary text-primary-foreground hover:bg-primary/85"
                  : "bg-tint text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {EVENT_TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>

      {view === "month" ? (
        <MonthView
          cursor={cursor}
          events={events}
          loading={loading}
          onEventClick={openEvent}
        />
      ) : (
        <WeekView
          cursor={cursor}
          events={events}
          loading={loading}
          onEventClick={openEvent}
        />
      )}

      <EventDetail
        event={detailEvent}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
