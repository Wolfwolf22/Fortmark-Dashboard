"use client";
import { Check } from "lucide-react";
import type { CalendarColor, CalendarLabel } from "@/lib/calendar/personal-domain";
import { CALENDAR_COLORS } from "@/lib/calendar/personal-domain";
import { cn } from "@/lib/utils";
/** User-assigned calendar colors are semantic accents; reading surfaces and text stay neutral. */
const PALETTE: Record<CalendarColor, { dot: string; edge: string }> = {
 red: { dot: "bg-red-700 dark:bg-red-400", edge: "!border-l-red-700 dark:!border-l-red-400" },
 amber: { dot: "bg-amber-700 dark:bg-amber-400", edge: "!border-l-amber-700 dark:!border-l-amber-400" },
 green: { dot: "bg-green-700 dark:bg-green-400", edge: "!border-l-green-700 dark:!border-l-green-400" },
 blue: { dot: "bg-blue-700 dark:bg-blue-400", edge: "!border-l-blue-700 dark:!border-l-blue-400" },
 purple: { dot: "bg-purple-700 dark:bg-purple-400", edge: "!border-l-purple-700 dark:!border-l-purple-400" },
 teal: { dot: "bg-teal-700 dark:bg-teal-400", edge: "!border-l-teal-700 dark:!border-l-teal-400" },
 slate: { dot: "bg-slate-700 dark:bg-slate-400", edge: "!border-l-slate-700 dark:!border-l-slate-400" },
 pink: { dot: "bg-pink-700 dark:bg-pink-400", edge: "!border-l-pink-700 dark:!border-l-pink-400" },
};
export function calendarLabelEdge(label?: CalendarLabel | null): string { return label ? cn("border-l-[3px]", PALETTE[label.color].edge) : ""; }
export function CalendarColorDot({ color }: { color: CalendarColor }) { return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", PALETTE[color].dot)}/>; }
export function CalendarLabelBadge({ label, compact = false }: { label: CalendarLabel; compact?: boolean }) {
 return <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-foreground", compact ? "text-[10px] leading-3" : "text-[11px] leading-4")} title={`${label.name}${label.archivedAt ? " · Archived label" : ""}`}><CalendarColorDot color={label.color}/><span className="min-w-0 break-words [overflow-wrap:anywhere]">{label.name}{label.archivedAt && <span className="ml-1 text-muted-foreground">· Archived</span>}</span></span>;
}
export function CalendarColorPicker({ value, onChange, disabled = false }: { value: CalendarColor; onChange: (color: CalendarColor) => void; disabled?: boolean }) {
 return <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 text-sm font-medium">Color</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{CALENDAR_COLORS.map(color => <label key={color} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs capitalize focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background", value === color ? "border-foreground bg-tint font-semibold" : "border-input bg-card")}><input type="radio" name="calendar-label-color" value={color} checked={value === color} onChange={() => onChange(color)} className="sr-only peer"/><CalendarColorDot color={color}/><span>{color}</span>{value === color && <Check aria-hidden className="ml-auto h-3.5 w-3.5"/>}</label>)}</div></fieldset>;
}
export function CalendarLabelSelect({ value, labels, current, onChange, disabled = false, id }: { value: string | null; labels: CalendarLabel[]; current?: CalendarLabel | null; onChange: (id: string | null) => void; disabled?: boolean; id: string }) {
 const choices = labels.filter(label => !label.archivedAt || label.id === value), missing = value && !choices.some(label => label.id === value), selected = labels.find(label => label.id === value) ?? (current?.id === value ? current : null);
 return <div className="min-w-0 space-y-2"><label htmlFor={id} className="text-sm font-medium">Label</label><select id={id} value={value ?? ""} disabled={disabled} onChange={event => onChange(event.target.value || null)} className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground"><option value="">No label</option>{missing && <option value={value!}>{current?.name ?? "Previously selected label"}{current?.archivedAt ? " · Archived" : " · Refresh to review"}</option>}{choices.map(label => <option key={label.id} value={label.id} disabled={Boolean(label.archivedAt && label.id !== value)}>{label.name}{label.archivedAt ? " · Archived" : ""}</option>)}</select>{selected && <CalendarLabelBadge label={selected}/>}</div>;
}
