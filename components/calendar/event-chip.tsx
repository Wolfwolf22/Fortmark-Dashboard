"use client";

import {
  AlarmClock,
  DoorOpen,
  Eye,
  KeyRound,
  Scale,
  SearchCheck,
  type LucideIcon,
} from "lucide-react";
import { CalendarEvent, EventType } from "@/lib/data/types";
import { cn, formatTime } from "@/lib/utils";

/** One icon per event type — shared by chips, week blocks, and dialogs. */
export const EVENT_TYPE_ICONS: Record<EventType, LucideIcon> = {
  showing: Eye,
  inspection: SearchCheck,
  appraisal: Scale,
  closing: KeyRound,
  openHouse: DoorOpen,
  deadline: AlarmClock,
};

/** Compact month-cell chip: type icon + start time + title, one line. */
export function EventChip({
  event,
  onClick,
  className,
}: {
  event: CalendarEvent;
  onClick: () => void;
  className?: string;
}) {
  const Icon = EVENT_TYPE_ICONS[event.type];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${formatTime(event.start)} · ${event.title}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-md bg-tint px-1.5 py-0.5 text-left text-[11px] font-medium transition-colors duration-150 hover:bg-accent",
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 text-muted-foreground tabular">
        {formatTime(event.start)}
      </span>
      <span className="truncate">{event.title}</span>
    </button>
  );
}
