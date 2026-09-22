"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { UnavailableBody } from "@/components/home/metric-state";
import { Skeleton } from "@/components/ui/skeleton";
import { LISTING_STATUS_PILL, StatusPill } from "@/components/ui/status-pill";
import { WidgetCard } from "@/components/widgets/widget-card";
import { getAgent } from "@/lib/data/adapters/agents";
import { getFortmarkListingSummary, ListingsError } from "@/lib/data/adapters/listings";
import { useQuery } from "@/lib/data/hooks";
import type { Agent, Listing } from "@/lib/data/types";
import { formatCurrency, initials } from "@/lib/utils";
import { ListingImage } from "@/components/listings/listing-image";

/**
 * The featured listing, when there is an MLS to feature one from.
 *
 * Two quite different cards share this file, because they are two states of
 * one thing. Connected, it is a wide image card: photograph on the left from
 * `sm` up, details beside it, the whole body linking to the listing.
 *
 * Not connected, it collapses to a narrow integration status — and the grid
 * gives it a narrow span to match (see `widget-visibility.ts`). That pairing
 * is the point. A full-width panel reading "Not connected" was the largest
 * element on a page whose entire purpose is to show what matters today, and an
 * optional integration being absent should never be the loudest thing a
 * brokerage sees each morning.
 *
 * What it must never do is imply a fact: no invented property, and never
 * "0 listings", which would assert something false about the market.
 */
export default function FeaturedListingWidget() {
  const { data, loading, error } = useQuery<{
    listing: Listing | undefined;
    agent: Agent | undefined;
    activeCount: number | undefined;
  }>(async () => {
    const { listing, activeCount } = await getFortmarkListingSummary();
    // The sample roster only applies to sample rows; an MLS row states its
    // own agent on the record.
    const agent = listing?.agentId ? await getAgent(listing.agentId) : undefined;
    return { listing, agent, activeCount };
  }, []);

  // FortMark's own active count, straight from the MLS office id. Only a live
  // feed can state it; it is never derived from sample rows.
  const liveCount = data?.activeCount;

  // A sample row is not a listing for these purposes: Home shows the MLS state
  // rather than a generated property.
  const connected = data?.listing?.source === "mls";

  // "No MLS is configured" is not a failure to load — it is a standing fact
  // about this deployment, and it reads as a bug if the card calls it an
  // error. It lands in the same not-connected state an unconfigured feed
  // always produced.
  const unconfigured = error instanceof ListingsError && error.code === "mls_not_configured";

  return (
    <WidgetCard
      icon={Building2}
      title={!unconfigured && (connected || liveCount !== undefined) ? "FortMark listings" : "MLS"}
      preset={null}
      expandable={false}
      contentClassName="flex flex-col"
    >
      {unconfigured ? (
        <UnavailableBody
          availability="not_configured"
          detail="Listings appear here once the MLS feed is connected."
        />
      ) : error ? (
        <p className="text-[13px] text-muted-foreground">
          The featured listing failed to load. Refresh the page to retry.
        </p>
      ) : loading || !data ? (
        <FeaturedSkeleton />
      ) : !data.listing ? (
        <EmptyState
          icon={Building2}
          title="No active FortMark listings"
          description="The MLS shows no active listing for FortMark's office right now."
        />
      ) : !connected ? (
        // Home is the executive brief, and a generated listing has no place on
        // it. The listings screens still serve the sample set with a notice on
        // the page; here the honest answer is simply that the MLS is not
        // connected. Restored automatically the moment a live feed is.
        <UnavailableBody
          availability="not_configured"
          detail="Listings appear here once the MLS feed is connected."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {liveCount !== undefined && (
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold tabular text-foreground">{liveCount}</span>{" "}
              active {liveCount === 1 ? "listing" : "listings"} ·{" "}
              <Link href="/listings?office=fortmark" className="underline underline-offset-4 hover:text-foreground">
                View all
              </Link>
            </p>
          )}
          <FeaturedBody listing={data.listing} agent={data.agent} />
        </div>
      )}
    </WidgetCard>
  );
}

function FeaturedBody({
  listing,
  agent,
}: {
  listing: Listing;
  agent: Agent | undefined;
}) {
  const pill = LISTING_STATUS_PILL[listing.status] ?? {
    tone: "neutral" as const,
    label: listing.status,
  };

  return (
    <Link
      href={`/listings/${listing.id}`}
      aria-label={`Open listing ${listing.address}`}
      className="group -m-2 flex flex-col gap-4 rounded-panel p-2 transition-colors duration-150 hover:bg-tint sm:flex-row sm:items-center sm:gap-5"
    >
      <div className="relative shrink-0 overflow-hidden rounded-panel sm:w-56 lg:w-64">
        <ListingImage
          src={listing.photos[0]}
          alt={listing.address}
          source={listing.source}
          className="aspect-[16/10] w-full transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <StatusPill tone={pill.tone} className="absolute left-3 top-3 backdrop-blur-sm">
          {pill.label}
        </StatusPill>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-snug">{listing.address}</p>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {listing.city}
              {listing.neighborhood && <> · {listing.neighborhood}</>}
            </p>
          </div>
          <p className="font-display text-2xl leading-none tabular">
            {formatCurrency(listing.listPrice)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-micro tabular">MLS {listing.mlsNumber}</span>
          {listing.daysOnMarket !== undefined && (
            <span className="text-micro tabular">
              {listing.daysOnMarket} {listing.daysOnMarket === 1 ? "day" : "days"} on market
            </span>
          )}
          {(listing.listingAgent ?? agent) && (
            <span className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-[9px]">
                  {initials((listing.listingAgent ?? agent)!.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-micro">
                {(listing.listingAgent ?? agent)!.name} · Listing agent
                {listing.listingOffice?.name && <> · {listing.listingOffice.name}</>}
              </span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
      <Skeleton className="aspect-[16/10] w-full shrink-0 rounded-panel sm:w-56 lg:w-64" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
