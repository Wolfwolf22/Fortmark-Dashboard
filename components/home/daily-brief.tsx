"use client";

/**
 * The daily brief: the first thing on Home, and the fastest read on the page.
 *
 * Four figures, a dateline, and the scope they cover. It is deliberately not
 * four cards. FortMark's system is editorial — hierarchy comes from weight and
 * spacing, structure from hairline rules — and a row of rounded boxes with
 * icons is the generic SaaS pattern the brand exists in opposition to. So the
 * numbers sit in one aligned field, separated by rules, and the typography
 * does the work.
 *
 * It does not greet the reader or print the date: the Home hero above it does
 * both, and saying either twice on one screen is the kind of noise this page is
 * meant to remove.
 *
 * Every figure obeys the E1 truth model. A domain that cannot answer shows an
 * em dash and says why underneath — never a zero, which would be a claim.
 */
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { useHomeMetrics } from "./metrics-provider";
import { UnavailableBody } from "./metric-state";
import { isFirstUse } from "@/lib/metrics/home-layout";
import { centsToDollars, monthLabel, scopeLabel } from "./metric-format";
import { ROUTES } from "@/lib/routes";
import { cn, formatCurrencyCompact } from "@/lib/utils";
import type { BrokerageMetrics, MetricAvailability } from "@/lib/metrics/types";

/** Why a figure is missing, in the fewest words that are still true. */
const ABSENT: Record<Exclude<MetricAvailability, "available">, string> = {
  not_configured: "Not connected",
  unavailable: "Unavailable",
  not_permitted: "Not available for your role",
  no_identity: "Finish your profile",
};

export interface Figure {
  label: string;
  /** The figure itself, already formatted. Null when it cannot be stated. */
  value: string | null;
  /** The qualifier under the figure — a caveat, a window, or the reason. */
  note: string;
}

/** The reason a group has no data, as a sentence. Empty when it does. */
function reason(availability: MetricAvailability): string {
  return availability === "available" ? "" : ABSENT[availability];
}

/** Exported for tests: the four figures, exactly as the band prints them. */
export function figures(metrics: BrokerageMetrics): Figure[] {
  const t = metrics.transactions;
  const c = metrics.contacts;
  // `data` exists exactly when the domain answered, so narrowing on the group
  // is what makes the rest of this function total.
  const deals = t.availability === "available" ? t.data : null;
  const people = c.availability === "available" ? c.data : null;

  return [
    {
      label: "Active transactions",
      value: deals ? String(deals.activeCount) : null,
      note: !deals
        ? reason(t.availability)
        : deals.onHoldCount > 0
          ? `${deals.onHoldCount} on hold, not counted`
          : "In an active stage now",
    },
    {
      label: "Pipeline value",
      value: deals ? formatCurrencyCompact(centsToDollars(deals.activeVolumeCents)) : null,
      note: !deals
        ? reason(t.availability)
        : deals.activeVolumeUnpricedCount > 0
          ? `${deals.activeVolumeUnpricedCount} without a contract price`
          : "Contract prices on active deals",
    },
    {
      label: "Projected commission",
      value: deals
        ? formatCurrencyCompact(centsToDollars(deals.projectedCommissionCents))
        : null,
      note: !deals
        ? reason(t.availability)
        : deals.projectedCommissionUntermedCount > 0
          ? `${deals.projectedCommissionUntermedCount} without terms entered`
          : "Projected, not earned",
    },
    {
      label: "Active clients",
      value: people ? String(people.activeClients) : null,
      note: !people
        ? reason(c.availability)
        : people.newLeadsThisMonth > 0
          ? `${people.newLeadsThisMonth} new this month`
          : "Represented or under contract",
    },
  ];
}

export function DailyBrief() {
  const { metrics, loading, error } = useHomeMetrics();

  // A request that failed is not a request still in flight. Without this
  // branch a failed fetch left the skeleton pulsing indefinitely — the widgets
  // below said "Metrics could not be loaded" while the headline band above
  // them kept promising figures that were never coming. Certification found
  // it by reading the code; the same sentence the widgets use goes here.
  if (error) {
    return (
      <section aria-label="Daily brief" className="mb-6" role="status">
        <UnavailableBody
          availability="unavailable"
          detail="Metrics could not be loaded. Refresh to retry."
        />
      </section>
    );
  }

  if (loading || !metrics) {
    return (
      <section aria-label="Daily brief" className="mb-5">
        <div className="h-3 w-48 animate-pulse rounded bg-tint" />
        <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-card border-x gap-px border-y border-border bg-border sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-card px-4 py-5 sm:px-5 sm:py-6">
              <div className="h-8 w-20 animate-pulse rounded bg-tint" />
              <div className="mt-3 h-3 w-24 animate-pulse rounded bg-tint" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const rows = figures(metrics);
  const firstUse = isFirstUse(metrics);

  return (
    <section aria-label="Daily brief" className="mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-micro">
          Business snapshot · <span className="text-foreground">{scopeLabel(metrics.scope)}</span>
        </p>
        <p className="text-micro">
          Monthly figures cover {monthLabel(metrics.monthStart)}
        </p>
      </div>

      {metrics.source === "sample" && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 rounded-panel bg-tint px-3 py-2 text-[13px] text-muted-foreground"
        >
          <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">Sample dashboard.</span> These figures
            are generated for demonstration and describe no real business.
          </span>
        </p>
      )}

      {/* One aligned numeric field, divided by hairlines — not four cards. The
          1px gap over a border-coloured background draws the rules between
          cells without a border on each side collapsing into a double line. */}
      <dl className="mt-3 grid grid-cols-2 overflow-hidden rounded-card border-x gap-px border-y border-border bg-border sm:grid-cols-4">
        {rows.map((figure) => (
          <div key={figure.label} className="bg-card px-4 py-5 sm:px-5 sm:py-6">
            <dd
              className={cn(
                "font-display leading-none tracking-[-0.02em] tabular",
                figure.value ? "text-[32px] sm:text-4xl" : "text-[32px] text-muted-foreground sm:text-4xl"
              )}
            >
              {figure.value ?? "—"}
            </dd>
            <dt className="mt-2.5 text-[13px] font-semibold leading-tight">{figure.label}</dt>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{figure.note}</p>
          </div>
        ))}
      </dl>

      {firstUse && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-[13px] text-muted-foreground">
            Nothing is on the books yet. Start with a person or a deal.
          </p>
          <div className="flex items-center gap-4">
            <Link
              href={ROUTES.leads}
              className="text-[13px] font-semibold underline underline-offset-4 hover:text-muted-foreground"
            >
              Add a contact
            </Link>
            <Link
              href={ROUTES.transactions}
              className="text-[13px] font-semibold underline underline-offset-4 hover:text-muted-foreground"
            >
              Create a transaction
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
