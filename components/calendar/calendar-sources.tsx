import { CALENDAR_KIND_LABELS, type CalendarPage } from "@/lib/calendar/domain";

export function CalendarSources({ page }: { page: CalendarPage }) {
  if (!page.sources.length) return null;
  return <div className="flex max-w-full flex-wrap gap-x-5 gap-y-2 text-[11px] leading-relaxed text-muted-foreground" aria-label="Calendar source status">{page.sources.map(source => <p key={source.kind}><span className="font-semibold text-foreground">{CALENDAR_KIND_LABELS[source.kind]}</span> · {source.status === "available" ? source.truncated ? `First ${page.items.filter(item => item.kind === source.kind).length} of ${source.total ?? "many"} loaded` : `${source.total ?? 0} loaded` : source.status === "not_configured" ? "Stored source not configured" : "Could not be loaded"}</p>)}</div>;
}
