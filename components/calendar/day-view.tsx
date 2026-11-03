"use client";
import { CalendarCheck2 } from "lucide-react";
import type { CalendarItem } from "@/lib/calendar/domain";
import { itemsForDay } from "@/lib/calendar/scheduling";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconWell } from "@/components/ui/icon-well";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CALENDAR_ITEM_LABELS, CALENDAR_KIND_ICONS, calendarItemTime } from "./event-chip";
import { CalendarLabelBadge, calendarLabelEdge } from "./calendar-labels";
import { cn } from "@/lib/utils";
import { formatCalendarDay } from "./calendar-state";
export function CalendarItemRow({ item, onClick, compact = false }: { item: CalendarItem; onClick: () => void; compact?: boolean }) {
 return <button type="button" onClick={onClick} className={cn("flex w-full min-w-0 items-start gap-3 p-4 text-left transition-colors hover:bg-tint",calendarLabelEdge(item.label))}><IconWell icon={CALENDAR_KIND_ICONS[item.kind]} className={compact ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-panel"}/><span className="min-w-0 flex-1"><span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{item.title}</span>{!compact && <Badge variant="outline">{CALENDAR_ITEM_LABELS[item.kind]}</Badge>}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{item.subtitle}</span>{item.label&&<span className="mt-2 block"><CalendarLabelBadge label={item.label} compact={compact}/></span>}<span className="mt-2 block text-xs font-medium tabular">{calendarItemTime(item)}</span>{item.kind === "tour" && <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">Plan start · appointments are listed separately</span>}</span></button>;
}
export function CalendarDayContents({ day, items, onItemClick, compact = false }: { day: string; items: CalendarItem[]; onItemClick: (item: CalendarItem) => void; compact?: boolean }) {
 const rows = itemsForDay(items, day), dates = rows.filter(item => item.allDay), timed = rows.filter(item => !item.allDay);
 if (!rows.length) return <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">No loaded items on this day.</p>;
 return <div className="min-w-0">{dates.length > 0 && <section aria-label={`Dates to track on ${day}`}><p className="border-b border-border bg-tint px-4 py-2 text-[11px] font-semibold text-muted-foreground">Dates to track · no reserved time</p><div className="divide-y divide-border">{dates.map(item => <CalendarItemRow key={item.id} item={item} compact={compact} onClick={() => onItemClick(item)}/>)}</div></section>}{timed.length > 0 && <section aria-label={`Timed work on ${day}`}><p className="border-y border-border bg-tint px-4 py-2 text-[11px] font-semibold text-muted-foreground">At a set time · New York</p><div className="divide-y divide-border">{timed.map(item => <CalendarItemRow key={item.id} item={item} compact={compact} onClick={() => onItemClick(item)}/>)}</div></section>}</div>;
}
export function DayView({ day, items, loading, onItemClick, partial = false }: { day: string; items: CalendarItem[] | undefined; loading: boolean; onItemClick: (item: CalendarItem) => void; partial?: boolean }) {
 if (!items) return <Card aria-busy className="space-y-3 p-4"><Skeleton className="h-8 w-48"/>{[1,2,3].map(value => <Skeleton key={value} className="h-24 w-full rounded-panel"/>)}</Card>;
 const rows = itemsForDay(items, day);
 return <Card aria-busy={loading} className="min-w-0 overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-2 border-b border-border p-4 sm:px-5"><div><h3 className="text-base font-semibold">{formatCalendarDay(day)}</h3><p className="mt-1 text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "item" : "items"} loaded</p></div><p className="text-xs text-muted-foreground">America/New_York</p></div>{rows.length ? <CalendarDayContents day={day} items={items} onItemClick={onItemClick}/> : <EmptyState icon={CalendarCheck2} title="No items loaded for this day" description={partial ? "Some sources are incomplete. Review their status above before planning." : "Use the source filters or choose another day to review your work."} className="py-12"/>}</Card>;
}
