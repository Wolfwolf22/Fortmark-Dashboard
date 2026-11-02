"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowUpRight, CalendarClock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { Skeleton } from "@/components/ui/skeleton";
import { getShowingSummary } from "@/lib/data/adapters/showings";
import { useQuery } from "@/lib/data/hooks";
import { BUSINESS_TIME_ZONE } from "@/lib/metrics/business-day";
import { formatNextActionDueAt } from "@/lib/contacts/next-action";

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** A separate owner-private schedule; the contact's single next action is never substituted. */
export function UpcomingShowings() {
  const { data, loading, error, refetch } = useQuery(getShowingSummary, []);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") refetch(); };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [refetch]);

  return <section aria-labelledby="home-showings-title" className="mb-6 min-w-0 rounded-card border border-border bg-card p-4 shadow-card sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><IconWell icon={CalendarClock} /><div><h2 id="home-showings-title" className="text-[15px] font-semibold">Upcoming showings</h2><p className="mt-0.5 text-xs text-muted-foreground">Your schedule · next 30 days</p></div></div>
      <Button asChild size="sm" variant="outline"><Link href="/showings">View agenda<ArrowUpRight className="ml-2 h-3.5 w-3.5" aria-hidden /></Link></Button>
    </div>
    {loading ? <div className="mt-4 grid gap-3 md:grid-cols-3" aria-label="Loading showings">{[0, 1, 2].map(key => <Skeleton key={key} className="h-24 rounded-panel" />)}</div> : error ? <div className="mt-4 flex flex-wrap items-center gap-3" role="status"><p className="text-sm text-muted-foreground">Your showing schedule could not be loaded.</p><Button type="button" size="sm" variant="ghost" onClick={refetch}>Retry</Button></div> : data?.items.length ? <>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">{data.items.map(showing => <li key={showing.id} className="min-w-0"><Link href={`/showings?showing=${encodeURIComponent(showing.id)}`} className="block h-full min-w-0 rounded-panel border border-border p-3.5 transition-colors hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <p className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs font-semibold tabular"><time dateTime={showing.startsAt} title={formatNextActionDueAt(showing.startsAt)}>{DAY.format(new Date(showing.startsAt))} · {TIME.format(new Date(showing.startsAt))}</time><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /></p>
        <p className="mt-2 break-words text-sm font-semibold [overflow-wrap:anywhere]">{showing.contactName}</p>
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{showing.listing?.address ?? `MLS ${showing.mlsNumber}`}</span></p>
      </Link></li>)}</ul>
      {data.total > data.items.length && <p className="mt-3 text-xs text-muted-foreground">Showing the next {data.items.length} of {data.total} scheduled visits.</p>}
    </> : <div className="mt-4 rounded-panel border border-dashed border-input px-4 py-4"><p className="text-sm font-medium">Room for the next visit</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open a saved property list and choose Plan showing to put a visit on your agenda.</p><Link href="/property-lists" className="mt-3 inline-flex min-h-9 items-center text-xs font-semibold underline underline-offset-4">Open property lists<ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden /></Link></div>}
  </section>;
}
