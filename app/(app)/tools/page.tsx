import type { Metadata } from "next";
import { ArrowUpRight, ChartNoAxesCombined, MapPinned, Radar } from "lucide-react";

export const metadata: Metadata = { title: "Tools" };

/** Launch directory only. Authentication is inherited from the app layout.
 * Competitive Edge retains its own protection until session integration lands.
 * Never pass identity, tokens or workspace records through this external link.
 */
export default function ToolsPage() {
  return (
    <section aria-labelledby="tools-intro" className="space-y-8 py-2 md:py-5">
      <div className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">FortMark workspace</p>
        <h2 id="tools-intro" className="text-3xl font-semibold tracking-tight md:text-4xl">Your tools.</h2>
        <p className="text-sm leading-6 text-muted-foreground md:text-base">Explore your market, understand the competition, and plan your next move.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <a
          href="https://app.fortmark.net/competitive-edge"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open FortMark Realty Competitive Edge (opens in a new tab)"
          className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm outline-none transition-[border-color,box-shadow,transform] duration-200 hover:border-foreground/30 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background motion-safe:hover:-translate-y-1 motion-reduce:transition-none"
        >
          <div aria-hidden="true" className="relative flex h-44 items-center justify-center overflow-hidden border-b border-border bg-muted/50">
            <div className="absolute h-64 w-64 rounded-full border border-foreground/5" />
            <div className="absolute h-44 w-44 rounded-full border border-foreground/10" />
            <div className="absolute h-28 w-28 rounded-full border border-foreground/10" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-foreground/10 bg-background shadow-sm transition-transform duration-300 motion-safe:group-hover:scale-105 motion-reduce:transition-none">
              <Radar className="h-8 w-8" strokeWidth={1.5} />
            </div>
            <span className="absolute left-5 top-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Market intelligence</span>
            <ArrowUpRight className="absolute right-5 top-5 h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-1 flex-col gap-5 p-6">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">FortMark Realty</p>
              <h3 className="text-2xl font-semibold tracking-tight">Competitive Edge</h3>
              <p className="text-sm leading-6 text-muted-foreground">A clearer view of South Florida. Explore listing networks, compare brokerages, and build your farming strategy.</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><MapPinned aria-hidden="true" className="h-3.5 w-3.5" />Territory research</span>
              <span className="inline-flex items-center gap-1.5"><ChartNoAxesCombined aria-hidden="true" className="h-3.5 w-3.5" />Brokerage insights</span>
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-5 text-sm font-semibold">
              <span>Open Competitive Edge</span><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Opens in a new tab with your FortMark account.</p>
          </div>
        </a>
      </div>
    </section>
  );
}
