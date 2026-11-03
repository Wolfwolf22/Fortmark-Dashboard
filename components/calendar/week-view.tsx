"use client";
import type { CalendarItem } from "@/lib/calendar/domain";
import { itemsForDay } from "@/lib/calendar/scheduling";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { calendarDays, formatCalendarDay } from "./calendar-state";
import { CalendarDayContents } from "./day-view";
export function WeekView({ day, today, items, loading, onItemClick, onDayClick }: { day: string; today: string; items: CalendarItem[] | undefined; loading: boolean; onItemClick: (item: CalendarItem) => void; onDayClick: (day: string) => void }) {
 const days = calendarDays("week", day);
 if (!items) return <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-7">{days.map(value => <Skeleton key={value} className="h-56 w-full rounded-card"/>)}</div>;
 return <div aria-busy={loading} className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-7">{days.map(value => { const count = itemsForDay(items, value).length; return <Card key={value} className="min-w-0 self-start overflow-hidden"><button type="button" onClick={() => onDayClick(value)} className={cn("flex min-h-14 w-full min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-3 text-left hover:bg-accent", value === today && "bg-tint")}><span className="text-sm font-semibold">{formatCalendarDay(value, { weekday: "short", month: "short", day: "numeric" })}{value === today && <span className="mt-0.5 block text-[10px] text-muted-foreground">Today</span>}</span><span className="text-xs text-muted-foreground tabular">{count}</span></button><CalendarDayContents day={value} items={items} onItemClick={onItemClick} compact/></Card>; })}</div>;
}
