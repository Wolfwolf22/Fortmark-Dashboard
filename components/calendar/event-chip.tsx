"use client";
import { AlarmClock, CalendarDays, ClipboardList, MapPinned, Phone, type LucideIcon } from "lucide-react";
import type { CalendarItem, CalendarKind } from "@/lib/calendar/domain";
import { cn } from "@/lib/utils";
import { businessDayKey } from "@/lib/metrics/business-day";
import { calendarTime, formatCalendarDay } from "./calendar-state";
export const CALENDAR_KIND_ICONS: Record<CalendarKind, LucideIcon> = { showing: CalendarDays, tour: MapPinned, transaction_deadline: ClipboardList, next_action: Phone, reminder: AlarmClock };
export const CALENDAR_ITEM_LABELS: Record<CalendarKind, string> = { showing: "Showing", tour: "Tour plan", transaction_deadline: "Transaction deadline", next_action: "Client next action", reminder: "Follow-up reminder" };
export function calendarItemTime(item: CalendarItem): string { if (item.allDay) return "Date only"; if (!item.startsAt) return "Time not recorded"; if (item.endsAt && item.blocksTime && businessDayKey(new Date(item.startsAt)) !== businessDayKey(new Date(item.endsAt))) return `${formatCalendarDay(businessDayKey(new Date(item.startsAt)), { month: "short", day: "numeric" })}, ${calendarTime(item.startsAt)} – ${formatCalendarDay(businessDayKey(new Date(item.endsAt)), { month: "short", day: "numeric" })}, ${calendarTime(item.endsAt)}`; return `${calendarTime(item.startsAt)}${item.endsAt && item.blocksTime ? ` – ${calendarTime(item.endsAt)}` : ""}`; }
export function EventChip({ event, onClick, className }: { event: CalendarItem; onClick: () => void; className?: string }) {
 const Icon = CALENDAR_KIND_ICONS[event.kind];
 return <button type="button" onClick={onClick} title={`${CALENDAR_ITEM_LABELS[event.kind]} · ${calendarItemTime(event)} · ${event.title}`} className={cn("flex min-h-10 w-full min-w-0 items-start gap-1.5 rounded-md bg-tint px-2 py-1.5 text-left text-[11px] leading-4 transition-colors hover:bg-accent", className)}><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden/><span className="min-w-0"><span className="block truncate font-semibold">{event.title}</span><span className="block truncate text-muted-foreground tabular">{calendarItemTime(event)}</span></span></button>;
}
